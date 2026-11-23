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

async function triggerWorker(companyId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const base = (process.env.APP_PUBLIC_URL ?? "").replace(/\/$/, "");
  const secret = process.env.BLING_WORKER_SECRET ?? "";
  if (!base || !secret) return;
  const { data: integ } = await supabaseAdmin
    .from("bling_integrations")
    .select("id")
    .eq("company_id", companyId)
    .maybeSingle();
  const url = `${base}/api/public/bling/push-tick`;
  // fire and forget via pg_net
  await supabaseAdmin.rpc("enqueue_bling_sync_tick", {
    _url: url, _secret: secret, _job_id: integ?.id ?? companyId,
  });
}

/** Enfileira a inativação no Bling dos produtos informados (ação destrutiva). */
export const enqueueBlingInativar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      product_ids: z.array(z.string().uuid()).min(1),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("enqueue_bling_inativar" as any, {
      _company_id: data.company_id,
      _product_ids: data.product_ids as any,
    } as never);
    if (error) throw new Error(error.message);
    await triggerWorker(data.company_id);
    const r = (res ?? {}) as { enqueued?: number; skipped?: number; excluidos_local?: number };
    return {
      enqueued: Number(r.enqueued ?? 0),
      skipped: Number(r.skipped ?? 0),
      excluidos_local: Number(r.excluidos_local ?? 0),
    };
  });

export const enqueueBlingPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      product_ids: z.array(z.string().uuid()).optional(),
      scope: z.enum(["preco", "estoque", "ambos", "todos", "criar"]).default("ambos"),
      include_stores: z.boolean().optional(),
      only_changed: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { assertNoActiveSync } = await import("@/lib/sync-lock.server");
    await assertNoActiveSync(data.company_id);
    const onlyChanged = data.only_changed !== false;

    // Auto-ensure default deposit is set when we're going to push stock.
    if (data.scope === "estoque" || data.scope === "ambos" || data.scope === "todos") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: integ } = await supabaseAdmin
        .from("bling_integrations")
        .select("id, company_id, access_token, refresh_token, token_expires_at, status, default_deposito_id")
        .eq("company_id", data.company_id)
        .eq("status", "conectada")
        .maybeSingle();
      if (integ && !(integ as any).default_deposito_id) {
        try {
          const { syncBlingDepositos } = await import("./bling-stores.server");
          await syncBlingDepositos(integ as any);
        } catch { /* ignore; enqueue will simply report skipped */ }
      }
    }

    // Filas grandes são montadas em segundo plano (evita "upstream request
    // timeout" no gateway quando são dezenas de milhares de produtos).
    const bigBatch = !data.product_ids || data.product_ids.length > 2000;
    if (bigBatch) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const base = (process.env.APP_PUBLIC_URL ?? "").replace(/\/$/, "");
      const secret = process.env.BLING_WORKER_SECRET ?? "";
      if (base && secret) {
        const { error: netErr } = await supabaseAdmin.rpc("enqueue_http_job", {
          _url: `${base}/api/public/bling/enqueue`,
          _secret: secret,
          _body: {
            company_id: data.company_id,
            product_ids: data.product_ids ?? null,
            scope: data.scope,
            include_stores: !!data.include_stores,
            only_changed: onlyChanged,
          } as any,
        } as any);
        if (netErr) throw new Error(netErr.message);
        return {
          integration_id: "",
          async: true,
          created_preco: 0,
          created_estoque: 0,
          created_produto: 0,
          created_criar: 0,
          created_lojas: 0,
          updated_existing: 0,
          skipped_sem_bling_id: 0,
          skipped_sem_deposito: 0,
        } as any;
      }
    }

    const { data: res, error } = await context.supabase.rpc("enqueue_bling_push", {
      _company_id: data.company_id,
      _product_ids: (data.product_ids ?? null) as any,
      _scope: data.scope,
      _include_stores: !!data.include_stores,
      _only_changed: onlyChanged,
    } as never);
    if (error) throw new Error(error.message);
    await triggerWorker(data.company_id);
    return res as {
      async?: boolean;
      integration_id: string;

      created_preco: number;
      created_estoque: number;
      created_produto?: number;
      created_criar?: number;
      created_lojas?: number;
      updated_existing: number;
      skipped_sem_bling_id: number;
      skipped_sem_deposito: number;
      skipped_sem_mudanca?: number;
    };
  });

