import { createFileRoute } from "@tanstack/react-router";

function trim(v: string | null | undefined) { return (v ?? "").trim(); }

export const Route = createFileRoute("/api/public/bling/stores-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = trim(process.env.BLING_WORKER_SECRET);
        const provided = trim(request.headers.get("x-worker-secret"))
          || trim(new URL(request.url).searchParams.get("secret"));
        if (!secret || provided !== secret) return new Response("Forbidden", { status: 403 });

        const body = (await request.json().catch(() => ({}))) as { job_id?: string; syncJobId?: string };
        const jobId = body.job_id ?? body.syncJobId;
        if (!jobId) return new Response("Missing job_id", { status: 400 });

        const { processStoreSyncTick, isCancelled } = await import("@/lib/bling-stores.server");

        if (await isCancelled(jobId)) {
          return Response.json({ success: true, cancelled: true, done: true, processed_pages: 0, next_page: null });
        }

        const result = await processStoreSyncTick(jobId);

        // Só enfileira o próximo tick se o job não foi cancelado nesse meio tempo.
        if (!result.done && !result.cancelled && result.next_page != null && !(await isCancelled(jobId))) {
          const base = (process.env.APP_PUBLIC_URL ?? new URL(request.url).origin).replace(/\/$/, "");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.rpc("enqueue_bling_sync_tick", {
            _url: `${base}/api/public/bling/stores-tick`,
            _secret: secret,
            _job_id: jobId,
          });
        }

        return Response.json({ success: true, ...result });
      },
    },
  },
});
