import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertMember(ctx: { supabase: any; userId: string }, companyId: string) {
  const { data, error } = await ctx.supabase
    .from("company_users")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", ctx.userId)
    .eq("ativo", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sem acesso a esta empresa.");
}

export type AutomationStep = {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "error" | "skipped";
  detail?: string;
  ms?: number;
};

/** Marca inativo produtos sem fornecedor e ativa produtos com fornecedor e estoque. */
export const applySupplierStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), run_id: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await (context.supabase as any).rpc(
      "automation_apply_supplier_status",
      { _company_id: data.company_id, _run_id: data.run_id ?? null },
    );
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as {
      inactivated?: number;
      activated?: number;
      inactivate_ids?: string[];
      activate_ids?: string[];
    };
    return {
      inactivated: Number(r.inactivated ?? 0),
      activated: Number(r.activated ?? 0),
      inactivate_ids: r.inactivate_ids ?? [],
      activate_ids: r.activate_ids ?? [],
    };
  });

export const startAutomationRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), slug: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: row, error } = await (context.supabase as any)
      .from("automation_runs")
      .insert({
        company_id: data.company_id,
        user_id: context.userId,
        slug: data.slug,
        status: "running",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { run_id: row.id as string };
  });

export const updateAutomationRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      run_id: z.string().uuid(),
      status: z.enum(["running", "success", "error", "cancelled"]).optional(),
      current_step: z.string().nullable().optional(),
      steps: z.array(z.any()).optional(),
      result: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      error: z.string().nullable().optional(),
      finished: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.status) patch.status = data.status;
    if (data.current_step !== undefined) patch.current_step = data.current_step;
    if (data.steps) patch.steps = data.steps;
    if (data.result) patch.result = data.result;
    if (data.error !== undefined) patch.error = data.error;
    if (data.finished) patch.finished_at = new Date().toISOString();
    const { error } = await (context.supabase as any)
      .from("automation_runs")
      .update(patch)
      .eq("id", data.run_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAutomationRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), limit: z.number().int().min(1).max(50).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: rows, error } = await (context.supabase as any)
      .from("automation_runs")
      .select("id, slug, status, current_step, steps, result, error, started_at, finished_at")
      .eq("company_id", data.company_id)
      .order("started_at", { ascending: false })
      .limit(data.limit ?? 15);
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{
      id: string;
      slug: string;
      status: string;
      current_step: string | null;
      steps: AutomationStep[];
      result: Record<string, number | string | boolean | null>;
      error: string | null;
      started_at: string;
      finished_at: string | null;
    }>;
  });

// ============ Agendamentos ============

const scheduleShape = {
  company_id: z.string().uuid(),
  slug: z.string().min(1).default("estoque-preco-fornecedor"),
  name: z.string().min(1).default("Automação programada"),
  enabled: z.boolean().default(true),
  frequency: z.enum(["daily", "weekly", "monthly", "interval", "times_per_day"]),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  day_of_month: z.number().int().min(1).max(28).nullable().optional(),
  interval_days: z.number().int().min(1).max(365).nullable().optional(),
  times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(12).nullable().optional(),
  include_stores: z.boolean().default(true),
  apply_status: z.boolean().default(true),
  only_changed: z.boolean().default(true),
  consider_ml_stock: z.boolean().default(true),
};

export type AutomationSchedule = {
  id: string;
  company_id: string;
  slug: string;
  name: string;
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly" | "interval" | "times_per_day";
  times?: string[] | null;
  hour: number;
  minute: number;
  weekday: number | null;
  day_of_month: number | null;
  interval_days: number | null;
  timezone: string;
  options: { include_stores?: boolean; apply_status?: boolean; only_changed?: boolean; consider_ml_stock?: boolean };
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
};

export const listAutomationSchedules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: rows, error } = await (context.supabase as any)
      .from("automation_schedules")
      .select("id, company_id, slug, name, enabled, frequency, hour, minute, weekday, day_of_month, interval_days, times, timezone, options, next_run_at, last_run_at, last_status")
      .eq("company_id", data.company_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as AutomationSchedule[];
  });