export const enqueueBlingLinkStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      product_ids: z.array(z.string().uuid()).min(1),
      bling_store_id: z.string().min(1),
      action: z.enum(["link", "unlink"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    {
      const { assertNoActiveSync } = await import("@/lib/sync-lock.server");
      await assertNoActiveSync(data.company_id);
    }
    const { data: res, error } = await context.supabase.rpc("enqueue_bling_link_store", {
      _company_id: data.company_id,
      _product_ids: data.product_ids as any,
      _bling_store_id: data.bling_store_id,
      _action: data.action,
    });
    if (error) throw new Error(error.message);
    await triggerWorker(data.company_id);
    return res as {
      integration_id: string;
      action: "link" | "unlink";
      bling_store_id: string;
      enqueued: number;
      skipped: number;
    };
  });

export const enqueueBlingDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      product_ids: z.array(z.string().uuid()).min(1),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    {
      const { assertNoActiveSync } = await import("@/lib/sync-lock.server");
      await assertNoActiveSync(data.company_id);
    }
    const { data: res, error } = await context.supabase.rpc("enqueue_bling_delete", {
      _company_id: data.company_id,
      _product_ids: data.product_ids as any,
    });
    if (error) throw new Error(error.message);
    await triggerWorker(data.company_id);
    return res as {
      integration_id: string;
      created: number;
      updated_existing: number;
      skipped_sem_bling_id: number;
    };
  });


export const enqueueBlingInactivate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      product_ids: z.array(z.string().uuid()).min(1),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    {
      const { assertNoActiveSync } = await import("@/lib/sync-lock.server");
      await assertNoActiveSync(data.company_id);
    }
    const { data: res, error } = await context.supabase.rpc("enqueue_bling_inactivate", {
      _company_id: data.company_id,
      _product_ids: data.product_ids as any,
    });
    if (error) throw new Error(error.message);
    await triggerWorker(data.company_id);
    return res as {
      integration_id: string;
      created: number;
      updated_existing: number;
      skipped_sem_bling_id: number;
    };
  });


export const retryBlingPushErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("retry_bling_push_errors", { _company_id: data.company_id });
    if (error) throw new Error(error.message);
    await triggerWorker(data.company_id);
    return res as { reenfileirados: number };
  });

export const getBlingPushProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("get_bling_push_progress", { _company_id: data.company_id });
    if (error) throw new Error(error.message);
    return (res ?? {}) as {
      total: number; pendentes: number; pausados?: number; concluidos: number; erros: number;
      products_total?: number; products_done?: number;
      requests_total?: number; requests_done?: number;
      oldest_pending: string | null; last_processed: string | null;
    };
  });

export const pauseBlingPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("pause_bling_push", { _company_id: data.company_id });
    if (error) throw new Error(error.message);
    return res as { pausados: number };
  });

export const resumeBlingPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("resume_bling_push", { _company_id: data.company_id });
    if (error) throw new Error(error.message);
    await triggerWorker(data.company_id);
    return res as { retomados: number };
  });

export const cancelBlingPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("cancel_bling_push", { _company_id: data.company_id });
    if (error) throw new Error(error.message);
    return res as { cancelados: number };
  });

export const deleteBlingPushErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("delete_bling_push_errors", { _company_id: data.company_id });
    if (error) throw new Error(error.message);
    return res as { excluidos: number };
  });

export const listBlingPushErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: rows, error } = await context.supabase
      .from("bling_push_queue")
      .select("id, tipo, valor_anterior, valor_novo, tentativas, erro, last_response_status, updated_at, product_id, bling_product_id, bling_deposit_id")
      .eq("company_id", data.company_id)
      .eq("status", "erro")
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as any[];
    const ids = Array.from(new Set(list.map((r) => r.product_id).filter(Boolean)));
    const productMap: Record<string, { codigo: string | null; nome: string | null }> = {};
    if (ids.length > 0) {
      const { data: prods } = await context.supabase
        .from("bling_products")
        .select("id, codigo, nome")
        .in("id", ids);
      for (const p of (prods ?? []) as any[]) {
        productMap[p.id] = { codigo: p.codigo, nome: p.nome };
      }
    }
    return list.map((r) => ({
      ...r,
      product_codigo: productMap[r.product_id]?.codigo ?? null,
      product_nome: productMap[r.product_id]?.nome ?? null,
    }));
  });

