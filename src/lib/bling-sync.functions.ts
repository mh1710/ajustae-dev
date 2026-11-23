import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const companyInput = z.object({ company_id: z.string().uuid() });
const PROCESSING_STATUSES = ["pendente", "catalogando", "processando", "pausada_por_limite", "retomando", "cancelando"];
const STALE_HEARTBEAT_MS = 5 * 60 * 1000;

function isStaleHeartbeat(job: { worker_last_heartbeat_at?: string | null; last_activity_at?: string | null }) {
  const source = job.worker_last_heartbeat_at ?? job.last_activity_at;
  if (!source) return true;
  return Date.now() - new Date(source).getTime() > STALE_HEARTBEAT_MS;
}

async function getWorkerBaseUrl() {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const requestOrigin = request?.url ? new URL(request.url).origin : "";
  return process.env.APP_PUBLIC_URL?.replace(/\/$/, "") || requestOrigin || "";
}

async function callWorkerOrPause(
  supabaseAdmin: import("@supabase/supabase-js").SupabaseClient,
  syncJobId: string,
  options: { throwOnFailure?: boolean } = {},
) {
  const base = await getWorkerBaseUrl();
  const secret = process.env.BLING_WORKER_SECRET?.trim() ?? "";
  if (!base || !secret) {
    await supabaseAdmin
      .from("bling_sync_jobs")
      .update({
        status: "pausada_por_erro",
        pause_reason: "worker_secret_missing",
        last_error_code: "worker_secret_missing",
        last_error_message: "Worker não iniciado: APP_PUBLIC_URL ou BLING_WORKER_SECRET ausente.",
        worker_last_status: "worker_secret_missing",
        worker_last_error: "APP_PUBLIC_URL ou BLING_WORKER_SECRET ausente.",
        worker_last_heartbeat_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", syncJobId);
    if (options.throwOnFailure) throw new Error("Worker não iniciado: configuração do backend ausente.");
    return { ok: false, httpStatus: 0, message: "Worker não iniciado: configuração ausente." };
  }

  await supabaseAdmin
    .from("bling_sync_jobs")
    .update({ worker_last_status: "worker_call_started", worker_last_error: null, last_activity_at: new Date().toISOString() })
    .eq("id", syncJobId);

  const response = await fetch(`${base}/api/public/bling/sync-tick`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-secret": secret },
    body: JSON.stringify({ syncJobId }),
  });
  const text = await response.text().catch(() => "");
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  await supabaseAdmin
    .from("bling_sync_jobs")
    .update({
      worker_last_status: response.ok ? "worker_call_accepted" : "worker_call_failed",
      worker_last_error: response.ok ? null : `Falha ao iniciar worker: ${response.status} ${text.slice(0, 300)}`,
      last_response_status: response.status,
      last_response_body_safe: text.slice(0, 1000),
      worker_last_heartbeat_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", syncJobId);

  if (!response.ok) {
    await supabaseAdmin
      .from("bling_sync_jobs")
      .update({
        status: "pausada_por_erro",
        pause_reason: response.status === 401 ? "worker_secret_missing" : response.status === 403 ? "worker_secret_invalid" : "worker_not_started",
        last_error_code: response.status === 401 ? "worker_secret_missing" : response.status === 403 ? "worker_secret_invalid" : "worker_not_started",
        last_error_message: `Falha ao iniciar worker: ${response.status} ${text.slice(0, 300)}`,
      })
      .eq("id", syncJobId);
    if (options.throwOnFailure) throw new Error("Não foi possível iniciar a sincronização.");
  }
  return { ok: response.ok, httpStatus: response.status, payload, message: text.slice(0, 300) };
}

async function assertMembership(ctx: { supabase: { from: (t: string) => unknown }; userId: string }, companyId: string, adminOnly = false) {
  const supa = ctx.supabase as unknown as import("@supabase/supabase-js").SupabaseClient;
  const { data, error } = await supa
    .from("company_users")
    .select("role, ativo")
    .eq("company_id", companyId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.ativo) throw new Error("Acesso negado a esta empresa.");
  if (adminOnly && data.role !== "admin") throw new Error("Somente administradores.");
}

export const startProductSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => companyInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertMembership(context, data.company_id, true);
    {
      const { assertNoActiveSync } = await import("@/lib/sync-lock.server");
      await assertNoActiveSync(data.company_id, ["produtos"]);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: integ } = await supabaseAdmin
      .from("bling_integrations")
      .select("id, status")
      .eq("company_id", data.company_id)
      .maybeSingle();
    if (!integ || integ.status !== "conectada") {
      throw new Error("Integração Bling não está conectada.");
    }

    const { data: active } = await supabaseAdmin
      .from("bling_sync_jobs")
      .select("id, status, worker_last_heartbeat_at, last_activity_at")
      .eq("integration_id", integ.id)
      .in("status", PROCESSING_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (active) {
      if (active.status === "cancelando" && isStaleHeartbeat(active)) {
        await supabaseAdmin
          .from("bling_sync_jobs")
          .update({
            status: "cancelada",
            finished_at: new Date().toISOString(),
            worker_finished_at: new Date().toISOString(),
            worker_last_status: "canceled_stale",
            last_activity_at: new Date().toISOString(),
          })
          .eq("id", active.id);
      } else {
        await callWorkerOrPause(supabaseAdmin, active.id, { throwOnFailure: false });
        return { sync_job_id: active.id, resumed: true };
      }
    }

    const { data: job, error } = await supabaseAdmin
      .from("bling_sync_jobs")
      .insert({
        company_id: data.company_id,
        integration_id: integ.id,
        resource: "produtos",
        sync_type: "full",
        phase: "catalogacao",
        status: "pendente",
        page_size: 100,
        current_page: 1,
        created_by: context.userId,
        started_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        worker_last_status: "job_created",
      })
      .select("id")
      .single();
    if (error || !job) throw new Error(error?.message ?? "Falha ao criar job.");

    await callWorkerOrPause(supabaseAdmin, job.id, { throwOnFailure: true });
    return { sync_job_id: job.id, resumed: false };
  });

export const getActiveOrLatestSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => companyInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertMembership(context, data.company_id);
    const supa = context.supabase;
    const { data: rows } = await supa
      .from("bling_sync_jobs")
      .select(
        "id,phase,status,current_page,total_items,cataloged_items,processed_items,successful_items,failed_items,remaining_items,progress_percent,started_at,catalog_finished_at,finished_at,last_activity_at,estimated_finish_at,elapsed_seconds,estimated_remaining_seconds,requests_made,retries_count,pause_reason,last_error_code,last_error_message,cancel_requested,created_at,worker_started_at,worker_finished_at,worker_last_heartbeat_at,worker_invocation_count,worker_last_status,worker_last_error,last_request_at,last_request_endpoint,last_response_status,last_response_body_safe,claimed_at,claimed_by",
      )
      .eq("company_id", data.company_id)
      .order("created_at", { ascending: false })
      .limit(1);
    let job = rows?.[0] ?? null;
    if (
      job &&
      PROCESSING_STATUSES.includes(job.status) &&
      job.status !== "cancelando" &&
      isStaleHeartbeat(job)
    ) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("bling_sync_jobs")
        .update({
          status: "pausada_por_erro",
          pause_reason: "worker_sem_atividade",
          last_error_code: "worker_sem_atividade",
          last_error_message: "O worker não apresentou atividade por mais de 5 minutos.",
          worker_last_status: "worker_stale",
          worker_last_error: "O worker não apresentou atividade por mais de 5 minutos.",
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      job = {
        ...job,
        status: "pausada_por_erro",
        pause_reason: "worker_sem_atividade",
        last_error_code: "worker_sem_atividade",
        last_error_message: "O worker não apresentou atividade por mais de 5 minutos.",
        worker_last_status: "worker_stale",
        worker_last_error: "O worker não apresentou atividade por mais de 5 minutos.",
      };
    }

    type SyncErrorRow = {
      bling_product_id: string | null;
      phase: string | null;
      http_status: number | null;
      error_message: string | null;
      created_at: string;
    };
    let recentErrors: SyncErrorRow[] = [];
    if (job) {
      const { data: errs } = await supa
        .from("bling_sync_job_errors")
        .select("bling_product_id, phase, http_status, error_message, created_at")
        .eq("sync_job_id", job.id)
        .order("created_at", { ascending: false })
        .limit(10);
      recentErrors = (errs ?? []) as SyncErrorRow[];
    }

    // Referência para estimar quantos produtos faltam durante a catalogação
    // (o Bling não devolve o total ao paginar a listagem).
    let referenceTotal: number | null = null;
    const { data: lastDone } = await supa
      .from("bling_sync_jobs")
      .select("total_items")
      .eq("company_id", data.company_id)
      .not("total_items", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);
    referenceTotal = (lastDone?.[0]?.total_items as number | null) ?? null;
    if (!referenceTotal) {
      const { count } = await supa
        .from("bling_products")
        .select("id", { count: "planned", head: true })
        .eq("company_id", data.company_id);
      referenceTotal = count ?? null;
    }
    return { job, recentErrors, referenceTotal };
  });

export const cancelSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sync_job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supa = context.supabase;
    const { data: job, error } = await supa
      .from("bling_sync_jobs")
      .select("id, company_id, status, worker_last_heartbeat_at, last_activity_at")
      .eq("id", data.sync_job_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Job não encontrado.");
    await assertMembership(context, job.company_id, true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Cancelar = remover a sincronização e todos os seus erros associados,
    // para que o painel volte ao estado "sem sincronização".
    await supabaseAdmin.from("bling_sync_job_errors").delete().eq("sync_job_id", data.sync_job_id);
    await supabaseAdmin.from("bling_sync_jobs").delete().eq("id", data.sync_job_id);
    return { ok: true };
  });

export const forceCancelSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sync_job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supa = context.supabase;
    const { data: job, error } = await supa
      .from("bling_sync_jobs")
      .select("id, company_id")
      .eq("id", data.sync_job_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Job não encontrado.");
    await assertMembership(context, job.company_id, true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("bling_sync_job_errors").delete().eq("sync_job_id", data.sync_job_id);
    await supabaseAdmin.from("bling_sync_jobs").delete().eq("id", data.sync_job_id);
    return { ok: true };
  });

export const resumeSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sync_job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supa = context.supabase;
    const { data: job } = await supa
      .from("bling_sync_jobs")
      .select("id, company_id")
      .eq("id", data.sync_job_id)
      .maybeSingle();
    if (!job) throw new Error("Job não encontrado.");
    await assertMembership(context, job.company_id, true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("bling_sync_jobs")
      .update({
        status: "retomando",
        pause_reason: null,
        consecutive_errors: 0,
        cancel_requested: false,
        worker_last_status: "resume_requested",
        worker_last_error: null,
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", data.sync_job_id);
    await callWorkerOrPause(supabaseAdmin, data.sync_job_id, { throwOnFailure: true });
    return { ok: true };
  });

export const testBlingWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => companyInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertMembership(context, data.company_id, true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job } = await supabaseAdmin
      .from("bling_sync_jobs")
      .select("id")
      .eq("company_id", data.company_id)
      .in("status", PROCESSING_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!job) {
      return { workerReached: false, jobClaimed: false, batchProcessed: false, httpStatus: 404, message: "Nenhum job ativo encontrado." };
    }
    const result = await callWorkerOrPause(supabaseAdmin, job.id, { throwOnFailure: false });
    const payload = result.payload as { claimed?: boolean; batchProcessed?: boolean; reason?: string } | null;
    return {
      workerReached: result.ok,
      jobClaimed: Boolean(payload?.claimed),
      batchProcessed: Boolean(payload?.batchProcessed || payload?.claimed),
      httpStatus: result.httpStatus,
      message: payload?.reason ?? result.message ?? "Worker chamado.",
    };
  });

