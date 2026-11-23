import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";
import { z } from "zod";

const BATCH = 6;
const CONCURRENCY = 6;
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
        const { discoverNext, initialDiscovery, evaluateCandidate } = await import("@/lib/ml-prospect.server");

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
                  return { c, res: await evaluateCandidate(token, c.catalog_product_id, params) };
                } catch (e) {
                  return {
                    c,
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

            const statusRows = results.map(({ c, res }) => {
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

            processed += chunk.length;
            await db
              .from("ml_prospect_jobs")
              .update({
                processed: Number(job.processed ?? 0) + processed,
                found,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            // Continue in a fresh invocation, keeping counts visible after each six.
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
