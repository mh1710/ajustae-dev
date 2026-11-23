import { createFileRoute } from "@tanstack/react-router";

function parseSecret(v: string | null | undefined) { return (v ?? "").trim(); }

function isAcceptedCronKey(provided: string, publishableKey: string) {
  if (!provided) return false;
  if (publishableKey && provided === publishableKey) return true;
  try {
    const [, payload] = provided.split(".");
    if (!payload) return false;
    const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { iss?: string; role?: string; ref?: string };
    const ref = process.env.SUPABASE_PROJECT_ID ?? process.env.VITE_SUPABASE_PROJECT_ID ?? (process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname.split(".")[0] : "");
    return decoded.role === "anon" && decoded.ref === ref && decoded.iss === "supabase";
  } catch { return false; }
}

export const Route = createFileRoute("/api/public/bling/push-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = parseSecret(process.env.BLING_WORKER_SECRET);
        const publishable = parseSecret(
          process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ??
          process.env.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        );
        const url = new URL(request.url);
        const provided = parseSecret(request.headers.get("x-worker-secret"))
          || parseSecret(url.searchParams.get("secret"))
          || parseSecret(request.headers.get("apikey"));
        if (!secret && !provided) return new Response("Unauthorized", { status: 401 });
        const okAuth = (secret && provided === secret) || isAcceptedCronKey(provided, publishable);
        if (secret && !okAuth) return new Response("Forbidden", { status: 403 });

        let integrationId: string | null = null;
        try {
          const body = (await request.json().catch(() => ({}))) as { integration_id?: string; syncJobId?: string; job_id?: string };
          integrationId = body.integration_id ?? body.syncJobId ?? body.job_id ?? null;
        } catch { integrationId = null; }

        const { processPushTick } = await import("@/lib/bling-push.server");

        // Vários lotes no mesmo ciclo (~45s) sob uma única reserva de worker,
        // aproveitando o limite do Bling (3 req/s por integração) sem
        // repetir as chamadas de controle a cada 10 itens.
        const deadline = Date.now() + 45_000;
        const result = await processPushTick(integrationId, deadline, 25);
        const { processed, ok, failed } = result;


        if (result.remaining > 0 && (result.integration_id || integrationId)) {
          const base = (process.env.APP_PUBLIC_URL ?? new URL(request.url).origin).replace(/\/$/, "");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.rpc("enqueue_http_job", {
            _url: `${base}/api/public/bling/push-tick`,
            _secret: secret,
            _body: { integration_id: result.integration_id ?? integrationId } as never,
          } as never);
        }
        return Response.json({ success: true, processed, ok, failed, remaining: result.remaining, integration_id: result.integration_id ?? integrationId });
      },
    },
  },
});
