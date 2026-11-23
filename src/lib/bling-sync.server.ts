// Server-only worker logic for Bling product sync.
// Splits into two phases: catalogacao (list pages) + detalhamento (per-product).
// Each invocation processes a small batch, updates progress and returns.
// pg_cron ticks the worker every minute; the worker also self-invokes for
// snappier progress while a job is active.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blingApiGet, type BlingIntegrationRow } from "./bling.server";
import type { Json } from "@/integrations/supabase/types";

const CATALOG_PAGES_PER_TICK = 3; // pages per invocation (up to ~300 items)
const DETAIL_ITEMS_PER_TICK = 15; // detail requests per invocation
const MAX_CONSECUTIVE_ERRORS = 10;

type Job = {
  id: string;
  company_id: string;
  integration_id: string;
  phase: string;
  status: string;
  current_page: number;
  page_size: number;
  cataloged_items: number;
  processed_items: number;
  successful_items: number;
  failed_items: number;
  total_items: number | null;
  requests_made: number;
  retries_count: number;
  consecutive_errors: number;
  started_at: string | null;
  cancel_requested: boolean;
  worker_started_at: string | null;
  worker_last_heartbeat_at: string | null;
  worker_invocation_count: number;
};

type ProcessResult = {
  active: boolean;
  reason?: string;
  batchProcessed?: boolean;
  firstPageCount?: number;
  blingStatus?: number;
};

function pickStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function pickNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return null;
}

function mapListItem(job: Job, item: Record<string, unknown>) {
  return {
    company_id: job.company_id,
    integration_id: job.integration_id,
    bling_product_id: String(item.id ?? ""),
    codigo: pickStr(item.codigo),
    nome: pickStr(item.nome),
    tipo: pickStr(item.tipo),
    formato: pickStr(item.formato),
    situacao: pickStr(item.situacao),
    preco: pickNum(item.preco),
    dados_resumidos_json: item as unknown as Json,
    last_seen_sync_job_id: job.id,
  };
}

function mapDetail(job: Job, d: Record<string, unknown>) {
  const dim = (d.dimensoes as Record<string, unknown> | undefined) ?? {};
  const estoque = (d.estoque as Record<string, unknown> | undefined) ?? {};
  const midia = (d.midia as Record<string, unknown> | undefined) ?? {};
  const imagens = (midia?.imagens as Record<string, unknown> | undefined) ?? {};
  const externas = (imagens?.externas as Array<Record<string, unknown>> | undefined) ?? [];
  const cat = (d.categoria as Record<string, unknown> | undefined) ?? {};
  const forn = (d.fornecedor as Record<string, unknown> | undefined) ?? {};
  return {
    company_id: job.company_id,
    integration_id: job.integration_id,
    bling_product_id: String(d.id ?? ""),
    codigo: pickStr(d.codigo),
    nome: pickStr(d.nome),
    descricao_curta: pickStr(d.descricaoCurta),
    descricao_complementar: pickStr(d.descricaoComplementar),
    tipo: pickStr(d.tipo),
    formato: pickStr(d.formato),
    situacao: pickStr(d.situacao),
    unidade: pickStr(d.unidade),
    gtin: pickStr(d.gtin),
    gtin_embalagem: pickStr(d.gtin) ?? pickStr(d.gtinEmbalagem),
    preco: pickNum(d.preco),
    preco_custo: pickNum((d as { precoCusto?: unknown }).precoCusto),
    estoque_minimo: pickNum(estoque.minimo),
    estoque_maximo: pickNum(estoque.maximo),
    garantia: pickStr(d.garantia),
    peso_liquido: pickNum(d.pesoLiquido),
    peso_bruto: pickNum(d.pesoBruto),
    largura: pickNum(dim.largura),
    altura: pickNum(dim.altura),
    profundidade: pickNum(dim.profundidade),
    // API v3: 0 = metros, 1 = centímetros, 2 = milímetros.
    unidade_medida:
      dim.unidadeMedida === 1 || dim.unidadeMedida === "1"
        ? "Centímetros"
        : dim.unidadeMedida === 2 || dim.unidadeMedida === "2"
          ? "Milímetros"
          : dim.unidadeMedida === 0 || dim.unidadeMedida === "0"
            ? "Metros"
            : null,
    cross_docking: estoque.crossdocking != null ? String(estoque.crossdocking) : null,
    localizacao: pickStr(estoque.localizacao),
    volumes: pickNum(d.volumes),
    itens_caixa: pickNum(d.itensPorCaixa),
    ncm: pickStr((d.tributacao as Record<string, unknown> | undefined)?.ncm),
    cest: pickStr((d.tributacao as Record<string, unknown> | undefined)?.cest),
    marca: pickStr(d.marca),
    categoria_id: cat.id != null ? String(cat.id) : null,
    fornecedor_id: forn.id != null && Number(forn.id) > 0 ? String(forn.id) : null,
    imagem_principal_url: externas[0]?.link ? String(externas[0].link) : null,
    dados_completos_json: d as unknown as Json,
    detail_synced: true,
    detail_sync_error: null,
    detail_synced_at: new Date().toISOString(),
    last_seen_sync_job_id: job.id,
  };
}

