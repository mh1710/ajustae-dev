import { createFileRoute } from "@tanstack/react-router";

function trim(v: string | null | undefined) { return (v ?? "").trim(); }

function isAcceptedCronKey(provided: string, publishableKey: string) {
  if (!provided) return false;
  if (publishableKey && provided === publishableKey) return true;
  try {
    const [, payload] = provided.split(".");
    if (!payload) return false;
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { iss?: string; role?: string; ref?: string };
    const ref = process.env.SUPABASE_PROJECT_ID ?? process.env.VITE_SUPABASE_PROJECT_ID
      ?? (process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname.split(".")[0] : "");
    return decoded.role === "anon" && decoded.ref === ref && decoded.iss === "supabase";
  } catch { return false; }
}

/**
 * Fan-out: para CADA integração com itens pendentes na fila, dispara um
 * push-tick independente via pg_net. Assim várias empresas sincronizam em
 * paralelo e a fila nunca fica parada, mesmo se um encadeamento falhar.
 */
export const Route = createFileRoute("/api/public/bling/push-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = trim(process.env.BLING_WORKER_SECRET);
        const publishable = trim(
          process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ??
          process.env.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        );
        const url = new URL(request.url);
        const provided = trim(request.headers.get("x-worker-secret"))
          || trim(url.searchParams.get("secret"))
          || trim(request.headers.get("apikey"));
        const okAuth = (!!secret && provided === secret) || isAcceptedCronKey(provided, publishable);
        if (!okAuth) return new Response("Forbidden", { status: 403 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // devolve itens presos por workers que morreram
        try {
          await supabaseAdmin.rpc("reclaim_stuck_workers", { _minutes: 5 } as never);
        } catch { /* best-effort */ }

        const { data: integs } = await supabaseAdmin
          .from("bling_integrations")
          .select("id")
          .eq("status", "conectada");

        const base = (process.env.APP_PUBLIC_URL ?? url.origin).replace(/\/$/, "");
        const target = `${base}/api/public/bling/push-tick`;
        const dispatched: string[] = [];

        for (const row of (integs ?? []) as Array<{ id: string }>) {
          // Existência (limit 1) em vez de contagem exata: mesma decisão, custo mínimo.
          const { data: pend } = await supabaseAdmin
            .from("bling_push_queue")
            .select("id")
            .eq("integration_id", row.id)
            .eq("status", "pendente")
            .limit(1);
          if (!pend || pend.length === 0) continue;
          await supabaseAdmin.rpc("enqueue_http_job", {
            _url: target,
            _secret: secret,
            _body: { integration_id: row.id } as never,
          } as never);
          dispatched.push(row.id);
        }

        return Response.json({ success: true, dispatched: dispatched.length, integrations: dispatched });
      },
    },
  },
});
