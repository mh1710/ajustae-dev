import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { excludedProspectType, usesAllProspectCategories } from "./ml-prospect-scope";

type Db = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

async function admin(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

async function assertProspectAccess(context: { supabase: any; userId: string }, companyId: string) {
  const [{ data: member, error }, { data: roles, error: roleError }] = await Promise.all([
    context.supabase.from("company_users").select("id").eq("company_id", companyId).eq("user_id", context.userId).eq("ativo", true).maybeSingle(),
    context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
  ]);
  if (error || roleError || !member || (roles ?? []).some((r: { role: string }) => r.role === "company_viewer")) throw new Error("Sem permissão para importar produtos nesta empresa.");
}

/** Categorias de topo do Mercado Livre (para escolher onde garimpar). */
export const listMlCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getMlAccessToken } = await import("@/lib/mercadolivre.server");
    const { listSiteCategories } = await import("@/lib/ml-prospect.server");
    const token = await getMlAccessToken();
    return await listSiteCategories(token);
  });

export const startProspect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        source: z.enum(["mercadolivre", "amazon"]).default("mercadolivre"),
        departments: z.array(z.string().regex(/^\d+$/)).default([]),
        categories: z.array(z.string().trim().min(1)).default([]),
        all_categories: z.boolean().default(false),
        keywords: z.array(z.string().trim().min(1)).default([]),
        target: z.number().int().min(1).max(1000).default(100),
        max_cost: z.number().positive().default(1000),
        max_weight_kg: z.number().positive().max(30).default(30),
        max_length_cm: z.number().positive().max(70).default(70),
        require_measures: z.boolean().default(false),
        quick_collect: z.boolean().default(false),
        shipping_mode: z.enum(["full", "tomorrow", "deadline"]).default("full"),
        max_delivery_days: z.number().int().min(1).max(30).default(3),
        zip_code: z.string().trim().regex(/^\d{5}-?\d{3}$/, "Informe um CEP válido com oito dígitos.").optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { DEFAULT_ZIP } = await import("@/lib/mercadolivre.server");

    const { data: running } = await db
      .from("ml_prospect_jobs")
      .select("id")
      .in("status", ["pendente", "processando"])
      .limit(1)
      .maybeSingle();
    if (running?.id) return { job_id: running.id as string, already_running: true };

    let params: Record<string, unknown>;
    if (data.source === "amazon") {
      const { amazonConfigured } = await import("@/lib/amazon-catalog.server");
      if (!amazonConfigured()) throw new Error("A conexão com a Amazon não está configurada.");
      const { AMAZON_DEPARTMENTS } = await import("@/lib/amazon-prospect");
      const departments = data.all_categories ? [] : data.departments.filter(id => AMAZON_DEPARTMENTS.some(d => d.id === id));
      params = {
        source: "amazon", departments, all_categories: departments.length === 0 && data.keywords.length === 0,
        keywords: data.keywords, categories: [], max_cost: data.max_cost, max_weight_kg: data.max_weight_kg, max_length_cm: data.max_length_cm,
        require_measures: data.quick_collect ? false : data.require_measures, quick_collect: data.quick_collect, shipping_mode: "prime", zip_code: DEFAULT_ZIP,
      };
    } else {
    const allCategories = usesAllProspectCategories(data.categories, data.keywords, data.all_categories);
    let categoryIds = data.categories;
    if (allCategories) {
      const { getMlAccessToken } = await import("@/lib/mercadolivre.server");
      const { listSiteCategories } = await import("@/lib/ml-prospect.server");
      const roots = await listSiteCategories(await getMlAccessToken());
      if (!roots.length) throw new Error("Não foi possível consultar as categorias do Mercado Livre. Tente novamente.");
      categoryIds = roots.filter(c => !excludedProspectType(null, c.name, null)).map(c => c.id);
      if (!categoryIds.length) throw new Error("Nenhuma categoria de objetos disponível para consulta.");
    }

    params = {
      categories: categoryIds,
      all_categories: allCategories,
      keywords: data.keywords,
      max_cost: data.max_cost,
      max_weight_kg: data.max_weight_kg,
      max_length_cm: data.max_length_cm,
      require_measures: data.quick_collect ? false : data.require_measures,
      quick_collect: data.quick_collect,
      shipping_mode: data.shipping_mode,
      max_delivery_days: data.max_delivery_days,
      zip_code: data.zip_code ? data.zip_code.replace(/\D/g, "") : DEFAULT_ZIP,
    };
    }

    const { data: job, error } = await db
      .from("ml_prospect_jobs")
      .insert({
        created_by: context.userId,
        status: "pendente",
        target: data.target,
        params,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const base = (process.env.APP_PUBLIC_URL ?? "https://cloud-free-auditor.lovable.app").replace(
      /\/$/,
      "",
    );
    const secret = (process.env.BLING_WORKER_SECRET ?? "").trim();
    await db.rpc("enqueue_http_job", {
      _url: `${base}/api/public/mercadolivre/prospect-tick`,
      _secret: secret,
      _body: { job_id: job.id },
    });

    return { job_id: job.id as string, already_running: false };
  });

