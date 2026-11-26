import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";
import { z } from "zod";

const BATCH = 4;
const CONCURRENCY = 4;
const TIME_BUDGET_MS = 22_000;

function trim(v: string | null | undefined) {
  return (v ?? "").trim();
}

function sameSecret(received: string, expected: string) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/mercadolivre/prospect-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = trim(process.env.BLING_WORKER_SECRET);
        const provided = trim(request.headers.get("x-worker-secret"));
        const ok = !!secret && sameSecret(provided, secret);
        if (!ok) return new Response("Forbidden", { status: 403 });

        const parsed = z
          .object({ job_id: z.string().uuid() })
          .safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Invalid request", { status: 400 });
        const body = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as unknown as {
          from: (t: string) => any;
          rpc: (fn: string, args: Record<string, unknown>) => any;
        };
        const { getMlAccessToken } = await import("@/lib/mercadolivre.server");
        const { discoverNext, initialDiscovery, evaluateCandidate, MlProspectAccessError } = await import("@/lib/ml-prospect.server");
        const { isOffersListPath, offersStillBlocked, offersBlockedMessage, ML_OFFERS_RETRY_MS } = await import("@/lib/ml-prospect-block");
        const { MlTransientError } = await import("@/lib/ml-http.server");

        const { data: job } = await db
          .from("ml_prospect_jobs")
          .select("*")
          .eq("id", body.job_id)
          .maybeSingle();
        if (!job) return Response.json({ ok: false, error: "job_not_found" }, { status: 404 });
        if (["concluido", "cancelado", "erro"].includes(job.status)) {
          return Response.json({ ok: true, skipped: job.status });
        }

        const base = (process.env.APP_PUBLIC_URL ?? new URL(request.url).origin).replace(/\/$/, "");
        const enqueueTick = async () => {
          const result = await db.rpc("enqueue_http_job", {
            _url: `${base}/api/public/mercadolivre/prospect-tick`,
            _secret: secret,
            _body: { job_id: job.id },
          });
          if (result.error) throw new Error(`Falha ao agendar próximo ciclo: ${result.error.message}`);
          return result;
        };

        const finish = async (status: string, error?: string) => {
          await db
            .from("ml_prospect_jobs")
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

        // Garimpo pela Amazon: um ciclo = uma página da busca + uma consulta de ofertas Prime.
        if (job.params?.source === "amazon") {
          if (job.status === "pendente") {
            await db.from("ml_prospect_jobs").update({ status: "processando", started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
          }
          try {
            const { runAmazonProspectTick } = await import("@/lib/amazon-prospect.server");
            const res = await runAmazonProspectTick(db, job);
            if (res.status === "concluido") { await finish("concluido", res.message); return Response.json({ ok: true, finished: true }); }
            if (res.status === "aguardando") await db.from("ml_prospect_jobs").update({ error: res.message ?? null, updated_at: new Date().toISOString() }).eq("id", job.id);
            await enqueueTick();
            return Response.json({ ok: true, continues: true });
          } catch (e) {
            await finish("erro", e instanceof Error ? e.message : String(e));
            return Response.json({ ok: false });
          }
        }

        // ML bloqueou a lista de ofertas: espera a pausa acabar (o vigia chama a cada minuto).
        if (offersStillBlocked(job.params, Date.now())) {
          return Response.json({ ok: true, waiting: "ml_offers_blocked" });
        }

        let token: string;
        try {
          token = await getMlAccessToken();
        } catch (e) {
          await finish("erro", e instanceof Error ? e.message : String(e));
          return Response.json({ ok: false });
        }

        const params = job.params as {
          categories: string[];
          keywords: string[];
          max_cost: number;
          max_weight_kg: number;
          max_length_cm: number;
          zip_code: string;
        };

        const discover = async () => {
          const state = job.params.discovery ?? initialDiscovery(params);
          if (!state.categories.length && !state.keywords.length) return false;
          const step = await discoverNext(token, state);
          if (step.candidates.length) {
            const { error } = await db.from("ml_prospect_candidates").upsert(
              step.candidates.map(c => ({ ...c, job_id: job.id })),
              { onConflict: "job_id,catalog_product_id", ignoreDuplicates: true },
            );
            if (error) throw new Error(error.message);
          }
          const { count, error: countError } = await db.from("ml_prospect_candidates").select("id", { count: "exact", head: true }).eq("job_id", job.id);
          if (countError) throw new Error(countError.message);
          job.params = { ...job.params, discovery: step.state };
          const { error } = await db.from("ml_prospect_jobs").update({
            params: job.params, candidates_total: count ?? 0,
            status: "processando", updated_at: new Date().toISOString(),
          }).eq("id", job.id).eq("cancel_requested", false);
          if (error) throw new Error(error.message);
          return true;
        };

        // Limite do ML durante a descoberta: nada se perde, o próximo ciclo continua do mesmo ponto.
        const retryLater = async (e: Error) => {
          await db.from("ml_prospect_jobs").update({ error: e.message, updated_at: new Date().toISOString() }).eq("id", job.id);
          await enqueueTick();
          return Response.json({ ok: true, retry: "ml_rate_limited" });
        };

        // Persist discovery a category at a time; evaluate results before expanding.
        if (job.status === "pendente" || !job.params.discovery) {
          await db
            .from("ml_prospect_jobs")
            .update({
              status: "processando",
              started_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);
          try {
            await discover();
            await enqueueTick();
            return Response.json({ ok: true, discovering: true });
          } catch (e) {
            if (e instanceof MlTransientError) return await retryLater(e);
            await finish("erro", e instanceof Error ? e.message : String(e));
            return Response.json({ ok: false });
          }
        }

        const startedAt = Date.now();
        let processed = 0;
        let found = Number(job.found ?? 0);
        const target = Number(job.target ?? 100);

        while (Date.now() - startedAt < TIME_BUDGET_MS && found < target) {
          const { data: fresh } = await db
            .from("ml_prospect_jobs")
            .select("cancel_requested, found")
            .eq("id", job.id)
            .maybeSingle();
          if (fresh?.cancel_requested) {
            await finish("cancelado");
            return Response.json({ ok: true, cancelled: true, processed });
          }
          found = Number(fresh?.found ?? found);
          if (found >= target) break;

          const { data: claimed, error: claimError } = await db.rpc("ml_prospect_claim", {
            _job_id: job.id,
            _limit: BATCH,
          });
          if (claimError) {
            await finish("erro", claimError.message);
            return Response.json({ ok: false, error: claimError.message });
          }
          const batch = (claimed ?? []) as Array<{ id: number; catalog_product_id: string }>;
          if (batch.length === 0) {
            try {
              if (await discover()) {
                await enqueueTick();
                return Response.json({ ok: true, discovering: true, found });
              }
            } catch (e) {
              if (e instanceof MlTransientError) return await retryLater(e);
              await finish("erro", e instanceof Error ? e.message : String(e));
              return Response.json({ ok: false });
            }
            await finish("concluido", `Busca esgotada nos resultados acessíveis do Mercado Livre: ${found} de ${target} produtos encontrados.`);
            return Response.json({ ok: true, finished: true, processed });
          }

          for (let i = 0; i < batch.length; i += CONCURRENCY) {
            if (found >= target) break;
            // Cancelamento vale na hora: confere antes de cada pequeno lote.
            const { data: check } = await db
              .from("ml_prospect_jobs")
              .select("cancel_requested, status")
              .eq("id", job.id)
              .maybeSingle();
            if (check?.cancel_requested || check?.status === "cancelado") {
              await finish("cancelado");
              return Response.json({ ok: true, cancelled: true, processed });
            }
            const chunk = batch.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
              chunk.map(async (c) => {
                try {
                  return { c, blocked: false, retry: false, detail: null, res: await evaluateCandidate(token, c.catalog_product_id, params) };
                } catch (e) {
                  return {
                    c,
                    // Bloqueio da lista de ofertas não é defeito do produto: volta para a fila.
                    blocked: e instanceof MlProspectAccessError && isOffersListPath(e.path),
                    detail: e instanceof MlProspectAccessError ? e.detail : null,
                    // Limite de consultas (429) ou instabilidade: volta para a fila sem pausar a busca.
                    retry: e instanceof MlTransientError,
                    res: { ok: false as const, reason: e instanceof Error ? e.message : String(e) },
                  };
                }
              }),
            );

            const approved = results.filter((r) => r.res.ok) as Array<{
              c: { id: number; catalog_product_id: string };
              res: { ok: true; row: Record<string, unknown>; ean: string | null };
            }>;

            // Descarta o que a conta já tem: mesmo EAN (quando o ML publica) ou
            // mesmo produto de catálogo já mapeado para algum SKU nosso.
            const dupes = new Set<string>();
            const dupeCatalog = new Set<string>();
            if (approved.length > 0) {
              const eans = approved
                .map((a) => a.res.ean)
                .filter((e): e is string => !!e && e.length >= 8);
              if (eans.length > 0) {
                const { data: existing } = await db
                  .from("bling_products")
                  .select("gtin, gtin_embalagem")
                  .or(`gtin.in.(${eans.join(",")}),gtin_embalagem.in.(${eans.join(",")})`);
                for (const r of (existing ?? []) as Array<{
                  gtin: string | null;
                  gtin_embalagem: string | null;
                }>) {
                  for (const v of [r.gtin, r.gtin_embalagem]) {
                    const clean = (v ?? "").replace(/\D/g, "");
                    if (clean) dupes.add(clean);
                  }
                }
              }
              const catalogIds = approved.map((a) => a.c.catalog_product_id);
              const { data: mapped } = await db
                .from("ml_product_matches")
                .select("catalog_product_id")
                .in("catalog_product_id", catalogIds);
              for (const r of (mapped ?? []) as Array<{ catalog_product_id: string | null }>) {
                if (r.catalog_product_id) dupeCatalog.add(r.catalog_product_id);
              }
            }

            const keep = approved
              .filter(
                (a) =>
                  !(a.res.ean && dupes.has(a.res.ean)) &&
                  !dupeCatalog.has(a.c.catalog_product_id),
              )
              .slice(0, Math.max(0, target - found));
            if (keep.length > 0) {
              // Fiscal data only from an exact supplier barcode, never title similarity.
              const { lookupProspectNcm, completeProspectPictures } = await import("@/lib/ml-prospect-fiscal.server");
              const rows = await Promise.all(
                keep.map(async (a) => {
                  const row = a.res.row as Record<string, unknown>;
                  let ncm: string | null = null;
                  let cest: string | null = null;
                  let fonte: string | null = null;
                  try {
                    const hit = await lookupProspectNcm(a.res.ean);
                    if (hit?.ncm) {
                      ncm = hit.ncm;
                      fonte = hit.source;
                    }
                  } catch {
                    /* sem sugestão */
                  }
                  let photos: Record<string, unknown> = {};
                  try {
                    const done = await completeProspectPictures(a.res.ean, row.pictures);
                    if (done.added > 0) photos = { pictures: done.pictures, pictures_count: done.pictures.length, thumbnail: row.thumbnail ?? done.pictures[0] ?? null };
                  } catch {
                    /* fotos conferidas de novo no cadastro */
                  }
                  return { ...row, ...photos, ncm, cest, ncm_fonte: fonte, job_id: job.id };
                }),
              );
              const { error: saveError } = await db
                .from("ml_prospect_items")
                .upsert(rows, { onConflict: "job_id,catalog_product_id" });
              if (saveError) {
                await finish("erro", saveError.message);
                return Response.json({ ok: false });
              }
              found += keep.length;
            }

            const blockedIds = results.filter((r) => r.blocked).map((r) => r.c.id);
            const retryIds = results.filter((r) => r.retry && !r.blocked).map((r) => r.c.id);
            const statusRows = results.filter((r) => !r.blocked && !r.retry).map(({ c, res }) => {
              const approvedRow = keep.find((k) => k.c.id === c.id);
              const dup = res.ok && !approvedRow;
              return {
                id: c.id,
                status: approvedRow ? "aprovado" : "descartado",
                reason: approvedRow ? null : dup ? "já existe na conta" : (res as { reason: string }).reason,
              };
            });
            for (const row of statusRows) {
              await db
                .from("ml_prospect_candidates")
                .update({ status: row.status, reason: row.reason })
                .eq("id", row.id);
            }

            if (blockedIds.length > 0) {
              const { error: backError } = await db.from("ml_prospect_candidates").update({ status: "pendente", reason: null }).in("id", blockedIds);
              if (backError) throw new Error(backError.message);
            }
            if (retryIds.length > 0) {
              const { error: retryError } = await db.from("ml_prospect_candidates").update({ status: "pendente", reason: null }).in("id", retryIds);
              if (retryError) throw new Error(retryError.message);
            }
            processed += chunk.length - blockedIds.length - retryIds.length;
            const wasBlocked = !!(job.params as Record<string, unknown>)?.["ml_offers_blocked_until"];
            const update: Record<string, unknown> = {
              processed: Number(job.processed ?? 0) + processed,
              found,
              updated_at: new Date().toISOString(),
            };
            if (blockedIds.length > 0) {
              const retryAt = new Date(Date.now() + ML_OFFERS_RETRY_MS);
              // Guia "Erro 403" do ML: confere aplicativo, conta e a mesma consulta sem token para achar a causa.
              const detail = results.find((r) => r.blocked && r.detail)?.detail ?? null;
              let block: Record<string, unknown> | null = null;
              if (detail) {
                const { diagnoseMl403 } = await import("@/lib/ml-403.server");
                const { ml403Summary } = await import("@/lib/ml-403");
                const why = await diagnoseMl403(token, detail).catch(() => null);
                block = {
                  at: new Date().toISOString(), path: detail.path, code: detail.code, message: detail.message,
                  blocked_by: detail.blockedBy, request_id: detail.requestId,
                  reason: why?.reason ?? null, text: why ? ml403Summary(why) : null, diagnosis: why?.diagnosis ?? null,
                };
              }
              job.params = { ...job.params, ml_offers_blocked_until: retryAt.toISOString(), ...(block ? { ml_offers_block: block } : {}) };
              update["params"] = job.params;
              update["error"] = offersBlockedMessage(retryAt, (block?.["text"] as string | null) ?? null);
            } else if (wasBlocked) {
              const { ml_offers_blocked_until: _drop, ml_offers_block: _dropBlock, ...rest } = job.params as Record<string, unknown>;
              job.params = rest;
              update["params"] = rest;
              update["error"] = null;
            } else if (retryIds.length < chunk.length && job.error) {
              update["error"] = null;
            }
            await db.from("ml_prospect_jobs").update(update).eq("id", job.id);
            if (blockedIds.length > 0) {
              // Sem novo ciclo agora: o vigia retoma depois da pausa.
              return Response.json({ ok: true, paused: "ml_offers_blocked", processed, found });
            }
            // Continue in a fresh invocation, keeping counts visible after each chunk.
            break;
          }
          break;
        }

        if (found >= target) {
          await finish("concluido");
          return Response.json({ ok: true, finished: true, found, processed });
        }

        try {
          await enqueueTick();
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await db
            .from("ml_prospect_jobs")
            .update({
              error: message,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
        return Response.json({ ok: true, processed, found, continues: true });
      },
    },
  },
});
