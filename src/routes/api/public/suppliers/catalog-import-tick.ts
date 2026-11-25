import { createFileRoute } from "@tanstack/react-router";

/** Chamado pelo cron do banco (10 s) quando há importação de "Novos do fornecedor" vencida e sem lease. */
export const Route = createFileRoute("/api/public/suppliers/catalog-import-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BLING_WORKER_SECRET?.trim();
        if (!secret || request.headers.get("x-worker-secret")?.trim() !== secret) return new Response("Forbidden", { status: 403 });
        const { processSupplierCatalogTick } = await import("@/lib/supplier-catalog-import.server");
        const result = await processSupplierCatalogTick(new URL(request.url).origin);
        return Response.json(result);
      },
    },
  },
});