export const getProspectJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ job_id: z.string().uuid().optional() }).parse(data ?? {}),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const q = db
      .from("ml_prospect_jobs")
      .select(
        "id, status, target, found, processed, candidates_total, params, error, created_at, finished_at",
      )
      .order("created_at", { ascending: false })
      .limit(1);
    const { data: rows } = data.job_id ? await q.eq("id", data.job_id) : await q;
    return (rows ?? [])[0] ?? null;
  });

export const cancelProspect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ job_id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const db = await admin();
    const now = new Date().toISOString();
    // Encerra na hora: o job já fica "cancelado" e o worker para no próximo
    // passo (ele confere cancelamento a cada lote).
    await db
      .from("ml_prospect_jobs")
      .update({
        cancel_requested: true,
        status: "cancelado",
        finished_at: now,
        updated_at: now,
      })
      .eq("id", data.job_id);
    // Libera candidatos que ficaram reservados para o ciclo interrompido.
    await db
      .from("ml_prospect_candidates")
      .update({ status: "descartado", reason: "garimpo cancelado" })
      .eq("job_id", data.job_id)
      .not("status", "in", "(aprovado,descartado)");
    return { ok: true };
  });

/**
 * Importa itens garimpados como produtos da empresa:
 *  - SKU = "ML" + número do produto de catálogo (estável entre vendedores);
 *  - custo = preço de venda do Mercado Livre; preço de venda calculado pela
 *    mesma regra de precificação dos demais fornecedores;
 *  - garantia 3 meses, crossdocking 3, Anvisa isento;
 *  - valores revisados, todas as regras aprovadas e fila de criação atômica.
 */
