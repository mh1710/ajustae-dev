/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/email/process")({
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
        const body = (await request.json().catch(() => ({}))) as { event_id?: string };
        const eventId = String(body.event_id ?? "").trim();
        if (!eventId) return new Response("Missing event_id", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { markWebhookFailed, processNylasGrantEvent, processNylasMessage } =
          await import("@/lib/email-connector.server");
        const db = supabaseAdmin as any;
        const { data: event, error } = await db
          .from("email_webhook_events")
          .select("event_id, event_type, provider_grant_id, provider_object_id, status, attempts")
          .eq("event_id", eventId)
          .maybeSingle();
        if (error) return Response.json({ success: false, error: error.message }, { status: 500 });
        if (!event) return new Response("Event not found", { status: 404 });
        if (["processed", "ignored"].includes(event.status)) {
          return Response.json({ success: true, duplicate: true });
        }

        await db
          .from("email_webhook_events")
          .update({
            status: "processing",
            attempts: Number(event.attempts ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("event_id", eventId);

        try {
          if (!event.provider_grant_id) throw new Error("Evento sem grant_id.");
          if (event.event_type.startsWith("message.created")) {
            if (!event.provider_object_id) throw new Error("Evento de mensagem sem message_id.");
            await processNylasMessage({
              grantId: event.provider_grant_id,
              messageId: event.provider_object_id,
              eventId,
            });
          } else if (event.event_type.startsWith("grant.")) {
            await processNylasGrantEvent(event.provider_grant_id, event.event_type, eventId);
          }
          return Response.json({ success: true });
        } catch (processingError) {
          await markWebhookFailed(eventId, processingError);
          const message =
            processingError instanceof Error ? processingError.message : "Falha no evento.";
          return Response.json({ success: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
