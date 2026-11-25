import { createFileRoute } from "@tanstack/react-router";

const BATCH = 240;
// Cota oficial do ML: 18.000 req/h por aplicação (4/s com folga, controlados em ml-http.server).
const CONCURRENCY = 4;
const TIME_BUDGET_MS = 24_000;
const WORKERS = 4; // ciclos rodando em paralelo no mesmo job

function trim(v: string | null | undefined) {
  return (v ?? "").trim();
}

export const Route = createFileRoute("/api/public/mercadolivre/map-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = trim(process.env.BLING_WORKER_SECRET);
        const anonKey = trim(process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY);
        const provided =
          trim(request.headers.get("x-worker-secret")) ||
          trim(new URL(request.url).searchParams.get("secret"));
        const apiKey = trim(request.headers.get("apikey"));
        const ok = (!!secret && provided === secret) || (!!anonKey && apiKey === anonKey);
        if (!ok) return new Response("Forbidden", { status: 403 });

        const body = (await request.json().catch(() => ({}))) as {
          job_id?: string;
          worker?: number;
        };
        if (!body.job_id) return new Response("Missing job_id", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { getMlAccessToken, mapProductOnMl } = await import("@/lib/mercadolivre.server");

        const { data: job } = await supabaseAdmin
          .from("ml_map_jobs")
          .select("*")
          .eq("id", body.job_id)
          .maybeSingle();

        if (!job) return Response.json({ ok: false, error: "job_not_found" }, { status: 404 });
        if (job.status === "concluido" || job.status === "cancelado" || job.status === "erro") {
          return Response.json({ ok: true, skipped: job.status });
        }

        const base = (process.env.APP_PUBLIC_URL ?? new URL(request.url).origin).replace(/\/$/, "");
        const nextUrl = `${base}/api/public/mercadolivre/map-tick`;
        const enqueueTick = async (worker: number) =>
          supabaseAdmin.rpc("enqueue_http_job", {
            _url: nextUrl,
            _secret: secret,
            _body: { job_id: job.id, worker } as never,
          } as never);

        const finish = async (status: string, error?: string) => {
          await supabaseAdmin
            .from("ml_map_jobs")
            .update({
              status,
              error: error ?? null,
              finished_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);
        };

        if (job.cancel_requested) {
          await finish("cancelado");
          return Response.json({ ok: true, cancelled: true });
        }

        let token: string;
        try {
          token = await getMlAccessToken();
        } catch (e) {
          await finish("erro", e instanceof Error ? e.message : String(e));
          return Response.json({ ok: false });
        }

        const worker = Number(body.worker ?? 0) || 0;
        if (job.status === "pendente") {
          await supabaseAdmin
            .from("ml_map_jobs")
            .update({
              status: "processando",
              started_at: job.started_at ?? new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);
          // Abre os demais ciclos paralelos uma única vez, no começo do job.
          for (let w = 1; w < WORKERS; w += 1) await enqueueTick(w);
        }

        const startedAt = Date.now();
        let processed = 0;
        let done = false;
        let cancelled = false;

        const isCancelled = async () => {
          const { data: fresh } = await supabaseAdmin
            .from("ml_map_jobs")
            .select("cancel_requested, status")
            .eq("id", job.id)
            .maybeSingle();
          return !!fresh?.cancel_requested || fresh?.status === "cancelado";
        };

        const skuChecks = () =>
          (supabaseAdmin as unknown as { from: (t: string) => any }).from("ml_sku_checks");

        while (Date.now() - startedAt < TIME_BUDGET_MS) {
          // Reserva atômica do próximo lote: permite vários ciclos em paralelo
          // sem que dois workers peguem os mesmos produtos.
          const { data: claimed, error } = await (supabaseAdmin.rpc as unknown as (
            fn: string,
            args: Record<string, unknown>,
          ) => Promise<{
            data: Array<{ id: string; company_id: string; codigo: string | null; nome: string | null; gtin: string | null }> | null;
            error: { message: string } | null;
          }>)("ml_claim_batch", { _job_id: job.id, _limit: BATCH });

          if (error) {
            await finish("erro", error.message);
            return Response.json({ ok: false, error: error.message });
          }
          const products = claimed ?? [];
          if (products.length === 0) {
            done = true;
            break;
          }

          // Remove SKUs repetidos dentro do lote e os que já foram checados.
          const seen = new Set<string>();
          const candidates = products.filter((p) => {
            const sku = (p.codigo ?? "").trim();
            if (!sku || seen.has(sku)) return false;
            seen.add(sku);
            return true;
          });
          const { data: checked } = await skuChecks()
            .select("sku")
            .in("sku", candidates.map((p) => (p.codigo ?? "").trim()));
          const already = new Set(
            ((checked ?? []) as Array<{ sku: string }>).map((r) => r.sku),
          );
          const todo = candidates.filter((p) => !already.has((p.codigo ?? "").trim()));

          if (todo.length === 0) continue;

          // Processa em paralelo respeitando o limite de requisições do ML.
          let budgetOut = false;
          for (let i = 0; i < todo.length; i += CONCURRENCY) {
            if (Date.now() - startedAt >= TIME_BUDGET_MS) {
              budgetOut = true;
              break;
            }
            if (await isCancelled()) {
              cancelled = true;
              break;
            }
            const chunk = todo.slice(i, i + CONCURRENCY);
            const rows = await Promise.all(
              chunk.map(async (p) => {
                // Formato fixo: o PostgREST exige as MESMAS chaves em todas as linhas do upsert.
                const row = {
                  company_id: p.company_id,
                  product_id: p.id,
                  sku: p.codigo,
                  nome: p.nome,
                  ean: p.gtin,
                  found: false,
                  has_full: false,
                  full_offers: 0,
                  total_offers: 0,
                  min_price: null as number | null,
                  min_full_price: null as number | null,
                  permalink: null as string | null,
                  match_by: null as string | null,
                  best_item_id: null as string | null,
                  best_price: null as number | null,
                  best_shipping_cost: null as number | null,
                  best_total_price: null as number | null,
                  best_is_full: false,
                  available_quantity: null as number | null,
                  has_stock: false,
                  qualifies: false,
                  top_offers: [] as unknown as never,
                  catalog_product_id: null as string | null,
                  zip_code: job.zip_code,
                  error: null as string | null,
                  checked_at: new Date().toISOString(),
                };
                try {
                  const outcome = await mapProductOnMl(token, {
                    ean: p.gtin,
                    nome: p.nome,
                    zip: job.zip_code,
                  });
                  const { alt_offers: _alt, ...rest } = outcome;
                  return { ...row, ...rest };
                } catch (e) {
                  return { ...row, error: e instanceof Error ? e.message : String(e) };
                }
              }),
            );

            // Só entram na lista os produtos com oferta Full entregando no CEP e com estoque.
            const keep = rows.filter((r) => r.qualifies);
            // Erro na consulta (ex.: 403 do ML) não prova que o produto saiu do ML:
            // mantém o vínculo existente e não marca o SKU como checado.
            const drop = rows.filter((r) => !r.qualifies && !r.error).map((r) => r.product_id);

            if (keep.length > 0) {
              const { error: upsertError } = await supabaseAdmin
                .from("ml_product_matches")
                .upsert(keep as never, { onConflict: "product_id" });
              if (upsertError) {
                await finish("erro", `Falha ao gravar resultados: ${upsertError.message}`);
                return Response.json({ ok: false, error: upsertError.message });
              }
            }
            if (drop.length > 0) {
              await supabaseAdmin.from("ml_product_matches").delete().in("product_id", drop);
            }

            // Marca os SKUs como já checados nesta varredura da conta.
            await skuChecks().upsert(
              rows
                .filter((r) => !!(r.sku ?? "").trim() && !r.error)
                .map((r) => ({
                  sku: (r.sku ?? "").trim(),
                  job_id: job.id,
                  qualifies: r.qualifies,
                  checked_at: new Date().toISOString(),
                })),
              { onConflict: "sku" },
            );

            // Mostra o motivo das consultas recusadas (ex.: 403 do ML) sem interromper o mapeamento.
            const failed = rows.filter((r) => r.error);
            await supabaseAdmin
              .from("ml_map_jobs")
              .update({
                error: failed.length > 0 ? `${failed.length} produto(s) não consultados neste lote; tentam de novo depois. ${failed[0]?.error ?? ""}`.trim() : null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);

            processed += chunk.length;
            await (supabaseAdmin.rpc as unknown as (
              fn: string,
              args: Record<string, unknown>,
            ) => Promise<unknown>)("ml_bump_progress", {
              _job_id: job.id,
              _processed: chunk.length,
              _found: keep.filter((r) => r.found).length,
              _full: keep.filter((r) => r.has_full).length,
            });
          }

          if (cancelled) {
            await finish("cancelado");
            return Response.json({ ok: true, cancelled: true, processed });
          }
          if (budgetOut) break;
        }

        if (done) {
          await finish("concluido");
          return Response.json({ ok: true, finished: true, processed });
        }

        // Registra o próximo ciclo antes de responder. Uma chamada fetch sem
        // espera pode ser encerrada junto com este Worker e deixar o job parado.
        const { error: enqueueError } = await enqueueTick(worker);
        if (enqueueError) {
          await supabaseAdmin
            .from("ml_map_jobs")
            .update({
              error: `Falha ao agendar próximo ciclo: ${enqueueError.message}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);
          return Response.json({ ok: false, error: enqueueError.message }, { status: 500 });
        }

        return Response.json({ ok: true, processed, continues: true });
      },
    },
  },
});