export const saveAutomationSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid().optional(), ...scheduleShape }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const sb = context.supabase as any;

    const { data: next, error: nextErr } = await sb.rpc("automation_next_run", {
      _frequency: data.frequency,
      _hour: data.hour,
      _minute: data.minute,
      _weekday: data.weekday ?? null,
      _day_of_month: data.day_of_month ?? null,
      _interval_days: data.interval_days ?? null,
      _timezone: "America/Sao_Paulo",
      _from: new Date().toISOString(),
      _times: data.times ?? null,
    });
    if (nextErr) throw new Error(nextErr.message);

    const row = {
      company_id: data.company_id,
      created_by: context.userId,
      slug: data.slug,
      name: data.name,
      enabled: data.enabled,
      frequency: data.frequency,
      hour: data.hour,
      minute: data.minute,
      weekday: data.frequency === "weekly" ? data.weekday ?? 1 : null,
      day_of_month: data.frequency === "monthly" ? data.day_of_month ?? 1 : null,
      interval_days: data.frequency === "interval" ? data.interval_days ?? 1 : null,
      times: data.frequency === "times_per_day" ? data.times ?? [] : null,
      timezone: "America/Sao_Paulo",
      options: {
        include_stores: data.include_stores,
        apply_status: data.apply_status,
        only_changed: data.only_changed,
        consider_ml_stock: data.consider_ml_stock,
      },
      next_run_at: data.enabled ? next : null,
    };

    if (data.id) {
      const { error } = await sb.from("automation_schedules").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: ins, error } = await sb.from("automation_schedules").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { id: ins.id as string };
  });

export const toggleAutomationSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), company_id: z.string().uuid(), enabled: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const sb = context.supabase as any;
    const { data: row, error: e0 } = await sb
      .from("automation_schedules")
      .select("frequency, hour, minute, weekday, day_of_month, interval_days, times, timezone")
      .eq("id", data.id)
      .single();
    if (e0) throw new Error(e0.message);
    let next: string | null = null;
    if (data.enabled) {
      const { data: n, error: e1 } = await sb.rpc("automation_next_run", {
        _frequency: row.frequency,
        _hour: row.hour,
        _minute: row.minute,
        _weekday: row.weekday,
        _day_of_month: row.day_of_month,
        _interval_days: row.interval_days,
        _timezone: row.timezone,
        _from: new Date().toISOString(),
        _times: row.times ?? null,
      });
      if (e1) throw new Error(e1.message);
      next = n as string;
    }
    const { error } = await sb
      .from("automation_schedules")
      .update({ enabled: data.enabled, next_run_at: next })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, next_run_at: next };
  });

export const deleteAutomationSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), company_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { error } = await (context.supabase as any)
      .from("automation_schedules")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export type AutomationChangeType =
  | "preco_venda"
  | "preco_custo"
  | "estoque"
  | "preco_loja"
  | "ativado"
  | "inativado";

export type AutomationChange = {
  id: number;
  sku: string | null;
  nome: string | null;
  tipo: string;
  loja_id: string | null;
  loja_nome: string | null;
  valor_anterior: string | null;
  valor_novo: string | null;
};

/** Resumo por tipo de alteração de uma execução. */
export const getAutomationRunReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ run_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("automation_run_report", {
      _run_id: data.run_id,
    });
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as { resumo?: Record<string, number>; total?: number };
    return { resumo: r.resumo ?? {}, total: Number(r.total ?? 0) };
  });

/** Lista as alterações registradas em uma execução (paginado). */
export const listAutomationChanges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      run_id: z.string().uuid(),
      tipo: z.string().optional(),
      search: z.string().optional(),
      page: z.number().int().min(1).default(1),
      page_size: z.number().int().min(1).max(500).default(50),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const from = (data.page - 1) * data.page_size;
    let q = (context.supabase as any)
      .from("automation_changes")
      .select("id, sku, nome, tipo, loja_id, loja_nome, valor_anterior, valor_novo", { count: "exact" })
      .eq("run_id", data.run_id)
      .order("id", { ascending: true })
      .range(from, from + data.page_size - 1);
    if (data.tipo && data.tipo !== "todos") q = q.eq("tipo", data.tipo);
    if (data.search?.trim()) {
      const term = `%${data.search.trim()}%`;
      q = q.or(`sku.ilike.${term},nome.ilike.${term}`);
    }
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: (rows ?? []) as AutomationChange[], total: count ?? 0 };
  });

