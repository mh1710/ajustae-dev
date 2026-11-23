import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/bling/image-audit-tick")({
  server: { handlers: { POST: async ({ request }) => {
    const secret = process.env.BLING_WORKER_SECRET?.trim();
    if (!secret || request.headers.get("x-worker-secret")?.trim() !== secret) return new Response("Forbidden", { status: 403 });
    const body = await request.json() as { job_id?: string };
    if (!body.job_id || !/^[0-9a-f-]{36}$/i.test(body.job_id)) return new Response("Invalid job", { status: 400 });
    const { scanImageAuditRun } = await import("@/lib/image-fingerprint.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const result = await scanImageAuditRun(body.job_id);
    if ((result as { busy?: boolean }).busy) return Response.json(result);
    // A etapa final não roda aqui: ela passa de 60s e a chamada HTTP seria
    // cortada no meio. Quem estiver no sistema finaliza na hora; sem navegador,
    // o vigia agenda o término no cron do banco, sem limite de tempo.
    if (!result.done) {
      const base = (process.env.APP_PUBLIC_URL || new URL(request.url).origin).replace(/\/$/, "");
      await db.rpc("enqueue_http_job", { _url: `${base}/api/public/bling/image-audit-tick`, _secret: secret, _body: { job_id: body.job_id } });
    }
    return Response.json(result);
  } } },
});