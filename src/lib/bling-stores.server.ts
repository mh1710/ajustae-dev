// Worker helpers to sync Bling product-store links + channels + intermediador names.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blingApiGet, type BlingIntegrationRow } from "./bling.server";

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_TICK = 1;

type BatchOutcome = {
  processed?: number;
  inserted?: number;
  updated?: number;
  matched?: number;
  unmatched?: number;
  errors?: number;
};

async function loadIntegration(id: string): Promise<BlingIntegrationRow | null> {
  const { data } = await supabaseAdmin
    .from("bling_integrations")
    .select("id, company_id, access_token, refresh_token, token_expires_at, status")
    .eq("id", id)
    .maybeSingle();
  return (data as BlingIntegrationRow) ?? null;
}

export async function isCancelled(jobId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("bling_store_sync_jobs")
    .select("cancel_requested, status")
    .eq("id", jobId)
    .maybeSingle();
  return !!(data && ((data as any).cancel_requested || (data as any).status === "cancelando" || (data as any).status === "cancelada"));
}

/** Pausa: o job fica guardado no ponto atual e não deve ser processado. */
export async function isPaused(jobId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("bling_store_sync_jobs")
    .select("status")
    .eq("id", jobId)
    .maybeSingle();
  return (data as any)?.status === "pausada";
}



function pickNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (v == null || v === "") continue;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}
function pickStr(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}
function stringId(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object") {
    const anyv = v as Record<string, unknown>;
    if (anyv.id != null) return String(anyv.id);
  }
  return String(v);
}

function digitsOnly(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = String(v).replace(/\D+/g, "");
  return d.length >= 8 ? d : null;
}

/** Known marketplace intermediators (by CNPJ, digits only). */
const INTERMEDIATOR_HINTS: Record<string, string> = {
  // Not authoritative — first hit wins if the API lookup fails.
  "03007331000141": "Mercado Livre",
  "10573521000191": "Amazon Serviços de Varejo do Brasil",
  "07206816000115": "Kabum",
  "05914650000166": "Magazine Luiza",
  "20155946000164": "Shopee",
  "19536392000109": "Webcontinental",
};

/** Try to resolve a CNPJ to a company name using BrasilAPI. */
async function lookupCnpjName(cnpj: string): Promise<string | null> {
  const clean = digitsOnly(cnpj);
  if (!clean) return null;
  if (INTERMEDIATOR_HINTS[clean]) return INTERMEDIATOR_HINTS[clean];
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return (data?.nome_fantasia || data?.razao_social || null) as string | null;
  } catch {
    return null;
  }
}

function normalizeLinkRow(raw: any): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const bling_product_store_id = pickStr(raw.id, raw.idProdutoLoja, raw.produtoLoja?.id);
  const bling_product_id = pickStr(stringId(raw.produto), raw.idProduto, raw.produto?.id);
  const bling_store_id = pickStr(stringId(raw.loja), raw.idLoja, raw.loja?.id);
  if (!bling_product_store_id || !bling_product_id || !bling_store_id) return null;

  return {
    bling_product_store_id,
    bling_product_id,
    bling_store_id,
    store_name: pickStr(raw.loja?.descricao, raw.descricao, raw.loja?.nome, raw.nomeLoja),
    store_type: pickStr(raw.loja?.tipo, raw.tipoLoja, raw.loja?.integracao),
    store_product_code: pickStr(raw.codigo, raw.sku, raw.produto?.codigo),
    current_price: pickNumber(raw.preco, raw.precoVenda, raw.valor),
    current_promotional_price: pickNumber(raw.precoPromocional, raw.promocional, raw.precoPromo),
    supplier_store_id: pickStr(stringId(raw.fornecedor), raw.fornecedor?.id),
    brand_store_id: pickStr(stringId(raw.marca), raw.marca?.id),
    categories_json: raw.categorias ?? raw.categoria ?? null,
    raw_data_json: raw,
    last_bling_update_at: pickStr(raw.dataAlteracao, raw.dataAtualizacao, raw.updatedAt),
  };
}

