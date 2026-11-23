import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  normalizeRow,
  computeDiff,
  toProductRow,
  type SheetRow,
  type CanonicalProduct,
  DIFF_FIELDS,
} from "@/lib/sheet-mapping";

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

/** Cria um novo batch de importação. */
export const createImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        files: z.array(z.object({ name: z.string(), size: z.number() })).min(1).max(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: batch, error } = await supabaseAdmin
      .from("import_batches")
      .insert({
        company_id: data.company_id,
        user_id: context.userId,
        status: "processando",
        files: data.files,
        total_files: data.files.length,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !batch) throw new Error(error?.message ?? "Falha ao criar batch");
    return batch;
  });

/** Ingere um lote de linhas cruas (uploaded do navegador). */
export const ingestSheetRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        batch_id: z.string().uuid(),
        company_id: z.string().uuid(),
        file_name: z.string(),
        base_row_number: z.number().int().min(0),
        rows: z.array(z.record(z.string(), z.any())).max(1000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const inserts = data.rows.map((raw, i) => {
      const norm = normalizeRow(raw as SheetRow);
      return {
        batch_id: data.batch_id,
        company_id: data.company_id,
        file_name: data.file_name,
        row_number: data.base_row_number + i,
        sku: norm.codigo,
        bling_id: norm.bling_product_id,
        gtin: norm.gtin,
        raw,
        parsed: norm,
      };
    });
    const { error } = await supabaseAdmin.from("product_sheet_rows").insert(inserts as any);
    if (error) throw new Error(error.message);

    await supabaseAdmin.rpc as unknown; // no-op placeholder
    // Increment counters via a plain update (small race is acceptable during upload).
    const { data: b } = await supabaseAdmin
      .from("import_batches")
      .select("total_rows, processed_rows")
      .eq("id", data.batch_id)
      .single();
    await supabaseAdmin
      .from("import_batches")
      .update({
        total_rows: (b?.total_rows ?? 0) + inserts.length,
        processed_rows: (b?.processed_rows ?? 0) + inserts.length,
      })
      .eq("id", data.batch_id);
    return { inserted: inserts.length };
  });

/** Conta linhas já ingeridas de um arquivo em um intervalo (para retentativa segura). */
export const countIngestedRows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        batch_id: z.string().uuid(),
        file_name: z.string(),
        from_row: z.number().int().min(0),
        to_row: z.number().int().min(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { count, error } = await context.supabase
      .from("product_sheet_rows")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", data.batch_id)
      .eq("file_name", data.file_name)
      .gte("row_number", data.from_row)
      .lte("row_number", data.to_row);
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });

/** Marca arquivo como concluído (contador de arquivos). */
export const markFileDone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ batch_id: z.string().uuid(), company_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: b } = await supabaseAdmin
      .from("import_batches")
      .select("processed_files")
      .eq("id", data.batch_id)
      .single();
    await supabaseAdmin
      .from("import_batches")
      .update({ processed_files: (b?.processed_files ?? 0) + 1 })
      .eq("id", data.batch_id);
    return { ok: true };
  });

/** Classifica um lote de linhas (incremental, para evitar timeout em grandes volumes). */
export const classifyBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        batch_id: z.string().uuid(),
        company_id: z.string().uuid(),
        limit: z.number().int().min(100).max(10000).default(3000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("classify_import_batch", {
      _batch_id: data.batch_id,
      _company_id: data.company_id,
      _limit: data.limit,
    } as never);
    if (error) throw new Error(error.message);
    const r =
      (res as { ok: boolean; done: boolean; remaining: number; new: number; existing: number } | null) ?? {
        ok: true,
        done: true,
        remaining: 0,
        new: 0,
        existing: 0,
      };
    return { ok: true, done: r.done ?? true, remaining: r.remaining ?? 0, new: r.new, existing: r.existing };
  });



/** Retorna status resumido do batch (para polling). */
export const getImportBatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ batch_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: b, error } = await context.supabase
      .from("import_batches")
      .select("*")
      .eq("id", data.batch_id)
      .single();
    if (error) throw new Error(error.message);
    return b;
  });

/** Lista linhas do batch por categoria (nova/existente) para revisão. */
export const listBatchRows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        batch_id: z.string().uuid(),
        kind: z.enum(["new", "existing"]),
        page: z.number().int().min(1).default(1),
        page_size: z.number().int().min(1).max(200).default(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const q = context.supabase
      .from("product_sheet_rows")
      .select("id, sku, bling_id, gtin, parsed, match_type, match_product_id, diff, action", { count: "exact" })
      .eq("batch_id", data.batch_id);
    if (data.kind === "new") q.eq("match_type", "none");
    else q.neq("match_type", "none");
    const from = (data.page - 1) * data.page_size;
    const { data: rows, count, error } = await q
      .order("row_number", { ascending: true })
      .range(from, from + data.page_size - 1);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0, diff_fields: DIFF_FIELDS };
  });

/** Aplica ações escolhidas (import / update_changed / update_all / ignore). */
export const applyBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        batch_id: z.string().uuid(),
        company_id: z.string().uuid(),
        default_new_action: z.enum(["import", "ignore"]).default("import"),
        default_existing_action: z.enum(["update_changed", "update_all", "ignore"]).default("update_changed"),
        row_overrides: z
          .array(z.object({ id: z.string().uuid(), action: z.enum(["import", "update_changed", "update_all", "ignore"]) }))
          .default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("apply_import_batch", {
      _batch_id: data.batch_id,
      _company_id: data.company_id,
      _default_new: data.default_new_action,
      _default_existing: data.default_existing_action,
      _overrides: data.row_overrides as any,
    });
    if (error) throw new Error(error.message);
    const r = (res as { imported: number; updated: number; ignored: number; duplicates?: number } | null) ?? {
      imported: 0,
      updated: 0,
      ignored: 0,
      duplicates: 0,
    };
    return { ...r, duplicates: r.duplicates ?? 0 };

  });


/** Exclui um batch de importação (e todas as linhas de revisão associadas). */
export const deleteImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ batch_id: z.string().uuid(), company_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("product_sheet_rows").delete().eq("batch_id", data.batch_id);
    await supabaseAdmin.from("import_batches").delete().eq("id", data.batch_id);
    return { ok: true };
  });

/** Lista batches (histórico). */
export const listImportBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("import_batches")
      .select("*")
      .eq("company_id", data.company_id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });