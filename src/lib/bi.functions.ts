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

async function triggerOrdersWorker(jobId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const base = (process.env.APP_PUBLIC_URL ?? "").replace(/\/$/, "");
  const secret = process.env.BLING_WORKER_SECRET ?? "";
  if (!base || !secret) return false;
  const { error } = await supabaseAdmin.rpc("enqueue_bling_sync_tick", {
    _url: `${base}/api/public/bling/orders-tick`,
    _secret: secret,
    _job_id: jobId,
  });
  return !error;
}


/** Inicia (ou retoma) a sincronização de pedidos. Incremental por padrão. */
export const startOrdersSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        mode: z.enum(["incremental", "full"]).default("incremental"),
        date_from: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { assertNoActiveSync } = await import('./sync-lock.server');
    await assertNoActiveSync(data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Considera "rodando" apenas jobs com atividade recente; jobs abandonados
    // (worker interrompido) são finalizados para não travar novas execuções.
    const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from("bling_orders_sync_jobs")
      .update({
        status: "erro",
        last_error: "Execução interrompida (worker sem resposta).",
        finished_at: new Date().toISOString(),
      } as any)
      .eq("company_id", data.company_id)
      .in("status", ["pendente", "executando"])
      .lt("updated_at", staleCutoff);

    const { data: running } = await supabaseAdmin
      .from("bling_orders_sync_jobs")
      .select("id, status")
      .eq("company_id", data.company_id)
      .in("status", ["pendente", "executando"])
      .maybeSingle();
    if (running) return { job_id: (running as any).id as string, already_running: true };


    const { data: integ } = await supabaseAdmin
      .from("bling_integrations")
      .select("id")
      .eq("company_id", data.company_id)
      .maybeSingle();
    if (!integ) throw new Error("Integração Bling não conectada para esta empresa.");

    let changedSince: string | null = null;
    if (data.mode === "incremental") {
      const { data: state } = await supabaseAdmin
        .from("bling_orders_sync_state")
        .select("last_synced_at")
        .eq("company_id", data.company_id)
        .maybeSingle();
      const last = (state as any)?.last_synced_at as string | null;
      if (last) {
        // Recua 1h para cobrir pedidos alterados durante a última execução.
        changedSince = new Date(new Date(last).getTime() - 60 * 60 * 1000).toISOString();
      }
    }

    const dateFrom =
      data.date_from ??
      (changedSince
        ? null
        : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));

    const { data: job, error } = await supabaseAdmin
      .from("bling_orders_sync_jobs")
      .insert({
        company_id: data.company_id,
        integration_id: (integ as any).id,
        mode: changedSince ? "incremental" : "full",
        status: "pendente",
        changed_since: changedSince,
        date_from: dateFrom,
        run_started_at: new Date().toISOString(),
      } as any)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const jobId = (job as any).id as string;
    // Dispara o worker em segundo plano (pg_net). Só executa um ciclo inline
    // quando o disparo não estiver disponível, para não estourar o tempo da requisição.
    const triggered = await triggerOrdersWorker(jobId);
    if (!triggered) {
      const { processOrdersSyncTick } = await import("./bling-orders.server");
      const result = await processOrdersSyncTick(jobId);
      return { job_id: jobId, already_running: false, ...result };
    }
    return { job_id: jobId, already_running: false, done: false, status: "pendente" };
  });


export const getOrdersSyncStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: job } = await context.supabase
      .from("bling_orders_sync_jobs")
      .select("*")
      .eq("company_id", data.company_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: state } = await context.supabase
      .from("bling_orders_sync_state")
      .select("*")
      .eq("company_id", data.company_id)
      .maybeSingle();
    return { job: job ?? null, state: state ?? null };
  });

export const cancelOrdersSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Marca o cancelamento e encerra imediatamente: se um worker ainda estiver
    // rodando, ele também respeita o flag no próximo ciclo e para.
    await supabaseAdmin
      .from("bling_orders_sync_jobs")
      .update({
        cancel_requested: true,
        status: "cancelada",
        finished_at: new Date().toISOString(),
      } as any)
      .eq("company_id", data.company_id)
      .in("status", ["pendente", "executando"]);
    return { ok: true };
  });


export const listOrdersSyncHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: rows, error } = await context.supabase
      .from("bling_orders_sync_jobs")
      .select("*")
      .eq("company_id", data.company_id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const periodSchema = z.object({
  company_id: z.string().uuid(),
  from: z.string(),
  to: z.string(),
});

export const getSalesKpis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => periodSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("bi_sales_kpis" as any, {
      _company_id: data.company_id,
      _from: data.from,
      _to: data.to,
    });
    if (error) throw new Error(error.message);
    return (res ?? {}) as any;
  });

export const getDreReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => periodSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("dre_report" as any, {
      _company_id: data.company_id,
      _from: data.from,
      _to: data.to,
    });
    if (error) throw new Error(error.message);
    return (res ?? {}) as any;
  });

