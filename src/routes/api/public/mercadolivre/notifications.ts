import { createFileRoute } from "@tanstack/react-router";

// Endpoint de notificações (webhooks) do Mercado Livre.
// O ML exige que a URL responda 200 rapidamente; o processamento real
// é feito pelos jobs de mapeamento, então aqui apenas confirmamos o recebimento.
export const Route = createFileRoute("/api/public/mercadolivre/notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await request.json().catch(() => null);
        } catch {
          // ignora payloads malformados
        }
        return new Response("ok", { status: 200 });
      },
      GET: async () => new Response("ok", { status: 200 }),
    },
  },
});