async function fetchLinksPage(
  integ: BlingIntegrationRow,
  page: number,
  filter: { bling_product_id?: string | null },
): Promise<{ ok: true; rows: any[]; hasMore: boolean } | { ok: false; error: string; status: number }> {
  const params = new URLSearchParams();
  params.set("pagina", String(page));
  params.set("limite", String(PAGE_LIMIT));
  if (filter.bling_product_id) params.set("idProduto", filter.bling_product_id);
  const res = await blingApiGet<any>(integ, `/produtos/lojas?${params.toString()}`);
  if (!res.ok) return { ok: false, error: res.errorMessage ?? `HTTP ${res.status}`, status: res.status };
  const data = res.data as any;
  const rows: any[] = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.retorno?.produtosLojas)
      ? data.retorno.produtosLojas
      : Array.isArray(data)
        ? data
        : [];
  // The Bling API can return fewer than `limite` rows on an intermediate page
  // (filtered/hidden links). Stopping on a short page truncates the sync, so we
  // only consider the listing finished when a page comes back completely empty.
  const hasMore = rows.length > 0;
  return { ok: true, rows, hasMore };
}

/** A "tipo" value from Bling that isn't specific enough to identify the marketplace. */
function isGenericTipo(t: string | null | undefined): boolean {
  if (!t) return true;
  const norm = String(t).trim().toLowerCase();
  return norm === "" || norm === "api" || norm === "manual" || norm === "outros" || norm === "outro";
}

/** Recursively collect every CNPJ-looking string (14 digits) found in an object. */
function collectCnpjs(node: unknown, out: Set<string>, depth = 0): void {
  if (!node || depth > 6) return;
  if (typeof node === "string") {
    const d = node.replace(/\D+/g, "");
    if (d.length === 14) out.add(d);
    return;
  }
  if (typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const v of node) collectCnpjs(v, out, depth + 1);
    return;
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    collectCnpjs(v, out, depth + 1);
  }
}

/** Resolve the real marketplace name from a channel detail payload. */
async function resolveChannelTipo(detail: any): Promise<string | null> {
  const rawTipo = pickStr(detail?.tipo);
  if (rawTipo && !isGenericTipo(rawTipo)) return rawTipo;

  // Walk the whole payload looking for CNPJs and match against known intermediators first.
  const cnpjs = new Set<string>();
  collectCnpjs(detail, cnpjs);

  // Pass 1: known intermediator hints (instant, offline).
  for (const c of cnpjs) {
    if (INTERMEDIATOR_HINTS[c]) return INTERMEDIATOR_HINTS[c];
  }
  // Pass 2: online CNPJ lookup via BrasilAPI.
  for (const c of cnpjs) {
    const name = await lookupCnpjName(c);
    if (name) return name;
  }

  return rawTipo; // return raw "Api" as last resort
}

/** Resolve store name/type for each row via /canais-venda/{id}, caching in bling_stores. */
const channelMemCache = new Map<string, { descricao: string | null; tipo: string | null }>();
async function enrichStoreNames(
  integ: BlingIntegrationRow,
  companyId: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const ids = Array.from(new Set(rows.map((r) => String(r.bling_store_id)).filter(Boolean)));
  if (ids.length === 0) return;

  const missing: string[] = [];
  for (const id of ids) {
    if (!channelMemCache.has(id)) missing.push(id);
  }
  if (missing.length > 0) {
    const { data: cached } = await supabaseAdmin
      .from("bling_stores")
      .select("bling_store_id, descricao, tipo")
      .eq("company_id", companyId)
      .in("bling_store_id", missing);
    for (const c of (cached as any[] | null) ?? []) {
      channelMemCache.set(String(c.bling_store_id), {
        descricao: c.descricao ?? null,
        tipo: c.tipo ?? null,
      });
    }
  }

  for (const id of ids) {
    if (channelMemCache.has(id)) continue;
    const res = await blingApiGet<any>(integ, `/canais-venda/${id}`);
    if (!res.ok) {
      channelMemCache.set(id, { descricao: null, tipo: null });
      continue;
    }
    const d = (res.data as any)?.data ?? {};
    const descricao = pickStr(d.descricao);
    const tipo = pickStr(d.tipo);
    channelMemCache.set(id, { descricao, tipo });
    try {
      await supabaseAdmin.rpc("upsert_bling_channel" as any, {
        _company_id: companyId,
        _integration_id: integ.id,
        _row: {
          bling_store_id: id,
          descricao,
          tipo,
          agrupador: pickNumber(d.agrupador),
          situacao: pickNumber(d.situacao),
          raw_json: d,
        } as any,
      } as any);
    } catch {
      // ignore cache write errors
    }
  }

  for (const row of rows) {
    const id = String(row.bling_store_id);
    const cached = channelMemCache.get(id);
    if (!cached) continue;
    if (!row.store_name && cached.descricao) row.store_name = cached.descricao;
    if (cached.tipo && !row.store_type) row.store_type = cached.tipo;
  }
}