export const listOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        from: z.string(),
        to: z.string(),
        search: z.string().optional(),
        loja_id: z.string().optional(),
        page: z.number().int().min(1).default(1),
        per_page: z.number().int().min(1).max(200).default(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    let q = context.supabase
      .from("bling_orders")
      .select(
        "id, bling_order_id, numero, data, situacao_nome, loja_id, loja_nome, contato_nome, total, custo_total, taxa_percent, items_count",
        { count: "exact" },
      )
      .eq("company_id", data.company_id)
      .gte("data", data.from)
      .lte("data", data.to)
      .order("data", { ascending: false });
    if (data.loja_id && data.loja_id !== "all") q = q.eq("loja_id", data.loja_id);
    if (data.search) {
      const s = data.search.replace(/[%,]/g, "");
      q = q.or(`numero.ilike.%${s}%,contato_nome.ilike.%${s}%`);
    }
    const fromIdx = (data.page - 1) * data.per_page;
    const { data: rows, count, error } = await q.range(fromIdx, fromIdx + data.per_page - 1);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

/** Detalhe completo de um pedido: cabeçalho, itens, entrega e contato do cliente. */
export const getOrderDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), order_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: order, error } = await context.supabase
      .from("bling_orders")
      .select("*")
      .eq("company_id", data.company_id)
      .eq("id", data.order_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Pedido não encontrado.");

    const { data: items } = await context.supabase
      .from("bling_order_items")
      .select("id, codigo, descricao, quantidade, valor_unitario, desconto, total, custo_unitario, custo_total, bling_product_id, product_id")
      .eq("order_id", data.order_id)
      .order("codigo", { ascending: true });

    const raw = (order as any).raw_json ?? {};
    const etiqueta = raw?.transporte?.etiqueta ?? {};
    const entrega: Record<string, string | null> = {
      nome: (etiqueta.nome as string) ?? null,
      endereco: etiqueta.endereco ?? null,
      numero: etiqueta.numero ?? null,
      complemento: etiqueta.complemento ?? null,
      bairro: etiqueta.bairro ?? null,
      municipio: etiqueta.municipio ?? (order as any).cidade ?? null,
      uf: etiqueta.uf ?? (order as any).uf ?? null,
      cep: etiqueta.cep ?? null,
      transportadora: raw?.transporte?.volumes?.[0]?.servico ?? raw?.transporte?.contato?.nome ?? null,
      rastreamento: raw?.transporte?.volumes?.[0]?.codigoRastreamento ?? null,
    };

    // Contato completo (e-mail/telefone) não vem no pedido; busca sob demanda no Bling.
    let contato: {
      nome: string | null; documento: string | null; email: string | null;
      telefone: string | null; celular: string | null; endereco: string | null;
    } | null = null;
    const contatoId = (order as any).contato_id;
    if (contatoId) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { blingApiGet } = await import("./bling.server");
        const { data: integ } = await supabaseAdmin
          .from("bling_integrations")
          .select("id, company_id, access_token, refresh_token, token_expires_at, status")
          .eq("company_id", data.company_id)
          .maybeSingle();
        if (integ && (integ as any).access_token) {
          const res = await blingApiGet<{ data?: any }>(integ as any, `/contatos/${contatoId}`);
          const c = res.ok ? res.data?.data : null;
          if (c) {
            const g = c.endereco?.geral;
            contato = {
              nome: (c.nome as string) ?? null,
              documento: (c.numeroDocumento as string) ?? null,
              email: (c.email as string) ?? null,
              telefone: (c.telefone as string) ?? null,
              celular: (c.celular as string) ?? null,
              endereco: g ? [g.endereco, g.numero, g.bairro, g.municipio, g.uf, g.cep].filter(Boolean).join(", ") : null,
            };
          }
        }
      } catch {
        contato = null;
      }
    }
    if (!contato) {
      contato = {
        nome: ((order as any).contato_nome as string) ?? (raw?.contato?.nome as string) ?? null,
        documento: ((order as any).contato_documento as string) ?? raw?.contato?.numeroDocumento ?? null,
        email: (raw?.contato?.email as string) ?? null,
        telefone: (raw?.contato?.telefone as string) ?? null,
        celular: null,
        endereco: null,
      };
    }

    const { raw_json: _raw, ...header } = order as any;
    return { order: header as Record<string, string | number | boolean | null>, items: items ?? [], entrega, contato };
  });



export const listDreExpenses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => periodSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: rows, error } = await context.supabase
      .from("dre_expenses")
      .select("*")
      .eq("company_id", data.company_id)
      .gte("competencia", data.from.slice(0, 8) + "01")
      .lte("competencia", data.to)
      .order("competencia", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveDreExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        id: z.string().uuid().optional(),
        competencia: z.string(),
        categoria: z.string().min(1),
        descricao: z.string().optional(),
        tipo: z.enum(["fixa", "variavel"]).default("fixa"),
        valor: z.number(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const payload = {
      company_id: data.company_id,
      competencia: data.competencia,
      categoria: data.categoria,
      descricao: data.descricao ?? null,
      tipo: data.tipo,
      valor: data.valor,
      created_by: context.userId,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("dre_expenses")
        .update(payload as any)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase.from("dre_expenses").insert(payload as any);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteDreExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { error } = await context.supabase.from("dre_expenses").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
