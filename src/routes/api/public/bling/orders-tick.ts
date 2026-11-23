import { createFileRoute } from "@tanstack/react-router";

function trim(v: string | null | undefined) {
  return (v ?? "").trim();
}

export const Route = createFileRoute("/api/public/bling/orders-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = trim(process.env.BLING_WORKER_SECRET);
        const provided =
          trim(request.headers.get("x-worker-secret")) ||
          trim(new URL(request.url).searchParams.get("secret"));
        if (!secret || provided !== secret) return new Response("Forbidden", { status: 403 });

        const body = (await request.json().catch(() => ({}))) as {
          job_id?: string;
          syncJobId?: string;
        };
        const jobId = body.job_id ?? body.syncJobId ?? new URL(request.url).searchParams.get("job_id") ?? undefined;
        if (!jobId) return new Response("Missing job_id", { status: 400 });

        const { processOrdersSyncTick } = await import("@/lib/bling-orders.server");
        const result = await processOrdersSyncTick(jobId);

        if (!result.done) {
          const base = (process.env.APP_PUBLIC_URL ?? new URL(request.url).origin).replace(/\/$/, "");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.rpc("enqueue_bling_sync_tick", {
            _url: `${base}/api/public/bling/orders-tick`,
            _secret: secret,
            _job_id: jobId,
          });
        }

        return Response.json({ success: true, ...result });
      },
    },
  },
});