/** Contagem de requisições feitas hoje (BRT) contra o Bling — usada para o limite de 120k/dia. */
export const getBlingDailyUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    // Lê o contador diário agregado (bling_api_usage_daily), atualizado por trigger a cada
    // chamada real ao Bling. Evita varrer centenas de milhares de linhas a cada polling.
    const start = new Date();
    start.setUTCHours(3, 0, 0, 0); // 00:00 BRT ≈ 03:00 UTC
    if (start.getTime() > Date.now()) start.setUTCDate(start.getUTCDate() - 1);
    const dia = start.toISOString().slice(0, 10);
    const { data: row, error } = await context.supabase
      .from("bling_api_usage_daily")
      .select("total")
      .eq("company_id", data.company_id)
      .eq("dia", dia)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const used = Number((row as { total?: number } | null)?.total ?? 0);
    const limit = 120000;
    return { used, limit, remaining: Math.max(0, limit - used), period_start: start.toISOString() };

  });

/** Últimos itens processados (com nome/código do produto) para exibir no card de progresso. */
export const getBlingPushRecent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    limit: z.number().int().min(1).max(50).default(8),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: rows, error } = await context.supabase
      .from("bling_push_queue")
      .select("id, tipo, status, valor_novo, processed_at, updated_at, claimed_at, created_at, product_id")
      .eq("company_id", data.company_id)
      .in("status", ["concluido", "erro"])
      .order("processed_at", { ascending: false, nullsFirst: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as any[];
    const ids = Array.from(new Set(list.map((r) => r.product_id).filter(Boolean)));
    const map: Record<string, { codigo: string | null; nome: string | null }> = {};
    if (ids.length > 0) {
      const { data: prods } = await context.supabase
        .from("bling_products").select("id, codigo, nome").in("id", ids);
      for (const p of (prods ?? []) as any[]) map[p.id] = { codigo: p.codigo, nome: p.nome };
    }
    return list.map((r) => ({
      ...r,
      product_codigo: map[r.product_id]?.codigo ?? null,
      product_nome: map[r.product_id]?.nome ?? null,
    }));
  });

/** Histórico paginado de itens da fila (todos os status). */
export const listBlingPushHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    limit: z.number().int().min(1).max(200).default(100),
    offset: z.number().int().min(0).default(0),
    status: z.enum(["concluido", "erro", "pendente", "pausado", "cancelado"]).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    // Busca até offset+limit de cada origem (fila de envio e campos customizados) e mescla por data.
    const take = data.offset + data.limit;
    const cfStatusOk = !data.status || data.status === "concluido" || data.status === "erro";
    let q = context.supabase
      .from("bling_push_queue")
      .select("id, tipo, status, valor_anterior, valor_novo, tentativas, erro, last_response_status, created_at, claimed_at, processed_at, updated_at, product_id, bling_product_id, depositos_log", { count: "exact" })
      .eq("company_id", data.company_id)
      .order("updated_at", { ascending: false })
      .range(0, take - 1);
    if (data.status) q = q.eq("status", data.status);
    let cq = (context.supabase as any)
      .from("bling_custom_field_logs")
      .select("id, status, campos, erro, response_status, duration_ms, created_at, product_id, product_codigo, product_nome", { count: "exact" })
      .eq("company_id", data.company_id)
      .order("created_at", { ascending: false })
      .range(0, take - 1);
    if (data.status) cq = cq.eq("status", data.status);
    const [{ data: rows, count, error }, cf] = await Promise.all([q, cfStatusOk ? cq : Promise.resolve({ data: [], count: 0, error: null })]);
    if (error) throw new Error(error.message);
    if (cf.error) throw new Error(cf.error.message);
    const list = (rows ?? []) as any[];
    const ids = Array.from(new Set(list.map((r) => r.product_id).filter(Boolean)));
    const map: Record<string, { codigo: string | null; nome: string | null }> = {};
    if (ids.length > 0) {
      const { data: prods } = await context.supabase
        .from("bling_products").select("id, codigo, nome").in("id", ids);
      for (const p of (prods ?? []) as any[]) map[p.id] = { codigo: p.codigo, nome: p.nome };
    }
    const pushItems = list.map((r) => ({
      ...r,
      product_codigo: map[r.product_id]?.codigo ?? null,
      product_nome: map[r.product_id]?.nome ?? null,
      duration_ms: r.claimed_at && r.processed_at
        ? Math.max(0, new Date(r.processed_at).getTime() - new Date(r.claimed_at).getTime())
        : null,
      sort_at: r.updated_at as string,
    }));
    const cfItems = ((cf.data ?? []) as any[]).map((r) => ({
      id: `cf-${r.id}`, tipo: "campos_customizados", status: r.status, valor_anterior: null, valor_novo: r.campos,
      erro: r.erro, last_response_status: r.status === "erro" ? r.response_status : null,
      processed_at: r.created_at, product_id: r.product_id, product_codigo: r.product_codigo, product_nome: r.product_nome,
      duration_ms: r.duration_ms, sort_at: r.created_at as string,
    }));
    const { expandDepositHistory } = await import("./push-history-deposits");
    const merged = expandDepositHistory([...pushItems, ...cfItems]
      .sort((a, b) => (b.sort_at ?? "").localeCompare(a.sort_at ?? ""))
      .slice(data.offset, take) as any[]);
    return { total: (count ?? 0) + (cf.count ?? 0), items: merged };
  });

