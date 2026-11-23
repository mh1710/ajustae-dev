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

export type BlingSupplierJob = {
  id: string; status: string; next_page: number; pages_done: number; links_found: number;
  last_error: string | null; started_at: string; finished_at: string | null; lease_until: string | null;
  phase: string; details_checked: number; details_total: number;
};
export type BlingSupplierSummary = {
  suppliers: Array<{ bling_supplier_id: string; nome: string | null; supplier_codigo: string | null; products: number; prefixes?: Array<{ prefix: string; count: number }> }>;
  total_products: number;
  with_supplier: number;
  job: BlingSupplierJob | null;
};
export type ProductSupplierRow = {
  id: string; codigo: string | null; nome: string | null; situacao: string | null;
  expected_supplier: string | null;
  suppliers: Array<{ bling_supplier_id: string; nome: string | null; codigo: string | null; preco_custo: number | null; padrao: boolean }>;
};

export const startBlingSuppliersSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: running } = await db.from("bling_supplier_sync_jobs").select("id")
      .eq("company_id", data.company_id).in("status", ["executando", "pausado"]).limit(1).maybeSingle();
    if (running) throw new Error("Já existe uma busca de fornecedores em andamento ou pausada. Retome ou cancele antes.");
    const { data: integ } = await db.from("bling_integrations").select("id").eq("company_id", data.company_id).maybeSingle();
    if (!integ) throw new Error("Empresa sem integração com o Bling.");
    const { data: job, error } = await db.from("bling_supplier_sync_jobs")
      .insert({ company_id: data.company_id, integration_id: integ.id }).select("id").single();
    if (error) throw new Error(error.message);
    const { processSupplierSyncTick, enqueueSupplierTick } = await import("./bling-suppliers.server");
    const r = await processSupplierSyncTick(job.id, 15_000);
    if (!r.done && !r.stopped) await enqueueSupplierTick(job.id);
    return { job_id: job.id };
  });

export const getBlingSuppliersSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("list_bling_suppliers_summary", { _company_id: data.company_id });
    if (error) throw new Error(error.message);
    const summary = res as BlingSupplierSummary;
    // Recupera job parado sem worker ativo (lease vencida há mais de 2 minutos).
    const j = summary.job;
    if (j && j.status === "executando") {
      const stale = !j.lease_until || new Date(j.lease_until).getTime() < Date.now() - 120_000;
      if (stale) {
        const { enqueueSupplierTick } = await import("./bling-suppliers.server");
        await enqueueSupplierTick(j.id).catch(() => undefined);
      }
    }
    return summary;
  });

export const controlBlingSuppliersSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), job_id: z.string().uuid(), action: z.enum(["pause", "resume", "cancel"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const status = data.action === "pause" ? "pausado" : data.action === "cancel" ? "cancelado" : "executando";
    const patch: Record<string, unknown> = { status, lease_until: null };
    if (data.action === "cancel") patch.finished_at = new Date().toISOString();
    if (data.action === "resume") patch.last_error = null;
    const { error } = await db.from("bling_supplier_sync_jobs").update(patch)
      .eq("id", data.job_id).eq("company_id", data.company_id);
    if (error) throw new Error(error.message);
    if (data.action === "resume") {
      const { enqueueSupplierTick } = await import("./bling-suppliers.server");
      await enqueueSupplierTick(data.job_id);
    }
    return { ok: true };
  });

export const listProductsWithSuppliers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      filter: z.enum(["all", "with", "without"]).default("all"),
      bling_supplier_id: z.string().nullable().optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("list_products_with_suppliers", {
      _company_id: data.company_id, _filter: data.filter, _bling_supplier_id: data.bling_supplier_id ?? null,
      _search: data.search?.trim() || null, _limit: data.limit, _offset: data.offset,
    });
    if (error) throw new Error(error.message);
    return res as { total: number; items: ProductSupplierRow[] };
  });

export const setBlingSupplierMap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), bling_supplier_id: z.string().min(1), supplier_codigo: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("set_bling_supplier_map", {
      _company_id: data.company_id, _bling_supplier_id: data.bling_supplier_id, _supplier_codigo: data.supplier_codigo,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const enqueueSupplierLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      mode: z.enum(["prefix", "manual"]),
      product_ids: z.array(z.string().uuid()).max(50000).nullable().optional(),
      bling_supplier_id: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await (context.supabase as any).rpc("enqueue_supplier_links", {
      _company_id: data.company_id, _mode: data.mode,
      _product_ids: data.product_ids && data.product_ids.length > 0 ? data.product_ids : null,
      _bling_supplier_id: data.bling_supplier_id ?? null,
    });
    if (error) throw new Error(error.message);
    const r = res as { enqueued: number; skipped: number; no_cost?: number };
    if (r.enqueued > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const base = (process.env.APP_PUBLIC_URL ?? "").replace(/\/$/, "");
      const secret = process.env.BLING_WORKER_SECRET ?? "";
      const { data: integ } = await (supabaseAdmin as any).from("bling_integrations").select("id").eq("company_id", data.company_id).maybeSingle();
      if (base && secret && integ) {
        await (supabaseAdmin as any).rpc("enqueue_bling_sync_tick", {
          _url: `${base}/api/public/bling/push-tick`, _secret: secret, _job_id: integ.id,
        });
      }
    }
    return r;
  });
