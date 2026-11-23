import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertMember(context: { supabase: any; userId: string }, companyId: string) {
  const { data, error } = await context.supabase
    .from("company_users")
    .select("ativo")
    .eq("company_id", companyId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.ativo) throw new Error("Sem acesso a esta empresa.");
}

async function triggerStoresWorker(jobId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const base = (process.env.APP_PUBLIC_URL ?? "").replace(/\/$/, "");
  const secret = process.env.BLING_WORKER_SECRET ?? "";
  if (!base || !secret) return false;
  await supabaseAdmin.rpc("enqueue_bling_sync_tick", {
    _url: `${base}/api/public/bling/stores-tick`,
    _secret: secret,
    _job_id: jobId,
  });
  return true;
}

export const startBlingStoresSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      scope: z.enum(["full", "product", "missing"]).default("full"),
      bling_product_id: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    {
      const { assertNoActiveSync } = await import("@/lib/sync-lock.server");
      await assertNoActiveSync(data.company_id, ["multilojas"]);
    }
    const { data: res, error } = await context.supabase.rpc("start_bling_stores_sync" as any, {
      _company_id: data.company_id,
      _scope: data.scope,
      _bling_product_id: (data.bling_product_id ?? null) as any,
    });
    if (error) throw new Error(error.message);
    const r = res as { job_id: string; already_running?: boolean };
    if (r.job_id) {
      const { processStoreSyncTick } = await import("./bling-stores.server");
      const result = await processStoreSyncTick(r.job_id);
      if (!result.done && !result.cancelled && result.next_page != null) await triggerStoresWorker(r.job_id);
    }
    return r;
  });

export const getBlingStoresProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    // Finaliza jobs presos em estados intermediários antes de reportar progresso.
    await context.supabase
      .rpc("cleanup_stuck_bling_stores_jobs" as any, { _minutes: 15 })
      .then(() => undefined, () => undefined);
    const { data: res, error } = await context.supabase.rpc("get_bling_stores_progress" as any, {
      _company_id: data.company_id,
    });
    if (error) throw new Error(error.message);
    return (res ?? {}) as {
      job?: {
        id: string; status: string; scope: string;
        proxima_pagina: number; paginas_processadas: number;
        vinculos_encontrados: number; vinculos_salvos: number; vinculos_atualizados: number;
        produtos_relacionados: number; produtos_nao_encontrados: number; erros: number;
        last_error: string | null; started_at: string | null; finished_at: string | null;
      };
      totals?: {
        total_links: number; active_links: number; inactive_links: number;
        unmatched: number; distinct_stores: number; products_with_stores: number;
        last_imported: string | null;
      };
    };
  });

export const listProductStores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      internal_product_id: z.string().uuid(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: rows, error } = await context.supabase
      .from("bling_product_stores")
      .select("*")
      .eq("company_id", data.company_id)
      .eq("internal_product_id", data.internal_product_id)
      .order("store_name", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listAllStoreLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      search: z.string().optional(),
      bling_store_id: z.string().optional(),
      only_active: z.boolean().optional(),
      only_unmatched: z.boolean().optional(),
      page: z.number().int().min(1).default(1),
      per_page: z.number().int().min(1).max(200).default(50),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    let q = context.supabase
      .from("bling_product_stores")
      .select("*, bling_products(nome, codigo)", { count: "exact" })
      .eq("company_id", data.company_id);
    if (data.bling_store_id) q = q.eq("bling_store_id", data.bling_store_id);
    if (data.only_active) q = q.eq("is_linked", true);
    if (data.only_unmatched) q = q.is("internal_product_id", null);
    if (data.search) {
      q = q.or(
        `store_name.ilike.%${data.search}%,store_product_code.ilike.%${data.search}%,bling_product_id.ilike.%${data.search}%,bling_store_id.ilike.%${data.search}%`,
      );
    }
    const from = (data.page - 1) * data.per_page;
    const to = from + data.per_page - 1;
    q = q.order("updated_at", { ascending: false }).range(from, to);
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

export const listDistinctStores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: rows, error } = await context.supabase
      .from("bling_product_stores")
      .select("bling_store_id, store_name, store_type")
      .eq("company_id", data.company_id)
      .eq("is_linked", true)
      .limit(2000);
    if (error) throw new Error(error.message);
    const map = new Map<string, { bling_store_id: string; store_name: string | null; store_type: string | null }>();
    for (const r of rows ?? []) {
      if (!map.has(r.bling_store_id)) map.set(r.bling_store_id, r);
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.store_name ?? a.bling_store_id).localeCompare(b.store_name ?? b.bling_store_id),
    );
  });

/** Store counts by internal_product_id, for the products list column. */
export const getStoreCountsForProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      product_ids: z.array(z.string().uuid()).min(1).max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: rows, error } = await context.supabase
      .from("bling_product_stores")
      .select("internal_product_id")
      .eq("company_id", data.company_id)
      .eq("is_linked", true)
      .in("internal_product_id", data.product_ids);
    if (error) throw new Error(error.message);
    const counts: Record<string, number> = {};
    for (const r of rows ?? []) {
      if (!r.internal_product_id) continue;
      counts[r.internal_product_id] = (counts[r.internal_product_id] ?? 0) + 1;
    }
    return counts;
  });

