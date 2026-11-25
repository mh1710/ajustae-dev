import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Db = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>, opts?: Record<string, unknown>) => any };

async function admin(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

/** Membro ativo da empresa e sem acesso restrito (contas de empresa não importam produtos). */
async function assertAccess(context: { supabase: any; userId: string }, companyId: string) {
  const [{ data: member, error }, { data: roles, error: roleError }] = await Promise.all([
    context.supabase.from("company_users").select("id").eq("company_id", companyId).eq("user_id", context.userId).eq("ativo", true).maybeSingle(),
    context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
  ]);
  if (error || roleError || !member || (roles ?? []).some((r: { role: string }) => r.role === "company_viewer"))
    throw new Error("Sem permissão para importar produtos nesta empresa.");
}

async function jobOf(db: Db, jobId: string) {
  const { data, error } = await db.from("supplier_catalog_import_jobs").select("id,company_id").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Importação não encontrada.");
  return data as { id: string; company_id: string };
}

export type SupplierCatalogSummary = {
  fornecedor_id: string; codigo: string; nome: string; prefixo: string | null; ativos: number; fora_catalogo: number;
  elegiveis: number; com_estoque: number; completos: number; fora_custo: number; fora_peso: number; fora_comprimento: number;
  /** Elegíveis já conferidos pelo scanner e quantos ficaram prontos (100%). */
  escaneados: number; prontos_scanner: number; ultimo_scanner: string | null;
};

export type ScanResult = { status: "pronto" | "pendencia" | "erro"; issues: string[]; scanned_at: string };

export const getSupplierCatalogSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAccess(context, data.company_id);
    const db = await admin();
    const { data: rows, error } = await db.rpc("supplier_catalog_summary", { _company_id: data.company_id });
    if (error) throw new Error(error.message);
    return (rows ?? []) as SupplierCatalogSummary[];
  });

export const listSupplierCatalogCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(), fornecedor_id: z.string().uuid(),
    page: z.number().int().min(1).default(1), page_size: z.number().int().min(1).max(200).default(50),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAccess(context, data.company_id);
    const db = await admin();
    const from = (data.page - 1) * data.page_size;
    const { data: rows, error, count } = await db
      .rpc("supplier_catalog_candidates", { _company_id: data.company_id, _fornecedor_id: data.fornecedor_id }, { count: "exact" })
      .is("motivo", null).order("completo", { ascending: false }).order("codigo").range(from, from + data.page_size - 1);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<{ fornecedor_produto_id: string; codigo: string; titulo: string | null; marca: string | null; ean: string | null; custo: number | null; qt_estoque: number | null; completo: boolean; fotos: number }>;
    const scans = new Map<string, ScanResult>();
    if (list.length) {
      const { data: sc, error: scError } = await db.from("supplier_catalog_scan").select("fornecedor_produto_id,status,issues,scanned_at")
        .eq("company_id", data.company_id).in("fornecedor_produto_id", list.map(r => r.fornecedor_produto_id));
      if (scError) throw new Error(scError.message);
      for (const r of (sc ?? []) as Array<ScanResult & { fornecedor_produto_id: string }>) scans.set(r.fornecedor_produto_id, { status: r.status, issues: r.issues ?? [], scanned_at: r.scanned_at });
    }
    return { rows: list.map(r => ({ ...r, scan: scans.get(r.fornecedor_produto_id) ?? null })), total: count ?? 0 };
  });

export const startSupplierCatalogImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(), fornecedor_id: z.string().uuid(), limit: z.number().int().min(1).max(20000).optional(),
    /** escanear = mesma preparação e auditoria, sem cadastrar; only_ready = importar só os prontos no scanner. */
    modo: z.enum(["importar", "escanear"]).default("importar"), only_ready: z.boolean().default(false),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAccess(context, data.company_id);
    const db = await admin();
    const { data: jobId, error } = await db.rpc("start_supplier_catalog_import", {
      _company_id: data.company_id, _fornecedor_id: data.fornecedor_id, _user_id: context.userId, _limit: data.limit ?? null,
      _modo: data.modo, _only_ready: data.modo === "importar" && data.only_ready,
    });
    if (error) throw new Error(error.message);
    return { job_id: jobId as string };
  });

export const listSupplierCatalogJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAccess(context, data.company_id);
    const db = await admin();
    const { data: rows, error } = await db.from("supplier_catalog_import_jobs")
      .select("id,fornecedor_id,prefix,modo,only_ready,status,total,processed,imported,ready,pending,failed,ignored,waiting_reason,last_error,created_at,finished_at,fornecedores(nome)")
      .eq("company_id", data.company_id).order("created_at", { ascending: false }).limit(10);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as any[]).map(r => ({ ...r, fornecedor_nome: r.fornecedores?.nome ?? "Fornecedor" })) as Array<{
      id: string; fornecedor_id: string; fornecedor_nome: string; prefix: string; modo: "importar" | "escanear"; only_ready: boolean;
      status: string; total: number; processed: number; imported: number; ready: number; pending: number; failed: number; ignored: number; waiting_reason: string | null; last_error: string | null;
      created_at: string; finished_at: string | null;
    }>;
  });

export const listSupplierCatalogItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    job_id: z.string().uuid(), status: z.enum(["pendencia", "erro", "importado", "ignorado", "pendente", "pronto"]),
    page: z.number().int().min(1).default(1), page_size: z.number().int().min(1).max(200).default(50),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const job = await jobOf(db, data.job_id);
    await assertAccess(context, job.company_id);
    const from = (data.page - 1) * data.page_size;
    const { data: rows, error, count } = await db.from("supplier_catalog_import_items")
      .select("id,codigo,sku,titulo,status,issues,sources,updated_at", { count: "exact" })
      .eq("job_id", data.job_id).eq("status", data.status).order("codigo").range(from, from + data.page_size - 1);
    if (error) throw new Error(error.message);
    return { rows: (rows ?? []) as Array<{ id: string; codigo: string; sku: string; titulo: string | null; status: string; issues: string[]; sources: Record<string, string | number | boolean | string[] | null> }>, total: count ?? 0 };
  });

export const cancelSupplierCatalogImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const job = await jobOf(db, data.job_id);
    await assertAccess(context, job.company_id);
    const { error } = await db.from("supplier_catalog_import_jobs")
      .update({ status: "cancelado", cancel_requested: true, finished_at: new Date().toISOString() })
      .eq("id", data.job_id).eq("status", "executando");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
