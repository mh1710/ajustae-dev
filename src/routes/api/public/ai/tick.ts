import { createFileRoute } from "@tanstack/react-router";

function trim(v: string | null | undefined) {
  return (v ?? "").trim();
}

function isAcceptedCronKey(provided: string, publishableKey: string) {
  if (!provided) return false;
  if (publishableKey && provided === publishableKey) return true;
  try {
    const [, payload] = provided.split(".");
    if (!payload) return false;
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { iss?: string; role?: string; ref?: string };
    const ref =
      process.env.SUPABASE_PROJECT_ID ??
      process.env.VITE_SUPABASE_PROJECT_ID ??
      (process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname.split(".")[0] : "");
    return decoded.role === "anon" && decoded.ref === ref && decoded.iss === "supabase";
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/ai/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = trim(process.env.BLING_WORKER_SECRET);
        const publishable = trim(
          process.env.SUPABASE_PUBLISHABLE_KEY ??
            process.env.SUPABASE_ANON_KEY ??
            process.env.VITE_SUPABASE_ANON_KEY ??
            process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        );
        const url = new URL(request.url);
        const provided =
          trim(request.headers.get("x-worker-secret")) ||
          trim(url.searchParams.get("secret")) ||
          trim(request.headers.get("apikey"));

        const okAuth = (!!secret && provided === secret) || isAcceptedCronKey(provided, publishable);
        if (!okAuth) return new Response("Forbidden", { status: 403 });

        let jobId: string | null = null;
        try {
          const body = (await request.json().catch(() => ({}))) as { job_id?: string };
          jobId = body.job_id ?? null;
        } catch {
          jobId = null;
        }

        const { processAiTransformTick } = await import("@/lib/ai-transforms.server");
        // Orçamento fixo de tempo por rodada: nunca prende uma requisição longa.
        const deadline = Date.now() + 40_000;
        const result = await processAiTransformTick(jobId, deadline);

        // Só reencadeia quando ainda há trabalho e a tarefa não está pausada/cancelada.
        const shouldContinue =
          result.job_id !== null &&
          result.remaining > 0 &&
          (result.status === "pendente" || result.status === "executando" || result.status === null);

        if (shouldContinue && secret) {
          const base = (process.env.APP_PUBLIC_URL ?? new URL(request.url).origin).replace(/\/$/, "");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          try {
            await (supabaseAdmin as any).rpc("enqueue_http_job", {
              _url: `${base}/api/public/ai/tick`,
              _secret: secret,
              _body: { job_id: result.job_id },
            });
          } catch {
            /* o agendamento periódico retoma a fila */
          }
        }

        return Response.json({ success: true, ...result });
      },
    },
  },
});
