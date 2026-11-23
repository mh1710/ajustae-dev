import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/suppliers/evolusom-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BLING_WORKER_SECRET?.trim();
        if (!secret || request.headers.get("x-worker-secret")?.trim() !== secret) {
          return new Response("Forbidden", { status: 403 });
        }
        const { evolusomTick } = await import("@/lib/suppliers-sync.server");
        try {
          return Response.json(await evolusomTick());
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
