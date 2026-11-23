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

/** Sorteia a amostra (padrão 10%) de produtos com estoque e zerados. */
export const startStockSyncAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        sample_pct: z.number().min(1).max(100).default(10),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const { data: integ } = await db
      .from("bling_integrations")
      .select("id, status")
      .eq("company_id", data.company_id)
      .maybeSingle();
    if (!integ || !(integ as any).id) throw new Error("Esta empresa não tem integração com o Bling.");

    const { data: res, error } = await db.rpc("start_stock_sync_audit", {
      _company_id: data.company_id,
      _user_id: context.userId,
      _pct: data.sample_pct,
    });
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as { run_id: string; total: number; com_estoque: number; zerados: number };
    return r;
  });

/** Compara um lote de produtos com o saldo atual no Bling. */
export const runStockAuditBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        run_id: z.string().uuid(),
        batch_size: z.number().int().min(10).max(200).default(100),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { runStockAuditBatchServer } = await import("./stock-audit.server");

    const { data: run, error } = await db
      .from("stock_audit_runs")
      .select("*")
      .eq("id", data.run_id)
      .single();
    if (error || !run) throw new Error(error?.message ?? "Auditoria não encontrada");
    await assertMember(context, (run as any).company_id);

    return runStockAuditBatchServer(data.run_id, data.batch_size);
  });

export const cancelStockAuditRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ run_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: run, error } = await db
      .from("stock_audit_runs")
      .select("id, company_id, status")
      .eq("id", data.run_id)
      .single();
    if (error || !run) throw new Error(error?.message ?? "Auditoria não encontrada");
    await assertMember(context, (run as any).company_id);
    await db
      .from("stock_audit_runs")
      .update({ status: "cancelada", finished_at: new Date().toISOString() })
      .eq("id", data.run_id);
    return { ok: true };
  });

export const getStockAuditRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ run_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: run, error } = await (context.supabase as any)
      .from("stock_audit_runs")
      .select("*")
      .eq("id", data.run_id)
      .single();
    if (error) throw new Error(error.message);
    return run;
  });

export const listStockAuditRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("stock_audit_runs")
      .select("*")
      .eq("company_id", data.company_id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listStockAuditItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        run_id: z.string().uuid(),
        only_divergent: z.boolean().default(true),
        limit: z.number().int().min(1).max(10000).default(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = (context.supabase as any)
      .from("stock_audit_items")
      .select("id, codigo, nome, bucket, estoque_local, estoque_bling, diferenca, status, detalhe")
      .eq("run_id", data.run_id)
      .limit(data.limit);
    if (data.only_divergent) q = q.in("status", ["divergente", "nao_encontrado", "erro"]);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