/** Sync sales channels (/canais-venda) into public.bling_stores + backfill product_stores. */
export async function syncBlingChannels(integ: BlingIntegrationRow): Promise<{ channels: number }> {
  let page = 1;
  let count = 0;
  const seenCnpjs = new Set<string>();

  while (page < 20) {
    const res = await blingApiGet<any>(integ, `/canais-venda?pagina=${page}&limite=100`);
    if (!res.ok) break;
    const rows = (res.data as any)?.data as any[] | undefined;
    if (!rows || rows.length === 0) break;

    for (const raw of rows) {
      const bling_store_id = pickStr(raw.id);
      if (!bling_store_id) continue;
      // Fetch detail to get filiais/CNPJ if needed
      const detailRes = await blingApiGet<any>(integ, `/canais-venda/${bling_store_id}`);
      const detail = (detailRes.ok ? (detailRes.data as any)?.data : null) ?? raw;
      const filial = Array.isArray(detail?.filiais) ? detail.filiais.find((f: any) => f?.padrao) ?? detail.filiais[0] : null;
      const cnpj = digitsOnly(filial?.cnpj as string | undefined);

      let intermediador_nome: string | null = null;
      if (cnpj) {
        if (!seenCnpjs.has(cnpj)) {
          seenCnpjs.add(cnpj);
          intermediador_nome = await lookupCnpjName(cnpj);
        } else {
          intermediador_nome = INTERMEDIATOR_HINTS[cnpj] ?? null;
        }
      }

      const row = {
        bling_store_id,
        descricao: pickStr(detail?.descricao, raw?.descricao),
        tipo: pickStr(detail?.tipo, raw?.tipo),
        agrupador: pickNumber(detail?.agrupador, raw?.agrupador),
        situacao: pickNumber(detail?.situacao, raw?.situacao),
        cnpj_filial: cnpj,
        unidade_negocio: pickStr(filial?.unidadeNegocio),
        intermediador_cnpj: cnpj,
        intermediador_nome,
        raw_json: detail,
      };
      await supabaseAdmin.rpc("upsert_bling_channel" as any, {
        _company_id: integ.company_id,
        _integration_id: integ.id,
        _row: row as any,
      } as any);
      count++;
    }

    if (rows.length < 100) break;
    page++;
  }
  return { channels: count };
}

const MISSING_PRODUCTS_PER_TICK = 10;

