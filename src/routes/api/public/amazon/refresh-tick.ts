import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

/**
 * Daily Amazon recheck of garimpo products (AMZ + EAN): cheapest Prime offer → cost and stock (cap 10,
 * 40% margin). A failed consultation keeps the last price and stock. Hourly cron; chains itself while due.
 */
const BATCHES_PER_TICK = 2;
const GAP_MS = 10_500;

function sameSecret(received: string, expected: string) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/amazon/refresh-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = (process.env.BLING_WORKER_SECRET ?? "").trim();
        const provided = (request.headers.get("x-worker-secret") ?? "").trim();
        if (!secret || !sameSecret(provided, secret)) return new Response("Forbidden", { status: 403 });
        const { amazonConfigured, amazonOffersBatch, AmazonBusyError } = await import("@/lib/amazon-catalog.server");
        if (!amazonConfigured()) return Response.json({ ok: true, skipped: "amazon_not_configured" });
        const { pickPrimeOffer } = await import("@/lib/amazon-prospect");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as unknown as { rpc: (fn: string, args: Record<string, unknown>) => any };

        const { data: due, error } = await db.rpc("amazon_prospect_refresh_due", { _limit: 20 * BATCHES_PER_TICK });
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        const rows = (due ?? []) as Array<{ codigo: string; asin: string }>;
        let checked = 0;
        let kept = 0;
        for (let i = 0; i < rows.length; i += 20) {
          if (i > 0) await new Promise(r => setTimeout(r, GAP_MS));
          const chunk = rows.slice(i, i + 20);
          let offers: Map<string, unknown> | null = null;
          try { offers = await amazonOffersBatch(chunk.map(r => r.asin)); }
          catch (e) { if (!(e instanceof AmazonBusyError)) console.error("amazon refresh", e); }
          for (const r of chunk) {
            const ok = !!offers?.has(r.asin);
            const offer = ok ? pickPrimeOffer(offers!.get(r.asin)) : null;
            await db.rpc("apply_amazon_prospect_offer", { _ean: r.codigo, _ok: ok, _total: offer?.total ?? 0 });
            if (ok) checked++; else kept++;
          }
        }
        if (rows.length >= 20 * BATCHES_PER_TICK) {
          const base = (process.env.APP_PUBLIC_URL ?? new URL(request.url).origin).replace(/\/$/, "");
          await db.rpc("enqueue_http_job", { _url: `${base}/api/public/amazon/refresh-tick`, _secret: secret, _body: {} });
        }
        return Response.json({ ok: true, checked, kept });
      },
    },
  },
});
