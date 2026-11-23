/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";

type NylasWebhook = {
  id?: string;
  type?: string;
  data?: {
    object?: { id?: string; grant_id?: string };
  };
};

export const Route = createFileRoute("/api/public/email/webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const challenge = new URL(request.url).searchParams.get("challenge");
        if (!challenge) return new Response("Missing challenge", { status: 400 });
        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      },
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const { verifyNylasWebhookSignature } = await import("@/lib/email-connector.server");
        const signature = request.headers.get("x-nylas-signature");
        if (!(await verifyNylasWebhookSignature(rawBody, signature))) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: NylasWebhook;
        try {
          payload = JSON.parse(rawBody) as NylasWebhook;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const eventId = String(payload.id ?? "").trim();
        const eventType = String(payload.type ?? "").trim();
        const grantId = String(payload.data?.object?.grant_id ?? "").trim() || null;
        const objectId = String(payload.data?.object?.id ?? "").trim() || null;
        if (!eventId || !eventType) return new Response("Invalid event", { status: 400 });

        const supported =
          eventType.startsWith("message.created") ||
          eventType.startsWith("grant.expired") ||
          eventType.startsWith("grant.deleted");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;
        const { error } = await db.from("email_webhook_events").upsert(
          {
            event_id: eventId,
            event_type: eventType,
            provider: "nylas",
            provider_grant_id: grantId,
            provider_object_id: objectId,
            status: supported ? "pending" : "ignored",
            processed_at: supported ? null : new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "event_id", ignoreDuplicates: true },
        );
        if (error) return new Response("Failed to persist event", { status: 500 });

        if (supported) {
          const secret = (
            process.env.EMAIL_WORKER_SECRET ??
            process.env.BLING_WORKER_SECRET ??
            ""
          ).trim();
          const base = (process.env.APP_PUBLIC_URL ?? new URL(request.url).origin).replace(
            /\/$/,
            "",
          );
          if (!secret) return new Response("Worker not configured", { status: 503 });
          const { error: queueError } = await db.rpc("enqueue_http_job", {
            _url: `${base}/api/public/email/process`,
            _secret: secret,
            _body: { event_id: eventId },
          });
          if (queueError) return new Response("Failed to queue event", { status: 500 });
        }
        return new Response(null, { status: 200 });
      },
    },
  },
});