/** Reprocess links only for products that still have no store link. */
async function processMissingTick(
  jobId: string,
  claimed: { company_id: string; integration_id: string; bling_product_id: string | null },
  integ: BlingIntegrationRow,
): Promise<{ done: boolean; processed_pages: number; next_page: number | null; cancelled?: boolean }> {
  if (!claimed.bling_product_id) {
    const { data: total } = await supabaseAdmin.rpc("count_products_without_stores" as any, {
      _company_id: claimed.company_id,
    } as any);
    await supabaseAdmin.rpc("set_bling_stores_job_total" as any, {
      _job_id: jobId, _total: Number(total ?? 0),
    } as any);
  }

  const { data: pending } = await supabaseAdmin.rpc("list_products_without_stores" as any, {
    _company_id: claimed.company_id,
    _limit: MISSING_PRODUCTS_PER_TICK,
    _offset: 0,
    _after: claimed.bling_product_id,
  } as any);
  const ids = ((pending as any[] | null) ?? [])
    .map((r) => String(r.bling_product_id))
    .filter(Boolean);

  if (ids.length === 0) {
    await supabaseAdmin.rpc("finish_bling_stores_job" as any, {
      _job_id: jobId, _status: "concluida", _last_error: null,
    } as any);
    return { done: true, processed_pages: 0, next_page: null };
  }

  let found = 0, inserted = 0, updated = 0, matched = 0, unmatched = 0, errors = 0;
  let lastError: string | null = null;

  for (const productId of ids) {
    if (await isCancelled(jobId)) {
      await supabaseAdmin.rpc("finish_bling_stores_job" as any, {
        _job_id: jobId, _status: "cancelada", _last_error: "Cancelado pelo usuário.",
      } as any);
      return { done: true, processed_pages: 0, next_page: null, cancelled: true };
    }
    const result = await fetchLinksPage(integ, 1, { bling_product_id: productId });

    if (!result.ok) {
      errors++;
      lastError = `Produto ${productId}: ${result.error}`;
      continue;
    }
    const rows = result.rows
      .map((raw) => normalizeLinkRow(raw))
      .filter((row): row is Record<string, unknown> => row !== null);
    errors += result.rows.length - rows.length;
    if (rows.length === 0) continue;

    await enrichStoreNames(integ, claimed.company_id, rows);
    const { data: batch, error: batchError } = await supabaseAdmin.rpc("upsert_bling_product_stores_batch" as any, {
      _company_id: claimed.company_id,
      _integration_id: claimed.integration_id,
      _run_id: jobId,
      _rows: rows as any,
    } as any);
    if (batchError) {
      errors++;
      lastError = `Produto ${productId}: ${batchError.message}`;
      continue;
    }
    const outcome = (batch ?? {}) as BatchOutcome;
    found += result.rows.length;
    inserted += Number(outcome.inserted ?? 0);
    updated += Number(outcome.updated ?? 0);
    matched += Number(outcome.matched ?? 0);
    unmatched += Number(outcome.unmatched ?? 0);
  }

  const cursor = ids[ids.length - 1] ?? null;
  await supabaseAdmin.rpc("set_bling_stores_job_cursor" as any, { _job_id: jobId, _cursor: cursor } as any);
  await supabaseAdmin.rpc("finish_bling_stores_page" as any, {
    _job_id: jobId, _page: 1, _total_pages: null,
    _found: found, _inserted: inserted, _updated: updated,
    _matched: matched, _unmatched: unmatched, _errors: errors,
    _next_page: null, _last_error: lastError,
  } as any);

  return { done: false, processed_pages: 1, next_page: 1 };
}


/** Registra (ou atualiza) uma página que falhou, para reprocessamento manual. */
async function recordPageError(args: {
  jobId: string; companyId: string; integrationId: string; scope: string;
  blingProductId: string | null; page: number; status: number | null; message: string;
}): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from("bling_store_sync_page_errors" as any)
    .select("id, attempts")
    .eq("job_id", args.jobId)
    .eq("page", args.page)
    .maybeSingle();
  if (existing) {
    await supabaseAdmin
      .from("bling_store_sync_page_errors" as any)
      .update({
        attempts: Number((existing as any).attempts ?? 1) + 1,
        http_status: args.status,
        error_message: args.message,
        resolved: false,
        resolved_at: null,
      } as any)
      .eq("id", (existing as any).id);
    return;
  }
  await supabaseAdmin.from("bling_store_sync_page_errors" as any).insert({
    job_id: args.jobId,
    company_id: args.companyId,
    integration_id: args.integrationId,
    scope: args.scope,
    bling_product_id: args.blingProductId,
    page: args.page,
    http_status: args.status,
    error_message: args.message,
  } as any);
}