/** Todas as alterações de uma execução, para exportar em CSV. */
export const exportAutomationChanges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ run_id: z.string().uuid(), tipo: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows: AutomationChange[] = [];
    const CHUNK = 1000;
    for (let page = 0; page < 200; page++) {
      let q = (context.supabase as any)
        .from("automation_changes")
        .select("id, sku, nome, tipo, loja_id, loja_nome, valor_anterior, valor_novo")
        .eq("run_id", data.run_id)
        .order("id", { ascending: true })
        .range(page * CHUNK, page * CHUNK + CHUNK - 1);
      if (data.tipo && data.tipo !== "todos") q = q.eq("tipo", data.tipo);
      const { data: chunk, error } = await q;
      if (error) throw new Error(error.message);
      const list = (chunk ?? []) as AutomationChange[];
      rows.push(...list);
      if (list.length < CHUNK) break;
    }
    const esc = (v: unknown) => {
      const s2 = v == null ? "" : String(v);
      return /[";\n]/.test(s2) ? `"${s2.replace(/"/g, '""')}"` : s2;
    };
    const header = ["SKU", "Produto", "Alteração", "Loja", "Antes", "Depois"];
    const csv = [header.join(";")]
      .concat(
        rows.map((r) =>
          [r.sku, r.nome, r.tipo, r.loja_nome ?? r.loja_id ?? "", r.valor_anterior, r.valor_novo]
            .map(esc)
            .join(";"),
        ),
      )
      .join("\n");
    return { csv, count: rows.length };
  });

// ============ Automação de estoque (multi-empresa) ============

export type StockAutomationRow = AutomationSchedule & {
  running?: boolean;
  queue?: { total: number; pendentes: number; pausados: number; concluidos: number; erros: number } | null;
  run?: {
    id: string;
    status: string;
    current_step: string | null;
    steps: AutomationStep[];
    started_at: string;
    finished_at: string | null;
    error: string | null;
  } | null;
  integration?: { status: string | null; last_error: string | null } | null;
};

/** Lista os agendamentos de todas as empresas do usuário (RLS filtra). */
export const listMyAutomationSchedules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ slug: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    let q = sb
      .from("automation_schedules")
      .select("id, company_id, slug, name, enabled, frequency, hour, minute, weekday, day_of_month, interval_days, times, timezone, options, next_run_at, last_run_at, last_run_id, last_status, created_at")
      .order("created_at", { ascending: true });
    if (data.slug) q = q.eq("slug", data.slug);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const schedules = (rows ?? []) as (AutomationSchedule & {
      last_run_id?: string | null;
      created_at?: string | null;
    })[];
    const companyIds = Array.from(new Set(schedules.map((r) => r.company_id)));

    // Execução mais recente por empresa, mas só conta se pertencer a ESTE
    // agendamento: mesma automação e iniciada depois que ele foi criado. Assim
    // uma programação nova não herda o progresso de execuções antigas/excluídas.
    type RunInfo = NonNullable<StockAutomationRow["run"]> & { company_id: string; slug: string };
    const runsByCompany = new Map<string, RunInfo[]>();
    if (companyIds.length > 0) {
      const { data: runs } = await sb
        .from("automation_runs")
        .select("id, company_id, slug, status, current_step, steps, started_at, finished_at, error")
        .in("company_id", companyIds)
        .order("started_at", { ascending: false })
        .limit(300);
      for (const r of (runs ?? []) as any[]) {
        const list = runsByCompany.get(r.company_id) ?? [];
        list.push({
          id: r.id,
          company_id: r.company_id,
          slug: r.slug,
          status: r.status,
          current_step: r.current_step ?? null,
          steps: Array.isArray(r.steps) ? (r.steps as AutomationStep[]) : [],
          started_at: r.started_at,
          finished_at: r.finished_at ?? null,
          error: r.error ?? null,
        });
        runsByCompany.set(r.company_id, list);
      }
    }

    function runForSchedule(s: (typeof schedules)[number]): NonNullable<StockAutomationRow["run"]> | null {
      if (s.last_run_id) {
        const byId = (runsByCompany.get(s.company_id) ?? []).find((r) => r.id === s.last_run_id);
        if (byId) return byId;
      }
      const createdAt = s.created_at ? new Date(s.created_at).getTime() : 0;
      const match = (runsByCompany.get(s.company_id) ?? []).find(
        (r) => r.slug === s.slug && new Date(r.started_at).getTime() >= createdAt,
      );
      return match ?? null;
    }

    // Progresso da fila de envio ao Bling, contando SOMENTE os itens
    // enfileirados a partir do início da execução atual do agendamento.
    async function queueSince(companyId: string, since: string) {
      async function count(statuses: string[]) {
        const { count: c } = await sb
          .from("bling_push_queue")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .gte("created_at", since)
          .in("status", statuses);
        return Number(c ?? 0);
      }
      const [pendentes, pausados, concluidos, erros, processando] = await Promise.all([
        count(["pendente"]),
        count(["pausado"]),
        count(["concluido"]),
        count(["erro"]),
        count(["processando"]),
      ]);
      return {
        total: pendentes + pausados + concluidos + erros + processando,
        pendentes: pendentes + processando,
        pausados,
        concluidos,
        erros,
      };
    }

    // Estado da conexão com o Bling (para mostrar o motivo real da falha)
    const integByCompany = new Map<string, { status: string | null; last_error: string | null }>();
    if (companyIds.length > 0) {
      const { data: integs } = await sb
        .from("bling_integrations")
        .select("company_id, status, last_error")
        .in("company_id", companyIds);
      for (const i of (integs ?? []) as any[]) {
        integByCompany.set(i.company_id, { status: i.status ?? null, last_error: i.last_error ?? null });
      }
    }

    return await Promise.all(
      schedules.map(async (r) => {
        const run = runForSchedule(r);
        const running =
          !!run &&
          run.status === "running" &&
          !run.finished_at &&
          Date.now() - new Date(run.started_at).getTime() < 2 * 60 * 60 * 1000;
        return {
          ...r,
          running,
          run,
          // Somente a fila gerada pela execução deste agendamento.
          queue: run ? await queueSince(r.company_id, run.started_at) : null,
          integration: integByCompany.get(r.company_id) ?? null,
        } as StockAutomationRow;
      }),
    );
  });


/** Cria/atualiza a mesma automação de estoque para várias empresas de uma vez. */
export const saveStockAutomationForCompanies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_ids: z.array(z.string().uuid()).min(1),
      name: z.string().min(1).default("Automação de estoque"),
      frequency: z.enum(["daily", "weekly", "monthly", "interval", "times_per_day"]),
      times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(12).nullable().optional(),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
      weekday: z.number().int().min(0).max(6).nullable().optional(),
      day_of_month: z.number().int().min(1).max(28).nullable().optional(),
      interval_days: z.number().int().min(1).max(365).nullable().optional(),
      include_stores: z.boolean().default(true),
      apply_status: z.boolean().default(true),
      only_changed: z.boolean().default(true),
      consider_ml_stock: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const slug = "estoque-preco-fornecedor";

    const { data: next, error: nextErr } = await sb.rpc("automation_next_run", {
      _frequency: data.frequency,
      _hour: data.hour,
      _minute: data.minute,
      _weekday: data.weekday ?? null,
      _day_of_month: data.day_of_month ?? null,
      _interval_days: data.interval_days ?? null,
      _timezone: "America/Sao_Paulo",
      _from: new Date().toISOString(),
      _times: data.times ?? null,
    });
    if (nextErr) throw new Error(nextErr.message);

    const saved: string[] = [];
    for (const companyId of data.company_ids) {
      await assertMember(context, companyId);
      const row = {
        company_id: companyId,
        created_by: context.userId,
        slug,
        name: data.name,
        enabled: true,
        frequency: data.frequency,
        hour: data.hour,
        minute: data.minute,
        weekday: data.frequency === "weekly" ? data.weekday ?? 1 : null,
        day_of_month: data.frequency === "monthly" ? data.day_of_month ?? 1 : null,
        interval_days: data.frequency === "interval" ? data.interval_days ?? 1 : null,
        times: data.frequency === "times_per_day" ? data.times ?? [] : null,
        timezone: "America/Sao_Paulo",
        options: {
          include_stores: data.include_stores,
          apply_status: data.apply_status,
          only_changed: data.only_changed,
          consider_ml_stock: data.consider_ml_stock,
        },
        next_run_at: next,
      };

      const { data: existing } = await sb
        .from("automation_schedules")
        .select("id")
        .eq("company_id", companyId)
        .eq("slug", slug)
        .eq("name", data.name)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await sb.from("automation_schedules").update(row).eq("id", existing.id);
        if (error) throw new Error(error.message);
        saved.push(existing.id as string);
      } else {
        const { data: ins, error } = await sb
          .from("automation_schedules")
          .insert(row)
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        saved.push(ins.id as string);
      }
    }
    return { saved: saved.length, next_run_at: next as string };
  });

/** Remove vários agendamentos de uma vez. */
export const deleteAutomationSchedules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("automation_schedules")
      .delete()
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { ok: true, deleted: data.ids.length };
  });