export const setBlingDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      default_deposito_id: z.string().min(1).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("bling_integrations")
      .update({ default_deposito_id: data.default_deposito_id ?? null })
      .eq("company_id", data.company_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Trigger worker manually (useful if pg_net is disabled). */
export const kickBlingPushWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    await triggerWorker(data.company_id);
    return { ok: true };
  });

/** Linhas da planilha: SKU + ID da loja + novo ID na loja. */
const sheetRows = z
  .array(
    z.object({
      sku: z.string(),
      bling_store_id: z.string(),
      codigo: z.string(),
    }),
  )
  .min(1)
  .max(20000);

export const previewStoreCodeSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), rows: sheetRows }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await (context.supabase as any).rpc("preview_store_code_sheet", {
      _company_id: data.company_id,
      _rows: data.rows,
    });
    if (error) throw new Error(error.message);
    return res as {
      total: number; ok: number; ja_atualizado: number; sku_nao_encontrado: number;
      loja_nao_vinculada: number; sem_bling_id: number; sem_preco: number; dados_invalidos: number;
      amostra: Array<{
        linha: number; sku: string; bling_store_id: string; store_name: string | null;
        codigo_atual: string | null; codigo_novo: string; status: string;
      }>;
    };
  });

export const applyStoreCodeSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      rows: sheetRows,
      force_existing: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await (context.supabase as any).rpc("apply_store_code_sheet", {
      _company_id: data.company_id,
      _rows: data.rows,
      _force_existing: data.force_existing,
    });
    if (error) throw new Error(error.message);
    await triggerWorker(data.company_id);
    return res as {
      integration_id: string;
      enqueued: number;
      existing_enqueued: number;
      skipped: number;
      duplicadas: number;
    };
  });

export type StoreCodeMarketplace = "kabum" | "web_continental";
export type StoreCodeMarketplacePreview = {
  total: number;
  to_update: number;
  already_correct: number;
  skipped: number;
};

const marketplaceStoreCodeInput = z.object({
  company_id: z.string().uuid(),
  product_ids: z.array(z.string().uuid()).optional(),
  marketplace: z.enum(["kabum", "web_continental"]),
});

const applyMarketplaceStoreCodeInput = marketplaceStoreCodeInput.extend({
  force_existing: z.boolean(),
});

export const previewMarketplaceStoreCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => marketplaceStoreCodeInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: result, error } = await (context.supabase as any).rpc("preview_marketplace_store_code", {
      _company_id: data.company_id,
      _marketplace: data.marketplace,
      _product_ids: data.product_ids ?? null,
    });
    if (error) throw new Error(error.message);
    return result as StoreCodeMarketplacePreview;
  });

export const applyMarketplaceStoreCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => applyMarketplaceStoreCodeInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { assertNoActiveSync } = await import("@/lib/sync-lock.server");
    await assertNoActiveSync(data.company_id);
    const { data: result, error } = await (context.supabase as any).rpc("apply_marketplace_store_code", {
      _company_id: data.company_id,
      _marketplace: data.marketplace,
      _product_ids: data.product_ids ?? null,
      _force_existing: data.force_existing,
    });
    if (error) throw new Error(error.message);
    await triggerWorker(data.company_id);
    return result as { integration_id: string; enqueued: number; existing_enqueued: number; skipped: number };
  });