/**
 * Recupera falhas de páginas que foram apenas contadas no job (versões antigas
 * do sincronizador) e ainda não aparecem na lista de erros reprocessáveis.
 */
export async function backfillStoreSyncPageErrors(companyId: string): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: jobs } = await supabaseAdmin
    .from("bling_store_sync_jobs" as any)
    .select("id, company_id, integration_id, scope, bling_product_id, erros, last_error")
    .eq("company_id", companyId)
    .gt("erros", 0)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);

  let created = 0;
  for (const j of ((jobs ?? []) as any[])) {
    const msg = String(j.last_error ?? "");
    const m = msg.match(/P[áa]gina\s+(\d+)\s*:?\s*/i);
    if (!m) continue;
    const page = Number(m[1]);
    if (!Number.isFinite(page) || page <= 0) continue;
    const { data: existing } = await supabaseAdmin
      .from("bling_store_sync_page_errors" as any)
      .select("id")
      .eq("job_id", j.id)
      .eq("page", page)
      .maybeSingle();
    if (existing) continue;
    await recordPageError({
      jobId: j.id,
      companyId: j.company_id,
      integrationId: j.integration_id,
      scope: j.scope ?? "full",
      blingProductId: j.bling_product_id ?? null,
      page,
      status: /429|TOO_MANY_REQUESTS/i.test(msg) ? 429 : null,
      message: msg.replace(/^P[áa]gina\s+\d+\s*:?\s*/i, "") || "Erro na página.",
    });
    created++;
  }
  return created;
}


/** Reprocessa uma única página que ficou com erro. */
export async function reprocessStoreSyncPage(errorId: string): Promise<{
  ok: boolean; page: number; found: number; saved: number; error?: string;
}> {
  const { data: row } = await supabaseAdmin
    .from("bling_store_sync_page_errors" as any)
    .select("*")
    .eq("id", errorId)
    .maybeSingle();
  if (!row) return { ok: false, page: 0, found: 0, saved: 0, error: "Erro não encontrado." };
  const e = row as any;

  await supabaseAdmin
    .from("bling_store_sync_page_errors" as any)
    .update({ last_retry_at: new Date().toISOString() } as any)
    .eq("id", errorId);

  const integ = await loadIntegration(e.integration_id);
  if (!integ || integ.status !== "conectada") {
    return { ok: false, page: e.page, found: 0, saved: 0, error: "Integração Bling não está conectada." };
  }

  const result = await fetchLinksPage(integ, e.page, { bling_product_id: e.bling_product_id });
  if (!result.ok) {
    await recordPageError({
      jobId: e.job_id, companyId: e.company_id, integrationId: e.integration_id,
      scope: e.scope, blingProductId: e.bling_product_id, page: e.page,
      status: result.status, message: result.error,
    });
    return { ok: false, page: e.page, found: 0, saved: 0, error: result.error };
  }

  const normalizedRows = result.rows
    .map((raw) => normalizeLinkRow(raw))
    .filter((r): r is Record<string, unknown> => r !== null);
  await enrichStoreNames(integ, e.company_id, normalizedRows);

  const { data: batch, error: batchError } = await supabaseAdmin.rpc("upsert_bling_product_stores_batch" as any, {
    _company_id: e.company_id,
    _integration_id: e.integration_id,
    _run_id: e.job_id,
    _rows: normalizedRows as any,
  } as any);
  if (batchError) {
    await recordPageError({
      jobId: e.job_id, companyId: e.company_id, integrationId: e.integration_id,
      scope: e.scope, blingProductId: e.bling_product_id, page: e.page,
      status: null, message: batchError.message,
    });
    return { ok: false, page: e.page, found: result.rows.length, saved: 0, error: batchError.message };
  }

  const outcome = (batch ?? {}) as BatchOutcome;
  const saved = Number(outcome.inserted ?? 0) + Number(outcome.updated ?? 0);

  await supabaseAdmin
    .from("bling_store_sync_page_errors" as any)
    .update({ resolved: true, resolved_at: new Date().toISOString(), error_message: null } as any)
    .eq("id", errorId);

  return { ok: true, page: e.page, found: result.rows.length, saved };
}