async function loadJob(jobId: string): Promise<Job | null> {
  const { data } = await supabaseAdmin
    .from("bling_sync_jobs")
    .select(
      "id,company_id,integration_id,phase,status,current_page,page_size,cataloged_items,processed_items,successful_items,failed_items,total_items,requests_made,retries_count,consecutive_errors,started_at,cancel_requested,worker_started_at,worker_last_heartbeat_at,worker_invocation_count",
    )
    .eq("id", jobId)
    .maybeSingle();
  return (data as Job) ?? null;
}

async function loadIntegration(id: string): Promise<BlingIntegrationRow | null> {
  const { data } = await supabaseAdmin
    .from("bling_integrations")
    .select("id,company_id,access_token,refresh_token,token_expires_at,status")
    .eq("id", id)
    .maybeSingle();
  return (data as BlingIntegrationRow) ?? null;
}

function recomputeEta(job: Job, patch: Record<string, unknown>) {
  const total = (patch.total_items as number | undefined) ?? job.total_items ?? null;
  const processed = (patch.processed_items as number | undefined) ?? job.processed_items;
  const startedAt = job.started_at ? new Date(job.started_at).getTime() : Date.now();
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  patch.elapsed_seconds = elapsed;
  if (total && total > 0) {
    const remaining = Math.max(0, total - processed);
    patch.remaining_items = remaining;
    patch.progress_percent = Number(((processed / total) * 100).toFixed(2));
    if (processed >= 10 && elapsed > 0) {
      const avg = elapsed / processed;
      patch.average_seconds_per_item = Number(avg.toFixed(4));
      const rem = Math.floor(remaining * avg);
      patch.estimated_remaining_seconds = rem;
      patch.estimated_finish_at = new Date(Date.now() + rem * 1000).toISOString();
    }
  }
  patch.last_activity_at = new Date().toISOString();
}

async function updateJob(job: Job, patch: Record<string, unknown>) {
  recomputeEta(job, patch);
  patch.worker_last_heartbeat_at = new Date().toISOString();
  await supabaseAdmin
    .from("bling_sync_jobs")
    .update(patch as never)
    .eq("id", job.id);
}

async function markWorker(jobId: string, patch: Record<string, unknown>) {
  await supabaseAdmin
    .from("bling_sync_jobs")
    .update({
      ...patch,
      worker_last_heartbeat_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    } as never)
    .eq("id", jobId);
}

async function isCancelRequested(jobId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("bling_sync_jobs")
    .select("cancel_requested")
    .eq("id", jobId)
    .maybeSingle();
  return Boolean(data?.cancel_requested);
}