export const cancelBlingStoresSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), job_id: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("request_cancel_bling_stores_sync" as any, {
      _company_id: data.company_id,
      _job_id: (data.job_id ?? null) as any,
    });
    if (error) throw new Error(error.message);
    return res as { cancelled: number };
  });

/** Pausa a sincronização mantendo o ponto exato para continuar depois. */
export const pauseBlingStoresSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), job_id: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("pause_bling_stores_sync" as any, {
      _company_id: data.company_id,
      _job_id: (data.job_id ?? null) as any,
    });
    if (error) throw new Error(error.message);
    return res as { paused: number };
  });

/** Retoma uma sincronização pausada a partir da página onde parou. */
export const unpauseBlingStoresSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), job_id: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("unpause_bling_stores_sync" as any, {
      _company_id: data.company_id,
      _job_id: (data.job_id ?? null) as any,
    });
    if (error) throw new Error(error.message);
    const out = res as { resumed: number; job_id: string | null };
    if (out?.job_id) {
      const { processStoreSyncTick } = await import("./bling-stores.server");
      const result = await processStoreSyncTick(out.job_id);
      if (!result.done && result.next_page != null) await triggerStoresWorker(out.job_id);
    }
    return out;
  });



export const resumeBlingStoresSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid(), job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: job, error } = await context.supabase
      .from("bling_store_sync_jobs")
      .select("id, company_id, status")
      .eq("id", data.job_id)
      .eq("company_id", data.company_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const status = (job as { status?: string } | null)?.status;
    if (!job || !status || !["pendente", "processando"].includes(status)) return { resumed: false };
    const { processStoreSyncTick } = await import("./bling-stores.server");
    const result = await processStoreSyncTick(data.job_id);
    if (!result.done && !result.cancelled && result.next_page != null) await triggerStoresWorker(data.job_id);
    return { resumed: true, result };
  });

export const listBlingChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: rows, error } = await (context.supabase as any)
      .from("bling_stores")
      .select("bling_store_id, descricao, tipo, situacao, cnpj_filial, intermediador_nome, intermediador_cnpj, marketplace_id, is_default")
      .eq("company_id", data.company_id)
      .order("descricao", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const setStoreMarketplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      bling_store_id: z.string().min(1),
      marketplace_id: z.string().uuid().nullable(),
      is_default: z.boolean().default(false),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { error } = await (context.supabase as any).rpc("set_bling_store_marketplace", {
      _company_id: data.company_id,
      _bling_store_id: data.bling_store_id,
      _marketplace_id: data.marketplace_id,
      _is_default: data.is_default,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const refreshBlingDepositos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: integ } = await context.supabase
      .from("bling_integrations")
      .select("id, company_id, status")
      .eq("company_id", data.company_id)
      .eq("status", "conectada")
      .maybeSingle();
    if (!integ) throw new Error("Nenhuma integração Bling conectada.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: full } = await supabaseAdmin
      .from("bling_integrations")
      .select("id, company_id, access_token, refresh_token, token_expires_at, status")
      .eq("id", (integ as any).id)
      .maybeSingle();
    const { syncBlingDepositos } = await import("./bling-stores.server");
    return await syncBlingDepositos(full as any);
  });

/** Apaga vínculos de multiloja (todos ou de uma loja específica), em lotes. */
export const deleteStoreLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      bling_store_id: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    let deleted = 0;
    for (let i = 0; i < 200; i++) {
      const { data: n, error } = await context.supabase.rpc("delete_store_links_batch" as any, {
        _company_id: data.company_id,
        _bling_store_id: (data.bling_store_id ?? null) as any,
        _limit: 5000,
      });
      if (error) throw new Error(error.message);
      const removed = Number(n ?? 0);
      deleted += removed;
      if (removed === 0) break;
    }
    return { deleted };
  });

/** Páginas que falharam na sincronização de multilojas (pendentes de reprocessar). */
export const listStoreSyncPageErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), include_resolved: z.boolean().default(false) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    try {
      const { backfillStoreSyncPageErrors } = await import("./bling-stores.server");
      await backfillStoreSyncPageErrors(data.company_id);
    } catch {
      // recuperação é best-effort
    }
    let q = context.supabase
      .from("bling_store_sync_page_errors" as any)
      .select("id, page, scope, http_status, error_message, attempts, resolved, created_at, last_retry_at")
      .eq("company_id", data.company_id)
      .order("page", { ascending: true })
      .limit(500);
    if (!data.include_resolved) q = q.eq("resolved", false);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return ((rows ?? []) as unknown) as Array<{
      id: string; page: number; scope: string; http_status: number | null;
      error_message: string | null; attempts: number; resolved: boolean;
      created_at: string; last_retry_at: string | null;
    }>;
  });

/** Reprocessa uma página que ficou com erro. */
export const retryStoreSyncPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), error_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: row, error } = await context.supabase
      .from("bling_store_sync_page_errors" as any)
      .select("id")
      .eq("id", data.error_id)
      .eq("company_id", data.company_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Página não encontrada.");
    const { reprocessStoreSyncPage } = await import("./bling-stores.server");
    return await reprocessStoreSyncPage(data.error_id);
  });