export async function processStoreSyncTick(jobId: string): Promise<{
  done: boolean;
  processed_pages: number;
  next_page: number | null;
  cancelled?: boolean;
}> {
  if (await isCancelled(jobId)) {
    await supabaseAdmin.rpc("finish_bling_stores_job" as any, {
      _job_id: jobId, _status: "cancelada", _last_error: "Cancelado.",
    });
    return { done: true, processed_pages: 0, next_page: null, cancelled: true };
  }
  if (await isPaused(jobId)) {
    return { done: true, processed_pages: 0, next_page: null, cancelled: true };
  }

  const { data: claimedArr } = await supabaseAdmin.rpc("claim_bling_stores_job" as any, { _job_id: jobId });
  const claimed = (claimedArr as any[] | null)?.[0];
  if (!claimed) return { done: false, processed_pages: 0, next_page: null };

  const integ = await loadIntegration(claimed.integration_id);
  if (!integ || integ.status !== "conectada") {
    await supabaseAdmin.rpc("finish_bling_stores_job" as any, {
      _job_id: jobId, _status: "erro", _last_error: "Integração não está conectada.",
    });
    return { done: true, processed_pages: 0, next_page: null };
  }

  // At the very start of a full sync, set an estimate before processing the first page.
  // Channel metadata is intentionally not fetched here because it can take long enough
  // to prevent the first progress update from being saved.
  if (claimed.proxima_pagina === 1 && claimed.scope === "full") {
    const { count } = await supabaseAdmin
      .from("bling_products")
      .select("id", { count: "exact", head: true })
      .eq("company_id", claimed.company_id);
    await supabaseAdmin.rpc("set_bling_stores_job_total" as any, {
      _job_id: jobId, _total: count ?? 0,
    });
  }

  let page: number = claimed.proxima_pagina ?? 1;
  let processed = 0;
  let done = false;

  // Scope "missing": reprocess only products that still have no store link.
  if (claimed.scope === "missing") {
    return await processMissingTick(jobId, claimed, integ);
  }

  for (let i = 0; i < MAX_PAGES_PER_TICK; i++) {
    if (await isCancelled(jobId)) {
      await supabaseAdmin.rpc("finish_bling_stores_job" as any, {
        _job_id: jobId, _status: "cancelada", _last_error: "Cancelado pelo usuário.",
      });
      return { done: true, processed_pages: processed, next_page: null, cancelled: true };
    }
    if (await isPaused(jobId)) {
      return { done: true, processed_pages: processed, next_page: null, cancelled: true };
    }


    const result = await fetchLinksPage(integ, page, { bling_product_id: claimed.bling_product_id });
    if (!result.ok) {
      // Credencial inválida trava tudo: aí sim encerramos o job.
      if (result.status === 401 || result.status === 403) {
        await supabaseAdmin.rpc("finish_bling_stores_job" as any, {
          _job_id: jobId, _status: "erro", _last_error: `Página ${page}: ${result.error}`,
        } as any);
        return { done: true, processed_pages: processed, next_page: null };
      }
      // Erro da página: empilha na lista de erros e segue para a próxima.
      await recordPageError({
        jobId, companyId: claimed.company_id, integrationId: claimed.integration_id,
        scope: claimed.scope ?? "full", blingProductId: claimed.bling_product_id ?? null,
        page, status: result.status, message: result.error,
      });
      await supabaseAdmin.rpc("finish_bling_stores_page" as any, {
        _job_id: jobId, _page: page, _total_pages: null, _found: 0,
        _inserted: 0, _updated: 0, _matched: 0, _unmatched: 0, _errors: 1,
        _next_page: page + 1, _last_error: `Página ${page}: ${result.error}`,
      } as any);
      return { done: false, processed_pages: processed, next_page: page + 1 };
    }

    const normalizedRows = result.rows
      .map((raw) => normalizeLinkRow(raw))
      .filter((row): row is Record<string, unknown> => row !== null);

    // Resolve store name/type via /canais-venda/{id}, cached in bling_stores.
    await enrichStoreNames(integ, claimed.company_id, normalizedRows);

    // Cancelamento pode ter chegado durante a chamada à API: pare antes de gravar.
    if (await isCancelled(jobId)) {
      await supabaseAdmin.rpc("finish_bling_stores_job" as any, {
        _job_id: jobId, _status: "cancelada", _last_error: "Cancelado pelo usuário.",
      } as any);
      return { done: true, processed_pages: processed, next_page: null, cancelled: true };
    }

    const invalidRows = result.rows.length - normalizedRows.length;
    const { data: batch, error: batchError } = await supabaseAdmin.rpc("upsert_bling_product_stores_batch" as any, {

      _company_id: claimed.company_id,
      _integration_id: claimed.integration_id,
      _run_id: jobId,
      _rows: normalizedRows as any,
    } as any);
    const outcome = (batch ?? {}) as BatchOutcome;
    const inserted = Number(outcome.inserted ?? 0);
    const updated = Number(outcome.updated ?? 0);
    const matched = Number(outcome.matched ?? 0);
    const unmatched = Number(outcome.unmatched ?? 0);

    if (batchError) {
      await recordPageError({
        jobId, companyId: claimed.company_id, integrationId: claimed.integration_id,
        scope: claimed.scope ?? "full", blingProductId: claimed.bling_product_id ?? null,
        page, status: null, message: batchError.message,
      });
      await supabaseAdmin.rpc("finish_bling_stores_page" as any, {
        _job_id: jobId, _page: page, _total_pages: null,
        _found: 0, _inserted: 0, _updated: 0,
        _matched: 0, _unmatched: 0, _errors: 1,
        _next_page: page + 1, _last_error: `Página ${page}: ${batchError.message}`,
      } as any);
      return { done: false, processed_pages: processed, next_page: page + 1 };
    }

    const errs = invalidRows + Number(outcome.errors ?? 0);

    await supabaseAdmin.rpc("finish_bling_stores_page" as any, {
      _job_id: jobId, _page: page, _total_pages: null,
      _found: result.rows.length, _inserted: inserted, _updated: updated,
      _matched: matched, _unmatched: unmatched, _errors: errs,
      _next_page: result.hasMore ? page + 1 : page, _last_error: null,
    } as any);
    processed++;

    if (!result.hasMore) {
      // Confirm the end of the listing: a single empty page can be a transient
      // API hiccup. Only finish when the following page is empty as well.
      const probe = await fetchLinksPage(integ, page + 1, { bling_product_id: claimed.bling_product_id });
      if (probe.ok && probe.rows.length > 0) {
        await supabaseAdmin.rpc("finish_bling_stores_page" as any, {
          _job_id: jobId, _page: page, _total_pages: null,
          _found: 0, _inserted: 0, _updated: 0, _matched: 0, _unmatched: 0, _errors: 0,
          _next_page: page + 1, _last_error: null,
        } as any);
        page++;
        continue;
      }
      await supabaseAdmin.rpc("finish_bling_stores_job" as any, {
        _job_id: jobId, _status: "concluida", _last_error: null,
      } as any);
      done = true;
      break;
    }
    page++;
  }

  return { done, processed_pages: processed, next_page: done ? null : page };
}

/** Fetch depósitos and set the default on the integration when none. */
export async function syncBlingDepositos(integ: BlingIntegrationRow): Promise<{ deposits: number; default_id: string | null }> {
  const res = await blingApiGet<any>(integ, `/depositos?pagina=1&limite=100`);
  if (!res.ok) throw new Error(res.errorMessage ?? `HTTP ${res.status}`);
  const rows = ((res.data as any)?.data as any[] | undefined) ?? [];
  const padrao = rows.find((d) => d?.padrao === true) ?? rows[0];
  const defId = padrao ? String(padrao.id) : null;
  if (defId) {
    await supabaseAdmin
      .from("bling_integrations")
      .update({ default_deposito_id: defId, updated_at: new Date().toISOString() })
      .eq("id", integ.id);
  }
  return { deposits: rows.length, default_id: defId };
}