export const listProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        search: z.string().optional(),
        situacao: z.string().optional(),
        tipo: z.string().optional(),
        detail_filter: z.enum(["all", "synced", "pending"]).optional(),
        stores_filter: z.enum(["all", "0", "1", "2", "3", "4plus", "any"]).optional(),
         bling_store_id: z.string().min(1).optional(),
        audit_rule_slug: z.string().optional(),
        audit_status: z.enum(["error", "warning", "any"]).optional(),
        audit_run_id: z.string().uuid().optional(),
        page: z.number().int().min(1).default(1),
        page_size: z.number().int().min(1).max(100).default(25),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMembership(context, data.company_id);
    const { data: result, error } = await (context.supabase as any).rpc("list_products_fast", {
      _company_id: data.company_id,
      _search: data.search?.trim() || null,
      _situacao: data.situacao ?? null,
      _tipo: data.tipo ?? null,
      _detail_filter: data.detail_filter ?? "all",
      _stores_filter: data.stores_filter ?? "all",
       _bling_store_id: data.bling_store_id ?? null,
      _audit_rule_slug: data.audit_rule_slug ?? null,
      _audit_status: data.audit_status ?? "any",
      _audit_run_id: data.audit_run_id ?? null,
      _page: data.page,
      _page_size: data.page_size,
    });
    if (error) throw new Error(error.message);
    type Row = {
      id: string; bling_product_id: string | null; codigo: string | null; nome: string | null;
      tipo: string | null; formato: string | null; situacao: string | null; preco: number | null;
      preco_custo: number | null; gtin: string | null; imagem_principal_url: string | null; url_imagens_externas: string | null;
      detail_synced: boolean | null; detail_synced_at: string | null; updated_at: string | null;
      marca: string | null; last_audit_errors: number | null; last_audit_warnings: number | null;
      last_audit_at: string | null; stores_count?: number | null;
    };
    const payload = (result ?? {}) as { rows?: Row[]; count?: number };
    return { rows: (payload.rows ?? []) as Row[], count: Number(payload.count ?? 0) };
  });

export const listProductIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        search: z.string().optional(),
        situacao: z.string().optional(),
        tipo: z.string().optional(),
        detail_filter: z.enum(["all", "synced", "pending"]).optional(),
        stores_filter: z.enum(["all", "0", "1", "2", "3", "4plus", "any"]).optional(),
         bling_store_id: z.string().min(1).optional(),
        audit_rule_slug: z.string().optional(),
        audit_status: z.enum(["error", "warning", "any"]).optional(),
        audit_run_id: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMembership(context, data.company_id);
    const { data: result, error } = await (context.supabase as any).rpc("list_product_ids_fast", {
      _company_id: data.company_id,
      _search: data.search?.trim() || null,
      _situacao: data.situacao ?? null,
      _tipo: data.tipo ?? null,
      _detail_filter: data.detail_filter ?? "all",
      _stores_filter: data.stores_filter ?? "all",
       _bling_store_id: data.bling_store_id ?? null,
      _audit_rule_slug: data.audit_rule_slug ?? null,
      _audit_status: data.audit_status ?? "any",
      _audit_run_id: data.audit_run_id ?? null,
    });
    if (error) throw new Error(error.message);
    const payload = (result ?? {}) as { ids?: string[] };
    return { ids: payload.ids ?? [] };
  });