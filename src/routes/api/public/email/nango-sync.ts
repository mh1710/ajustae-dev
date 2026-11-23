import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/email/nango-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = (
          process.env.EMAIL_WORKER_SECRET ??
          process.env.BLING_WORKER_SECRET ??
          ""
        ).trim();
        const provided = (request.headers.get("x-worker-secret") ?? "").trim();
        if (!secret || provided !== secret) return new Response("Forbidden", { status: 403 });
        if ((process.env.EMAIL_CONNECTOR_PROVIDER ?? "nango").trim().toLowerCase() !== "nango") {
          return Response.json({ success: true, skipped: "provider_disabled" });
        }
        const { syncAllNangoConnections } = await import("@/lib/email-connector.server");
        const results = await syncAllNangoConnections(10);
        return Response.json({
          success: results.every((result) => !result.error),
          connections: results.length,
          checked: results.reduce((sum, result) => sum + result.checked, 0),
          stored: results.reduce((sum, result) => sum + result.stored, 0),
          failures: results.filter((result) => result.error).length,
        });
      },
    },
  },
});