export const importProspectItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        item_ids: z.array(z.string().uuid()).min(1).max(1),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertProspectAccess(context, data.company_id);
    const db = await admin();
    const { data: staged, error: stagedError } = await db.from("ml_prospect_items").select("*").in("id", data.item_ids);
    if (stagedError || !staged?.length) throw new Error(stagedError?.message ?? "Produto garimpado não encontrado.");
    const { reviewProspect } = await import("@/lib/ml-prospect-review.server");
    const { evaluateCandidate } = await import("@/lib/ml-prospect.server");
    const { getMlAccessToken } = await import("@/lib/mercadolivre.server");
    const { assertNoActiveSync } = await import("@/lib/sync-lock.server");
    // Previous imports of this batch are already in the Bling send queue; only other syncs block.
    await assertNoActiveSync(data.company_id, ["envio"]);
    const item = staged[0];
    const { data: job } = await db.from("ml_prospect_jobs").select("params").eq("id", item.job_id).single();
    // Offer, price and delivery are rechecked live; measures gathered in preparation/review fill what ML omits.
    const { MlProspectAccessError } = await import("@/lib/ml-prospect.server");
    const { isOffersListPath } = await import("@/lib/ml-prospect-block");
    const { isAmazonProspect } = await import("@/lib/amazon-prospect");
    const amazon = isAmazonProspect(item);
    const fresh = amazon
      ? await (await import("@/lib/amazon-prospect.server")).freshAmazonOffer(item, job.params)
      : await evaluateCandidate(await getMlAccessToken(), item.catalog_product_id, { ...job.params, require_measures: false }).catch(async (e) => {
      const mlToken = await getMlAccessToken();
      if (e instanceof MlProspectAccessError && isOffersListPath(e.path)) {
        const { diagnoseMl403 } = await import("@/lib/ml-403.server");
        const { ml403Summary } = await import("@/lib/ml-403");
        const why = e.detail ? await diagnoseMl403(mlToken, e.detail).catch(() => null) : null;
        throw new Error(`O Mercado Livre está bloqueando a consulta de ofertas (403).${why ? ` Motivo: ${ml403Summary(why)}` : ""} O produto continua na lista. Tente importar mais tarde.`);
      }
      throw e;
    });
    if (!fresh.ok) throw new Error(`Oferta não aprovada: ${fresh.reason}`);
    // Keep fiscal review only for the same exact product identity.
    if (item.ean && fresh.row.ean && item.ean !== fresh.row.ean) throw new Error("EAN mudou; revise o produto novamente.");
    const { keepPreparedMeasures, measureLimitIssue, prospectLimits } = await import("@/lib/ml-prospect-prepare");
    const kept = keepPreparedMeasures(fresh.row, item);
    if (!kept.complete) throw new Error("Peso e medidas incompletos; o produto não pode ir ao Bling.");
    const limits = prospectLimits(job.params);
    const limitIssue = measureLimitIssue(kept.measures, limits.maxWeightKg, limits.maxLengthCm);
    if (limitIssue) throw new Error(limitIssue);
    const refreshedRaw = { ...fresh.row.raw, review: item.raw?.review, prepared: item.raw?.prepared, measurement_sources: { ...(item.raw?.measurement_sources ?? {}), ...((fresh.row.raw as any)?.measurement_sources ?? {}) } };
    const { completeProspectPictures } = await import("@/lib/ml-prospect-fiscal.server");
    // Photos gathered in preparation (supplier/Amazon by exact EAN) stay after the live ML photos.
    const { mergeProspectPictures } = await import("@/lib/ml-prospect-photos");
    const photos = await completeProspectPictures(fresh.row.ean, mergeProspectPictures(fresh.row.pictures, Array.isArray(item.pictures) ? item.pictures : []));
    const pictures = photos.pictures.slice(0, 18);
    const { error: refreshError } = await db.from("ml_prospect_items").update({ ...fresh.row, ...kept.measures, marca: fresh.row.marca || item.marca, pictures, pictures_count: pictures.length, thumbnail: fresh.row.thumbnail ?? pictures[0] ?? null, raw: refreshedRaw }).eq("id", item.id);
    if (refreshError) throw new Error(refreshError.message);
    // The ML prefix needs its supplier contact in this company's Bling before the product can be linked.
    const { ensureProspectSupplier } = await import("@/lib/ml-prospect-supplier.server");
    await ensureProspectSupplier(data.company_id, { create: true }, amazon ? "amazon" : "mercadolivre");
    const { data: snapshot, error: snapshotError } = await db.from("ml_prospect_items").select("*").eq("id", item.id).single();
    if (snapshotError) throw new Error(snapshotError.message);
    const approval = await reviewProspect(data.company_id, snapshot, true);
    if (approval.issues.length) throw new Error(approval.issues.map(x => x.message).join(" · "));
    const { error: approvalError } = await db.from("ml_prospect_approvals").upsert({ company_id: data.company_id, item_id: item.id, item_snapshot: snapshot, sale_price: approval.price, expires_at: new Date(Date.now() + 120_000).toISOString() });
    if (approvalError) throw new Error(approvalError.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: res, error } = await (context.supabase as any).rpc(amazon ? "import_amazon_prospect_items" : "import_ml_prospect_items", {
      _company_id: data.company_id,
      _item_ids: data.item_ids,
    });
    if (error) throw new Error(error.message);

    const createdIds = Array.isArray((res as { product_ids?: unknown })?.product_ids) ? (res as { product_ids: string[] }).product_ids : [];
    try {
      const { refreshProspectStock } = await import("@/lib/ml-prospect-stock.server");
      // Amazon products get their stock from the Prime offer checked a moment ago (import RPC).
      if (!amazon) await refreshProspectStock(data.company_id, createdIds);
      else await db.rpc("enqueue_ml_prospect_stock", { _company_id: data.company_id, _product_ids: createdIds });
    } catch { /* stock computed at import stays; the daily refresh rechecks */ }

    const base = (process.env.APP_PUBLIC_URL ?? "").replace(/\/$/, "");
    const secret = process.env.BLING_WORKER_SECRET ?? "";
    if (base && secret) await db.rpc("enqueue_http_job", { _url: `${base}/api/public/bling/push-dispatch`, _secret: secret, _body: {} });

    const result = (res ?? {}) as {
      imported?: number;
      skipped?: number;
      product_ids?: string[];
      skus?: string[];
    };
    const productIds = Array.isArray(result.product_ids) ? result.product_ids : [];

    const priced = { price_updated: productIds.length, unchanged: 0 };
    const pricing_error = null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Reviewed values are final: no AI mutation after audit approval.
    const titles = { shortened: 0, kept: productIds.length, failed: 0 };
    const anatel = { resolved: 0, isento: 0, pending: 0 };

    // Mantém o contador do card "Mercado Livre" em Fornecedores atualizado.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adminAny = supabaseAdmin as any;
      const { data: forn } = await adminAny
        .from("fornecedores")
        .select("id")
        .eq("codigo", amazon ? "amazon" : "mercadolivre")
        .maybeSingle();
      if (forn?.id) {
        const { count } = await adminAny
          .from("fornecedor_produtos")
          .select("id", { count: "exact", head: true })
          .eq("fornecedor_id", forn.id)
          .eq("ativo", true);
        await adminAny
          .from("fornecedores")
          .update({
            product_count: Number(count ?? 0),
            last_sync_at: new Date().toISOString(),
            last_sync_status: "ok",
          })
          .eq("id", forn.id);
      }
    } catch {
      /* contador é informativo */
    }

    return {
      imported: Number(result.imported ?? 0),
      skipped: Number(result.skipped ?? 0),
      skus: result.skus ?? [],
      product_ids: productIds,
      priced,
      pricing_error,
      titles,
      anatel,
    };
  });

