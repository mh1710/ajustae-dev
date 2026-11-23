import { createFileRoute } from "@tanstack/react-router";

/**
 * Recotação rápida do Mercado Livre.
 * Só mexe nos SKUs que JÁ foram mapeados: como o produto de catálogo é conhecido,
 * cada atualização custa ~1 requisição, o que permite rodar junto com a
 * atualização dos fornecedores nas automações.
 */
const BATCH = 300;
const CONCURRENCY = 8;
const TIME_BUDGET_MS = 22_000;
// Cobertura diária: tudo que não foi reconsultado nas últimas 20h entra na fila.

function trim(v: string | null | undefined) {
  return (v ?? "").trim();
}

export const Route = createFileRoute("/api/public/mercadolivre/refresh-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = trim(process.env.BLING_WORKER_SECRET);
        const provided =
          trim(request.headers.get("x-worker-secret")) ||
          trim(new URL(request.url).searchParams.get("secret"));
        const ok = !!secret && provided === secret;
        if (!ok) return new Response("Forbidden", { status: 403 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { getMlAccessToken, refreshCatalogProduct, mapProductOnMl } = await import("@/lib/mercadolivre.server");

        // Trava: só um ciclo por vez. O encadeamento interno renova a trava;
        // se um ciclo se perder, a trava expira sozinha e o cron retoma.
        const url = new URL(request.url);
        const chained = url.searchParams.get("chained") === "1";
        const rpc = (supabaseAdmin as unknown as {
          rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown }>;
        }).rpc.bind(supabaseAdmin);
        const { data: gotLease } = await rpc("ml_refresh_lease", { _minutes: 3 });
        if (!chained && gotLease !== true) {
          return Response.json({ ok: true, skipped: "em execução" });
        }

        const release = async () => {
          await rpc("ml_refresh_release", {});
        };

        let token: string;
        try {
          token = await getMlAccessToken();
        } catch (e) {
          await release();
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }

        const maxAgeHours = Number(process.env.ML_REFRESH_MAX_AGE_HOURS ?? 20) || 20;
        const cutoff = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();
        const startedAt = Date.now();
        let processed = 0;
        let exhausted = false;

        while (Date.now() - startedAt < TIME_BUDGET_MS) {
          const { data: rows, error } = await (supabaseAdmin as unknown as { from: (t: string) => any })
            .from("ml_product_matches")
            .select("product_id, catalog_product_id, zip_code, checked_at, ean, nome, company_id")
            .lt("checked_at", cutoff)
            .order("checked_at", { ascending: true })
            .limit(BATCH);
          if (error) {
            await release();
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          const list = (rows ?? []) as Array<{
            product_id: string;
            company_id: string;
            catalog_product_id: string | null;
            zip_code: string | null;
            ean: string | null;
            nome: string | null;
          }>;
          if (list.length === 0) {
            exhausted = true;
            break;
          }

          for (let i = 0; i < list.length; i += CONCURRENCY) {
            if (Date.now() - startedAt >= TIME_BUDGET_MS) break;
            const chunk = list.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
              chunk.map(async (r) => {
                try {
                  // Com produto de catálogo conhecido: 1 requisição.
                  // Sem ele (mapeamento antigo): refaz a busca por EAN/título.
                  const outcome = r.catalog_product_id
                    ? await refreshCatalogProduct(token, r.catalog_product_id, r.zip_code)
                    : await mapProductOnMl(token, {
                        ean: r.ean,
                        nome: r.nome,
                        zip: r.zip_code,
                      });
                  const { alt_offers: _alt, ...rest } = outcome;
                  return {
                    product_id: r.product_id,
                    qualifies: rest.qualifies,
                    company_id: r.company_id,
                    catalog_product_id: r.catalog_product_id,
                    fresh: true,
                    patch: { ...rest, checked_at: new Date().toISOString(), error: null },
                  };
                } catch (e) {
                  return {
                    product_id: r.product_id,
                    company_id: r.company_id,
                    catalog_product_id: r.catalog_product_id,
                    fresh: false,
                    qualifies: true, // erro pontual não remove a oferta já conhecida
                    patch: {
                      checked_at: new Date().toISOString(),
                      error: e instanceof Error ? e.message : String(e),
                    },
                  };
                }
              }),
            );

            const changed = new Map<string, string[]>();
            for (const r of results) {
              const { error: updateError } = await supabaseAdmin
                .from("ml_product_matches")
                .update(r.patch as never)
                .eq("product_id", r.product_id);
              if (updateError) throw new Error(updateError.message);
              if (r.fresh && r.catalog_product_id) {
                const { data: sync, error: syncError } = await (supabaseAdmin as any).rpc("sync_ml_prospect_catalog_stock", { _product_id: r.product_id });
                if (syncError) throw new Error(syncError.message);
                if (sync?.changed) changed.set(r.company_id, [...(changed.get(r.company_id) ?? []), r.product_id]);
              }
            }
            for (const [companyId, ids] of changed) {
              const { error: queueError } = await (supabaseAdmin as any).rpc("enqueue_ml_prospect_stock", { _company_id: companyId, _product_ids: ids });
              if (queueError) throw new Error(queueError.message);
            }
            processed += chunk.length;
          }
        }

        if (!exhausted) {
          const base = (process.env.APP_PUBLIC_URL ?? url.origin).replace(/\/$/, "");
          await supabaseAdmin.rpc("enqueue_http_job", {
            _url: `${base}/api/public/mercadolivre/refresh-tick?chained=1`,
            _secret: secret,
            _body: {} as never,
          } as never);
        } else {
          await release();
        }

        return Response.json({ ok: true, processed, finished: exhausted });
      },
    },
  },
});
