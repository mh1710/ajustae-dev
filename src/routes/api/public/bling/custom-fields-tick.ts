import { createFileRoute } from "@tanstack/react-router";

function trim(v: string | null | undefined) { return (v ?? "").trim(); }

export const Route = createFileRoute("/api/public/bling/custom-fields-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = trim(process.env.BLING_WORKER_SECRET);
        const provided = trim(request.headers.get("x-worker-secret"))
          || trim(new URL(request.url).searchParams.get("secret"));
        if (!secret || provided !== secret) return new Response("Forbidden", { status: 403 });

        const body = (await request.json().catch(() => ({}))) as { job_id?: string };
        if (!body.job_id || !/^[0-9a-f-]{36}$/i.test(body.job_id)) return new Response("Missing job_id", { status: 400 });

        const { processCustomFieldTick, enqueueCustomFieldTick } = await import("@/lib/bling-custom-fields.server");
        const result = await processCustomFieldTick(body.job_id);
        if (!result.done && !result.stopped && !result.busy) {
          await enqueueCustomFieldTick(body.job_id, new URL(request.url).origin).catch(() => undefined);
        }
        return Response.json({ success: true, ...result });
      },
    },
  },
});