export const listProspectItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        page: z.number().int().min(1).default(1),
        page_size: z.number().int().min(1).max(200).default(50),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const from = (data.page - 1) * data.page_size;
    const { data: rows, count } = await db
      .from("ml_prospect_items")
      .select("*", { count: "exact" })
      .eq("job_id", data.job_id)
      .order("total_price", { ascending: true })
      .range(from, from + data.page_size - 1);
    return { rows: rows ?? [], total: Number(count ?? 0) };
  });

export const reviewProspectItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    company_id: z.string().uuid(), item_id: z.string().uuid(), titulo: z.string().trim().min(1).max(60), ncm: z.string().trim().min(1),
    anatel: z.string().trim().min(1), descricao_curta: z.string().trim().min(1), ncm_confirmed: z.literal(true), anatel_confirmed: z.literal(true),
    marca: z.string().trim().min(1).max(120).optional(),
    weight_kg: z.number().positive().max(1000).optional(), length_cm: z.number().positive().max(1000).optional(),
    width_cm: z.number().positive().max(1000).optional(), height_cm: z.number().positive().max(1000).optional(),
  }).parse(data))
  .handler(async ({ data, context }) => {
    await assertProspectAccess(context, data.company_id);
    const db = await admin();
    const { data: item, error } = await db.from("ml_prospect_items").select("*").eq("id", data.item_id).single();
    if (error || !item) throw new Error(error?.message ?? "Produto não encontrado.");
    const { normalizeAnatel, normalizeNcm } = await import("@/lib/ml-prospect-prepare");
    const ncm = normalizeNcm(data.ncm);
    if (!ncm) throw new Error("NCM precisa ter 8 dígitos.");
    const anatel = normalizeAnatel(data.anatel);
    if (!anatel) throw new Error("Anatel precisa ser um código NNNNN-NN-NNNNN ou Não se aplica.");
    const sources = { ...(item.raw?.measurement_sources ?? {}) } as Record<string, unknown>;
    const measures: Record<string, number> = {};
    for (const key of ["weight_kg", "length_cm", "width_cm", "height_cm"] as const) {
      const value = data[key];
      if (value === undefined || Number(item[key]) === value) continue;
      measures[key] = value;
      sources[key] = "Informado na revisão";
    }
    const raw = { ...item.raw, measurement_sources: sources, review: { titulo: data.titulo, anatel, descricao_curta: data.descricao_curta, ncm_confirmed: true, anatel_confirmed: true } };
    const ncmFonte = ncm === normalizeNcm(item.ncm) ? item.ncm_fonte : "Informado na revisão";
    const update = { ncm, ncm_fonte: ncmFonte, raw, ...measures, ...(data.marca ? { marca: data.marca } : {}) };
    const { error: saveError } = await db.from("ml_prospect_items").update(update).eq("id", item.id);
    if (saveError) throw new Error(saveError.message);
    const { reviewProspect } = await import("@/lib/ml-prospect-review.server");
    return await reviewProspect(data.company_id, { ...item, ...update }, false);
  });