async function markCanceled(job: Job, reason = "canceled"): Promise<ProcessResult> {
  await supabaseAdmin
    .from("bling_sync_jobs")
    .update({
      status: "cancelada",
      finished_at: new Date().toISOString(),
      worker_finished_at: new Date().toISOString(),
      worker_last_status: "canceled",
      worker_last_error: null,
      last_activity_at: new Date().toISOString(),
      worker_last_heartbeat_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  return { active: false, reason };
}

async function beforeRequest(job: Job, path: string) {
  await markWorker(job.id, {
    worker_last_status: "request_started",
    last_request_at: new Date().toISOString(),
    last_request_endpoint: path,
  });
}

async function afterResponse(job: Job, status: number, body?: string) {
  await markWorker(job.id, {
    worker_last_status: "response_received",
    last_response_status: status,
    last_response_body_safe: body ? body.slice(0, 1000) : null,
  });
}

async function logError(job: Job, args: {
  bling_product_id?: string | null;
  phase: string;
  endpoint: string;
  http_status?: number | null;
  error_code?: string | null;
  error_message?: string | null;
  attempts?: number;
}) {
  await supabaseAdmin.from("bling_sync_job_errors").insert({
    sync_job_id: job.id,
    company_id: job.company_id,
    integration_id: job.integration_id,
    bling_product_id: args.bling_product_id ?? null,
    phase: args.phase,
    endpoint: args.endpoint,
    http_status: args.http_status ?? null,
    error_code: args.error_code ?? null,
    error_message: args.error_message ?? null,
    attempts: args.attempts ?? 1,
  });
}

/**
 * Process one small batch for the given job.
 * Returns whether the job is still active (caller may re-invoke).
 */
export async function processSyncBatch(jobId: string): Promise<ProcessResult> {
  const job = await loadJob(jobId);
  if (!job) return { active: false, reason: "job_not_found" };

  await markWorker(job.id, {
    worker_started_at: job.worker_started_at ?? new Date().toISOString(),
    worker_invocation_count: (job.worker_invocation_count ?? 0) + 1,
    worker_last_status: "batch_started",
    worker_last_error: null,
  });

  if (job.cancel_requested || (await isCancelRequested(job.id))) return markCanceled(job);
  if (["concluida", "concluida_com_erros", "cancelada", "pausada_por_erro"].includes(job.status)) {
    return { active: false, reason: job.status };
  }

  await markWorker(job.id, { worker_last_status: "token_loading" });
  const integration = await loadIntegration(job.integration_id);
  if (!integration || integration.status === "requer_reconexao" || !integration.access_token) {
    await supabaseAdmin
      .from("bling_sync_jobs")
      .update({
        status: "pausada_por_erro",
        pause_reason: "Integração não conectada.",
        last_error_message: "Integração não conectada.",
        worker_last_status: "token_missing",
        worker_last_error: "Integração não conectada.",
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { active: false, reason: "not_connected" };
  }
  await markWorker(job.id, { worker_last_status: "token_loaded" });

  // Ensure started_at
  if (!job.started_at) {
    const now = new Date().toISOString();
    await supabaseAdmin.from("bling_sync_jobs").update({ started_at: now }).eq("id", job.id);
    job.started_at = now;
  }

  if (job.phase === "catalogacao") {
    return await runCatalogBatch(job, integration);
  }
  if (job.phase === "detalhamento") {
    return await runDetailBatch(job, integration);
  }
  // finalizacao: recompute totals and finish
  await finalize(job);
  return { active: false, reason: "finalized" };
}

async function runCatalogBatch(job: Job, integration: BlingIntegrationRow): Promise<ProcessResult> {
  await supabaseAdmin
    .from("bling_sync_jobs")
    .update({ status: "catalogando", pause_reason: null })
    .eq("id", job.id);

  let page = job.current_page;
  let cataloged = job.cataloged_items;
  let requests = job.requests_made;
  let retries = job.retries_count;
  let consecutive = job.consecutive_errors;

  for (let i = 0; i < CATALOG_PAGES_PER_TICK; i++) {
    if (await isCancelRequested(job.id)) return markCanceled(job);
    const path = `/produtos?pagina=${page}&limite=${job.page_size}&criterio=5&tipo=T`;
    await beforeRequest(job, path);
    const res = await blingApiGet<{ data?: Array<Record<string, unknown>> }>(integration, path);
    await afterResponse(job, res.status, res.responseBodySafe);
    requests++;
    retries += res.retries;

    if (await isCancelRequested(job.id)) return markCanceled(job);

    if (!res.ok) {
      consecutive++;
      await logError(job, {
        phase: "catalogacao",
        endpoint: path,
        http_status: res.status,
        error_code: res.errorCode ?? null,
        error_message: res.errorMessage ?? null,
      });
      const pauseReason =
        res.errorCode === "auth"
          ? "HTTP 401 — Token inválido."
          : res.status === 403
            ? "HTTP 403 — Acesso não autorizado."
            : res.status === 429
              ? "HTTP 429 — Limite de requisições."
              : res.status >= 500
                ? `HTTP ${res.status} — Erro interno do Bling.`
                : `HTTP ${res.status} — Não foi possível consultar os produtos.`;
      if (res.errorCode === "auth") {
        await updateJob(job, {
          status: "pausada_por_erro",
          pause_reason: pauseReason,
          last_error_code: "auth",
          last_error_message: `${pauseReason} ${res.errorMessage ?? ""}`.trim(),
          last_response_status: res.status,
          last_response_body_safe: res.responseBodySafe ?? null,
          worker_last_status: "api_error",
          worker_last_error: pauseReason,
          current_page: page,
          cataloged_items: cataloged,
          requests_made: requests,
          retries_count: retries,
          consecutive_errors: consecutive,
        });
        return { active: false, reason: "auth" };
      }
      await updateJob(job, {
        status: res.status === 429 ? "pausada_por_limite" : "pausada_por_erro",
        pause_reason: pauseReason,
        current_page: page,
        cataloged_items: cataloged,
        requests_made: requests,
        retries_count: retries,
        consecutive_errors: consecutive,
        last_error_code: res.errorCode ?? null,
        last_error_message: `${pauseReason} ${res.errorMessage ?? ""}`.trim(),
        last_response_status: res.status,
        last_response_body_safe: res.responseBodySafe ?? null,
        worker_last_status: "api_error",
        worker_last_error: pauseReason,
      });
      return { active: res.status === 429, reason: res.status === 429 ? "rate_limit" : "api_error", blingStatus: res.status };
    }

    consecutive = 0;
    const items = res.data?.data ?? [];
    if (items.length > 0) {
      const rows = items
        .filter((it) => it && (it as { id?: unknown }).id != null)
        .map((it) => mapListItem(job, it));
      if (rows.length > 0) {
        const { error } = await supabaseAdmin
          .from("bling_products")
          .upsert(rows, { onConflict: "integration_id,bling_product_id" });
        if (error) {
          await logError(job, {
            phase: "catalogacao",
            endpoint: path,
            error_code: "db_upsert",
            error_message: error.message,
          });
          await updateJob(job, {
            status: "pausada_por_erro",
            pause_reason: "Falha ao salvar produtos.",
            last_error_code: "db_upsert",
            last_error_message: error.message,
            worker_last_status: "db_upsert_error",
            worker_last_error: error.message,
            current_page: page,
            cataloged_items: cataloged,
            requests_made: requests,
            retries_count: retries,
          });
          return { active: false, reason: "db_upsert_error", batchProcessed: false, blingStatus: res.status };
        } else {
          cataloged += rows.length;
          await markWorker(job.id, { worker_last_status: "page_saved" });
        }
      }
    }

    const isLast = items.length < job.page_size;
    if (isLast) {
      // Move to detalhamento
      // Confirm total from products table (deduped by unique constraint)
      const { count } = await supabaseAdmin
        .from("bling_products")
        .select("id", { count: "exact", head: true })
        .eq("integration_id", job.integration_id)
        .eq("last_seen_sync_job_id", job.id);
      const total = count ?? cataloged;
      await updateJob(job, {
        phase: "detalhamento",
        status: "processando",
        current_page: page,
        cataloged_items: cataloged,
        total_items: total,
        total_pages_processed: page,
        catalog_finished_at: new Date().toISOString(),
        requests_made: requests,
        retries_count: retries,
        consecutive_errors: 0,
      });
      return { active: true, reason: "catalog_done", batchProcessed: true, firstPageCount: cataloged - job.cataloged_items, blingStatus: res.status };
    }
    page++;
  }

  await updateJob(job, {
    current_page: page,
    cataloged_items: cataloged,
    total_pages_processed: page - 1,
    requests_made: requests,
    retries_count: retries,
    consecutive_errors: consecutive,
  });
  return { active: true, reason: "catalog_batch", batchProcessed: true, firstPageCount: cataloged - job.cataloged_items, blingStatus: 200 };
}

async function runDetailBatch(job: Job, integration: BlingIntegrationRow): Promise<ProcessResult> {
  await supabaseAdmin
    .from("bling_sync_jobs")
    .update({ status: "processando", pause_reason: null })
    .eq("id", job.id);

  const { data: pending, error: qErr } = await supabaseAdmin
    .from("bling_products")
    .select("bling_product_id")
    .eq("integration_id", job.integration_id)
    .eq("last_seen_sync_job_id", job.id)
    .eq("detail_synced", false)
    .limit(DETAIL_ITEMS_PER_TICK);

  if (qErr) {
    await logError(job, {
      phase: "detalhamento",
      endpoint: "db:pending",
      error_code: "db_query",
      error_message: qErr.message,
    });
    return { active: true, reason: "db_error" };
  }

  let processed = job.processed_items;
  let successful = job.successful_items;
  let failed = job.failed_items;
  let requests = job.requests_made;
  let retries = job.retries_count;
  let consecutive = job.consecutive_errors;

  if (!pending || pending.length === 0) {
    await finalize(job);
    return { active: false, reason: "done" };
  }

  for (const p of pending) {
    if (job.cancel_requested || (await isCancelRequested(job.id))) return markCanceled(job);
    const productId = p.bling_product_id;
    if (!productId) continue;
    const path = `/produtos/${encodeURIComponent(productId)}`;
    await beforeRequest(job, path);
    const res = await blingApiGet<{ data?: Record<string, unknown> }>(integration, path);
    await afterResponse(job, res.status, res.responseBodySafe);
    requests++;
    retries += res.retries;

    if (await isCancelRequested(job.id)) return markCanceled(job);

    if (res.ok && res.data?.data) {
      const row = mapDetail(job, res.data.data);
      const { error } = await supabaseAdmin
        .from("bling_products")
        .upsert(row, { onConflict: "integration_id,bling_product_id" });
      if (error) {
        failed++;
        consecutive++;
        await logError(job, {
          bling_product_id: productId,
          phase: "detalhamento",
          endpoint: path,
          error_code: "db_upsert",
          error_message: error.message,
        });
      } else {
        successful++;
        consecutive = 0;
      }
      processed++;
    } else {
      // On auth: pause job
      if (res.errorCode === "auth") {
        await updateJob(job, {
          status: "pausada_por_erro",
          pause_reason: "Integração precisa ser reconectada.",
          last_product_id: productId,
          last_error_code: "auth",
          last_error_message: res.errorMessage ?? null,
          last_response_status: res.status,
          last_response_body_safe: res.responseBodySafe ?? null,
          worker_last_status: "api_error",
          worker_last_error: "HTTP 401 — Token inválido.",
          processed_items: processed,
          successful_items: successful,
          failed_items: failed,
          requests_made: requests,
          retries_count: retries,
          consecutive_errors: consecutive,
        });
        return { active: false, reason: "auth" };
      }
      const isPermanent = res.status === 400 || res.status === 404;
      if (isPermanent) {
        // count as processed (definitive failure) and mark product
        failed++;
        processed++;
        consecutive = 0;
        await supabaseAdmin
          .from("bling_products")
          .update({
            detail_synced: true,
            detail_sync_error: `HTTP ${res.status}: ${res.errorMessage ?? ""}`.slice(0, 500),
            detail_synced_at: new Date().toISOString(),
          })
          .eq("integration_id", job.integration_id)
          .eq("bling_product_id", productId);
        await logError(job, {
          bling_product_id: productId,
          phase: "detalhamento",
          endpoint: path,
          http_status: res.status,
          error_code: res.errorCode ?? null,
          error_message: res.errorMessage ?? null,
        });
      } else {
        consecutive++;
        await logError(job, {
          bling_product_id: productId,
          phase: "detalhamento",
          endpoint: path,
          http_status: res.status,
          error_code: res.errorCode ?? null,
          error_message: res.errorMessage ?? null,
        });
        if (consecutive >= MAX_CONSECUTIVE_ERRORS) {
          await updateJob(job, {
            status: "pausada_por_erro",
            pause_reason: "Muitos erros consecutivos.",
            last_product_id: productId,
            last_error_code: res.errorCode ?? null,
            last_error_message: res.errorMessage ?? null,
            last_response_status: res.status,
            last_response_body_safe: res.responseBodySafe ?? null,
            worker_last_status: "api_error",
            worker_last_error: res.errorMessage ?? `HTTP ${res.status}`,
            processed_items: processed,
            successful_items: successful,
            failed_items: failed,
            requests_made: requests,
            retries_count: retries,
            consecutive_errors: consecutive,
          });
          return { active: false, reason: "too_many_errors" };
        }
      }
    }
  }

  await updateJob(job, {
    processed_items: processed,
    successful_items: successful,
    failed_items: failed,
    requests_made: requests,
    retries_count: retries,
    consecutive_errors: consecutive,
    last_product_id: pending[pending.length - 1]?.bling_product_id ?? null,
  });

  // Check if done
  const { count: remainingCount } = await supabaseAdmin
    .from("bling_products")
    .select("id", { count: "exact", head: true })
    .eq("integration_id", job.integration_id)
    .eq("last_seen_sync_job_id", job.id)
    .eq("detail_synced", false);

  if (!remainingCount || remainingCount === 0) {
    await finalize({ ...job, processed_items: processed, successful_items: successful, failed_items: failed });
    return { active: false, reason: "done" };
  }
  return { active: true, reason: "batch_done" };
}

async function finalize(job: Job) {
  const { data: full } = await supabaseAdmin
    .from("bling_sync_jobs")
    .select("failed_items,successful_items,processed_items")
    .eq("id", job.id)
    .maybeSingle();
  const failed = full?.failed_items ?? job.failed_items;
  const startedAt = job.started_at ? new Date(job.started_at).getTime() : Date.now();
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  await supabaseAdmin
    .from("bling_sync_jobs")
    .update({
      phase: "finalizacao",
      status: failed > 0 ? "concluida_com_erros" : "concluida",
      finished_at: new Date().toISOString(),
      worker_finished_at: new Date().toISOString(),
      worker_last_status: "finished",
      last_activity_at: new Date().toISOString(),
      worker_last_heartbeat_at: new Date().toISOString(),
      elapsed_seconds: elapsed,
      progress_percent: 100,
      remaining_items: 0,
    })
    .eq("id", job.id);

  await supabaseAdmin
    .from("bling_integrations")
    .update({ last_sync_at: new Date().toISOString() })
    .eq("id", job.integration_id);
}