/** Busca todos os dados que a auditoria exige (fornecedores, Bling, catálogo do Mercado Livre e Amazon pelo mesmo EAN; sem IA) e devolve as pendências. */
export const prepareProspectItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ company_id: z.string().uuid(), item_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertProspectAccess(context, data.company_id);
    const { prepareProspect } = await import("@/lib/ml-prospect-prepare.server");
    return await prepareProspect(data.company_id, data.item_id);
  });

export const enrichProspectItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ company_id: z.string().uuid(), item_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertProspectAccess(context, data.company_id);
    const db = await admin();
    const { data: item, error } = await db.from("ml_prospect_items").select("*").eq("id", data.item_id).single();
    if (error || !item) throw new Error("Produto não encontrado.");
    const { getMlAccessToken } = await import("@/lib/mercadolivre.server");
    const { mlGetJson, resolveProspectIdentity } = await import("@/lib/ml-prospect.server");
    const { lookupProspectNcm } = await import("@/lib/ml-prospect-fiscal.server");
    const token = await getMlAccessToken();
    const product = await mlGetJson(token, `https://api.mercadolibre.com/products/${item.catalog_product_id}`);
    if (!product) throw new Error("Catálogo não encontrado no Mercado Livre.");
    const identity = await resolveProspectIdentity(token, item.catalog_product_id, item.item_id, product);
    if (item.ean && identity.ean && item.ean !== identity.ean) throw new Error("EAN divergente; a revisão anterior foi preservada.");
    const fiscal = await lookupProspectNcm(identity.ean);
    const reviewed = item.raw?.review?.ncm_confirmed === true;
    const ncm = reviewed ? item.ncm : fiscal?.ncm ?? null;
    const raw = { ...item.raw, product, item: identity.item, identity: { ean_source: identity.source } };
    const { error: saveError } = await db.from("ml_prospect_items").update({
      ean: identity.ean, ncm, ncm_fonte: reviewed ? item.ncm_fonte : fiscal?.source ?? null,
      cest: reviewed ? item.cest : null, raw,
    }).eq("id", item.id);
    if (saveError) throw new Error(saveError.message);
    return { ean: identity.ean, ncm, ncm_fonte: reviewed ? item.ncm_fonte : fiscal?.source ?? null };
  });
