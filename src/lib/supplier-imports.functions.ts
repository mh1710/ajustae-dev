/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { matchingImageKeys, cdnImageUrlsForIntegration } from "@/lib/r2-images.server";
import { loadSupplierPrefixMap } from "@/lib/supplier-prefix-map";

const PREFIX_BY_SUPPLIER: Record<string, string[]> = {
  oderco: ["ODS", "O"],
  hayamax: ["HX", "HA"],
  evolusom: ["EV", "E"],
};

function normalizeSupplierCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

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

async function supplierImportPrefixContext(db: any, supplierId: string) {
  const { data: supplier, error } = await db
    .from("fornecedores")
    .select("id,codigo,nome")
    .eq("id", supplierId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!supplier) throw new Error("Fornecedor não encontrado.");

  const prefixMap = await loadSupplierPrefixMap(db);
  const supplierKey = String(supplier.codigo ?? "")
    .trim()
    .toLowerCase();
  const prefixes = Array.from(
    new Set([
      ...Object.entries(prefixMap)
        .filter(([, code]) => code.trim().toLowerCase() === supplierKey)
        .map(([prefix]) => prefix.toUpperCase()),
      ...(PREFIX_BY_SUPPLIER[supplierKey] ?? []),
    ]),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));
  return { supplier, prefixes };
}

const mappingSchema = z.record(z.string(), z.string());
const valueMappingSchema = z.object({
  id: z.string().min(1).max(100),
  field: z.string().min(1).max(100),
  from: z.string().max(500),
  to: z.string().max(500),
});
const conditionSchema = z.object({
  id: z.string().min(1).max(100),
  field: z.string().min(1).max(100),
  operator: z.enum([
    "always",
    "equals",
    "not_equals",
    "one_of",
    "not_one_of",
    "contains",
    "not_contains",
    "is_empty",
    "not_empty",
    "greater_than",
    "greater_or_equal",
    "less_than",
    "less_or_equal",
  ]),
  value: z.string().max(500),
});
const ruleSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(150),
  enabled: z.boolean(),
  conditionField: z.string().min(1).max(100),
  operator: z.enum([
    "always",
    "equals",
    "not_equals",
    "one_of",
    "not_one_of",
    "contains",
    "not_contains",
    "is_empty",
    "not_empty",
    "greater_than",
    "greater_or_equal",
    "less_than",
    "less_or_equal",
  ]),
  conditionValue: z.string().max(500),
  conditionLogic: z.enum(["and", "or"]).default("and"),
  conditions: z.array(conditionSchema).min(1).max(20).optional(),
  targetField: z.string().min(1).max(100),
  action: z.enum([
    "set",
    "clear",
    "multiply",
    "divide",
    "uppercase",
    "lowercase",
    "strip_html",
    "ignore",
  ]),
  actionValue: z.string().max(500),
});

export const listSupplierImportPrefixes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), fornecedor_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { supplier, prefixes } = await supplierImportPrefixContext(
      supabaseAdmin as any,
      data.fornecedor_id,
    );
    return {
      supplier_id: supplier.id as string,
      supplier_codigo: String(supplier.codigo ?? ""),
      prefixes,
    };
  });

export const listSupplierImportProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        fornecedor_id: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const db = context.supabase as any;
    const { data: rows, error } = await db
      .from("supplier_import_profiles")
      .select("id, name, mapping, value_mappings, rules, header_signature, is_default, updated_at")
      .eq("company_id", data.company_id)
      .eq("fornecedor_id", data.fornecedor_id)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveSupplierImportProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        company_id: z.string().uuid(),
        fornecedor_id: z.string().uuid(),
        name: z.string().trim().min(2).max(100),
        mapping: mappingSchema,
        value_mappings: z.array(valueMappingSchema).max(500).default([]),
        rules: z.array(ruleSchema).max(200).default([]),
        headers: z.array(z.string()).max(500),
        is_default: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    if (data.is_default) {
      await db
        .from("supplier_import_profiles")
        .update({ is_default: false })
        .eq("company_id", data.company_id)
        .eq("fornecedor_id", data.fornecedor_id);
    }
    const row = {
      company_id: data.company_id,
      fornecedor_id: data.fornecedor_id,
      name: data.name,
      mapping: data.mapping,
      value_mappings: data.value_mappings,
      rules: data.rules,
      header_signature: data.headers,
      is_default: data.is_default,
      created_by: context.userId,
    };
    const query = data.id
      ? db
          .from("supplier_import_profiles")
          .update(row)
          .eq("id", data.id)
          .eq("company_id", data.company_id)
          .eq("fornecedor_id", data.fornecedor_id)
      : db.from("supplier_import_profiles").insert(row);
    const { data: saved, error } = await query
      .select("id, name, mapping, value_mappings, rules, header_signature, is_default, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return saved;
  });

export const createSupplierImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        fornecedor_id: z.string().uuid(),
        sku_prefix: z.string().trim().min(1).max(20),
        profile_id: z.string().uuid().nullable().optional(),
        file: z.object({ name: z.string().min(1), size: z.number().min(0) }),
        mapping: mappingSchema,
        value_mappings: z.array(valueMappingSchema).max(500).default([]),
        rules: z.array(ruleSchema).max(200).default([]),
        headers: z.array(z.string()).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    console.info("[supplier-import] create-batch", {
      companyId: data.company_id,
      supplierId: data.fornecedor_id,
      file: data.file.name,
    });
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { prefixes } = await supplierImportPrefixContext(db, data.fornecedor_id);
    const selectedPrefix = data.sku_prefix.toUpperCase();
    if (!prefixes.includes(selectedPrefix)) {
      throw new Error("O prefixo escolhido não pertence ao fornecedor selecionado.");
    }
    if (data.profile_id) {
      const { data: profile } = await db
        .from("supplier_import_profiles")
        .select("id")
        .eq("id", data.profile_id)
        .eq("company_id", data.company_id)
        .eq("fornecedor_id", data.fornecedor_id)
        .maybeSingle();
      if (!profile) throw new Error("Perfil de mapeamento inválido.");
    }
    const { data: batch, error } = await db
      .from("supplier_import_batches")
      .insert({
        company_id: data.company_id,
        created_by: context.userId,
        status: "processando",
        file: data.file,
        fornecedor_id: data.fornecedor_id,
        sku_prefix: selectedPrefix,
        profile_id: data.profile_id ?? null,
        mapping_snapshot: data.mapping,
        value_mappings_snapshot: data.value_mappings,
        rules_snapshot: data.rules,
        header_signature: data.headers,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !batch) throw new Error(error?.message ?? "Falha ao iniciar importação.");
    return batch;
  });

const mappedRowSchema = z.object({
  row_number: z.number().int().min(1),
  raw: z.record(z.string(), z.any()),
  parsed: z.record(z.string(), z.any()),
  issues: z.array(z.string()).max(100),
  transformations: z.array(z.string().max(500)).max(200).default([]),
  cleared_fields: z.array(z.string().min(1).max(100)).max(100).default([]),
  filtered_reason: z.string().max(500).nullable().default(null),
});

function asText(v: unknown): string | null {
  if (v == null) return null;
  const value = String(v).trim();
  return value || null;
}

function supplierCodeFromSku(value: string, prefixes: string[]) {
  const trimmed = value.trim();
  const match = /^([A-Za-z]+)(.*)$/.exec(trimmed);
  if (!match) return trimmed;
  return prefixes.includes(match[1].toUpperCase()) ? match[2].trim() : trimmed;
}

function preferredPrice(prices: unknown): number | null {
  if (!prices || typeof prices !== "object") return null;
  const p = prices as Record<string, unknown>;
  for (const key of ["PR", "base", "dropshipping", "crossdocking"]) {
    const n = Number(p[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export const ingestSupplierMappedRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        batch_id: z.string().uuid(),
        company_id: z.string().uuid(),
        fornecedor_id: z.string().uuid(),
        sku_prefix: z.string().trim().min(1).max(20),
        file_name: z.string(),
        rows: z.array(mappedRowSchema).min(1).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    console.info("[supplier-import] ingest-start", {
      batchId: data.batch_id,
      companyId: data.company_id,
      supplierId: data.fornecedor_id,
      rows: data.rows.length,
    });
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: batch } = await db
      .from("supplier_import_batches")
      .select("id,sku_prefix")
      .eq("id", data.batch_id)
      .eq("company_id", data.company_id)
      .eq("fornecedor_id", data.fornecedor_id)
      .maybeSingle();
    if (!batch) throw new Error("Importação inválida.");
    const selectedPrefix = data.sku_prefix.toUpperCase();
    if (String(batch.sku_prefix ?? "").toUpperCase() !== selectedPrefix) {
      throw new Error("O prefixo informado difere do prefixo escolhido para esta importação.");
    }

    const { supplier, prefixes: availablePrefixes } = await supplierImportPrefixContext(
      db,
      data.fornecedor_id,
    );
    const prefixes = [...availablePrefixes].sort((a, b) => b.length - a.length);
    if (!prefixes.length)
      throw new Error(`Nenhum prefixo está mapeado para o fornecedor ${supplier.nome}.`);
    if (!prefixes.includes(selectedPrefix)) {
      throw new Error("O prefixo escolhido não pertence ao fornecedor selecionado.");
    }

    const normalized = data.rows.map((row) => {
      const original = asText(row.parsed.codigo);
      const supplierCode = original
        ? normalizeSupplierCode(supplierCodeFromSku(original, prefixes))
        : "";
      const fullSku = supplierCode ? `${selectedPrefix}${supplierCode}` : "";
      return { ...row, original, supplierCode, fullSku };
    });
    const fullSkus = Array.from(
      new Set(
        normalized.flatMap((r) => {
          if (!r.supplierCode) return [];
          const variants = prefixes.map((prefix) => `${prefix}${r.supplierCode}`);
          return Array.from(new Set([r.fullSku, ...variants]));
        }),
      ),
    );
    const wantedBases = Array.from(
      new Set(
        normalized.flatMap((row) =>
          row.supplierCode
            ? prefixes.map((prefix) => normalizeSupplierCode(`${prefix}${row.supplierCode}`))
            : [],
        ),
      ),
    );
    const r2Keys: string[] = [];
    for (let i = 0; i < wantedBases.length; i += 200) {
      const { data: assets, error } = await db
        .from("cdn_image_assets")
        .select("r2_key")
        .eq("active", true)
        .in("base_key", wantedBases.slice(i, i + 200));
      if (error) throw new Error(`Inventário de imagens indisponível: ${error.message}`);
      r2Keys.push(...(assets ?? []).map((asset: any) => String(asset.r2_key)));
    }
    console.info("[supplier-import] image-inventory-complete", {
      batchId: data.batch_id,
      prefixes,
      keys: r2Keys.length,
    });

    const supplierRows: any[] = [];
    for (let i = 0; ; i += 1000) {
      const { data: found, error } = await db
        .from("fornecedor_produtos")
        .select(
          "id, codigo, titulo, marca, categoria, qt_estoque, codigobarras, precos, foto, ncm, peso, altura, largura, comprimento, tempo_garantia",
        )
        .eq("fornecedor_id", data.fornecedor_id)
        .eq("ativo", true)
        .range(i, i + 999);
      if (error) throw new Error(error.message);
      supplierRows.push(...(found ?? []));
      if ((found ?? []).length < 1000) break;
    }
    const supplierByCode = new Map<string, any>();
    for (const row of supplierRows) {
      const normalized = normalizeSupplierCode(row.codigo);
      if (normalized && !supplierByCode.has(normalized)) supplierByCode.set(normalized, row);
    }

    const existingRows: any[] = [];
    for (let i = 0; i < fullSkus.length; i += 200) {
      const { data: found, error } = await db
        .from("bling_products")
        .select("id, codigo, situacao")
        .eq("company_id", data.company_id)
        .in("codigo", fullSkus.slice(i, i + 200));
      if (error) throw new Error(error.message);
      existingRows.push(...(found ?? []));
    }
    const existingBySupplierCode = new Map<string, any>();
    for (const row of existingRows) {
      const code = normalizeSupplierCode(supplierCodeFromSku(String(row.codigo ?? ""), prefixes));
      if (code) existingBySupplierCode.set(code, row);
    }

    const stagedSkus = normalized.map((row) => row.fullSku).filter(Boolean);
    const { data: stagedRows } = stagedSkus.length
      ? await db
          .from("supplier_import_rows")
          .select("sku")
          .eq("batch_id", data.batch_id)
          .in("sku", stagedSkus)
      : { data: [] };
    const seenSkus = new Set<string>((stagedRows ?? []).map((row: { sku: string }) => row.sku));

    const inserts = normalized.map((row) => {
      const issues = [...row.issues];
      const source = supplierByCode.get(row.supplierCode);
      const existing = existingBySupplierCode.get(row.supplierCode);
      const imageKeys = Array.from(
        new Set(prefixes.flatMap((prefix) => matchingImageKeys(r2Keys, prefix, row.supplierCode))),
      );
      // Importação sem filtros: regras antigas do perfil não eliminam linhas.
      const isFiltered = false;
      if (!isFiltered && !row.supplierCode) issues.push("Código ausente.");
      else if (!isFiltered && !source)
        issues.push(`Código ${row.supplierCode} não encontrado neste fornecedor.`);
      if (!isFiltered && existing)
        issues.push(`Produto já cadastrado na empresa como ${existing.codigo}.`);
      if (!isFiltered && row.fullSku && seenSkus.has(row.fullSku))
        issues.push(`Código ${row.fullSku} repetido na planilha.`);
      if (row.fullSku) seenSkus.add(row.fullSku);

      const parsed: Record<string, unknown> = { ...row.parsed };
      const clearedFields = new Set(row.cleared_fields);
      const useFallback = (field: string, value: unknown) => {
        if (!clearedFields.has(field) && (parsed[field] == null || parsed[field] === ""))
          parsed[field] = value;
      };
      parsed.codigo = row.fullSku || null;
      parsed.r2_image_keys = imageKeys;
      parsed.r2_image_status = imageKeys.length ? "encontradas" : "não encontrada";
      if (source) {
        useFallback("nome", asText(source.titulo));
        useFallback("marca", asText(source.marca));
        useFallback("categoria_produto", asText(source.categoria));
        useFallback("gtin", asText(source.codigobarras));
        useFallback("ncm", asText(source.ncm));
        useFallback("estoque", source.qt_estoque ?? null);
        useFallback("preco_custo", preferredPrice(source.precos));
        useFallback("peso_liquido", source.peso ?? null);
        useFallback("peso_bruto", source.peso ?? null);
        useFallback("altura", source.altura ?? null);
        useFallback("largura", source.largura ?? null);
        useFallback("profundidade", source.comprimento ?? null);
        useFallback("meses_garantia_fornecedor", asText(source.tempo_garantia));
        useFallback("url_imagens_externas", asText(source.foto));
        useFallback("descricao_fornecedor", asText(source.titulo));
        useFallback("cod_fornecedor", row.supplierCode);
        useFallback("fornecedor", String(supplier.nome));
      }
      useFallback("situacao", "A");
      useFallback("unidade", "UN");
      if (!isFiltered && !asText(parsed.nome))
        issues.push("Nome ausente na planilha e no cadastro do fornecedor.");

      const valid = !isFiltered && issues.length === 0;
      return {
        batch_id: data.batch_id,
        company_id: data.company_id,
        file_name: data.file_name,
        row_number: row.row_number,
        sku: asText(parsed.codigo),
        bling_id: null,
        gtin: asText(parsed.gtin),
        raw: row.raw,
        parsed,
        transformation_log: [...row.transformations, `Prefixo do fornecedor: ${selectedPrefix}`],
        match_type: valid
          ? existing
            ? "existing_image_update"
            : "missing_supplier_product"
          : existing
            ? "sku"
            : "invalid",
        match_product_id: existing?.id ?? null,
        action: valid ? (existing ? "update_images" : "import") : "ignore",
        error: isFiltered
          ? `Ignorado pelo filtro: ${row.filtered_reason}`
          : issues.length
            ? issues.join(" ")
            : null,
      };
    });
    const { error: insertError } = await db.from("supplier_import_rows").insert(inserts);
    if (insertError) throw new Error(insertError.message);
    const valid = inserts.filter(
      (row) => row.action === "import" || row.action === "update_images",
    ).length;
    const existing = inserts.filter((row) => row.match_type === "sku").length;
    const filtered = inserts.filter((row) => row.match_type === "filtered").length;
    const invalid = inserts.length - valid - existing - filtered;
    console.info("[supplier-import] ingest-complete", {
      batchId: data.batch_id,
      inserted: inserts.length,
      valid,
      existing,
      invalid,
    });
    const { data: current } = await db
      .from("supplier_import_batches")
      .select("total_rows, processed_rows, new_count, existing_count, filtered_count, error_count")
      .eq("id", data.batch_id)
      .single();
    await db
      .from("supplier_import_batches")
      .update({
        total_rows: (current?.total_rows ?? 0) + inserts.length,
        processed_rows: (current?.processed_rows ?? 0) + inserts.length,
        new_count: (current?.new_count ?? 0) + valid,
        existing_count: (current?.existing_count ?? 0) + existing,
        filtered_count: (current?.filtered_count ?? 0) + filtered,
        error_count: (current?.error_count ?? 0) + invalid,
      })
      .eq("id", data.batch_id);
    return { inserted: inserts.length, valid, existing, filtered, invalid };
  });

export const finishSupplierImportAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        batch_id: z.string().uuid(),
        company_id: z.string().uuid(),
        mode: z.enum(["all", "existing_images"]).default("all"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    console.info("[supplier-import] finish-analysis", {
      batchId: data.batch_id,
      companyId: data.company_id,
    });
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: batch, error } = await db
      .from("supplier_import_batches")
      .update({
        status: "aguardando_revisao",
        finished_at: new Date().toISOString(),
      })
      .eq("id", data.batch_id)
      .eq("company_id", data.company_id)
      .select("id, status, total_rows, new_count, existing_count, filtered_count, error_count")
      .single();
    if (error) throw new Error(error.message);
    return batch;
  });

export const listSupplierImportRows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        batch_id: z.string().uuid(),
        company_id: z.string().uuid(),
        page: z.number().int().min(1).default(1),
        page_size: z.number().int().min(1).max(100).default(30),
        only_import: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    console.info("[supplier-import] apply-start", {
      batchId: data.batch_id,
      companyId: data.company_id,
    });
    await assertMember(context, data.company_id);
    const from = (data.page - 1) * data.page_size;
    let query = context.supabase
      .from("supplier_import_rows")
      .select("id, row_number, sku, parsed, action, match_type, error, transformation_log", {
        count: "exact",
      })
      .eq("batch_id", data.batch_id)
      .eq("company_id", data.company_id);
    if (data.only_import) query = query.in("action", ["import", "update_images"]);
    const {
      data: rows,
      count,
      error,
    } = await query.order("row_number").range(from, from + data.page_size - 1);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0 };
  });

export const applySupplierImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        batch_id: z.string().uuid(),
        company_id: z.string().uuid(),
        mode: z.enum(["all", "existing_images"]).default("all"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: batch } = await db
      .from("supplier_import_batches")
      .select("id")
      .eq("id", data.batch_id)
      .eq("company_id", data.company_id)
      .maybeSingle();
    if (!batch) throw new Error("Importação inválida.");
    const productsToInsert: Record<string, unknown>[] = [];
    const productsToUpdate: Array<{ id: string; values: Record<string, unknown> }> = [];
    const { data: integration } = await db
      .from("bling_integrations")
      .select("id, cdn_signature, cdn_signature_active, cdn_key_version_id")
      .eq("company_id", data.company_id)
      .limit(1)
      .maybeSingle();
    const keyVersion = integration?.cdn_key_version_id
      ? (
          await db
            .from("cdn_key_versions")
            .select("public_id,format,status")
            .eq("id", integration.cdn_key_version_id)
            .maybeSingle()
        ).data
      : null;
    for (let from = 0; ; from += 1000) {
      const { data: rows } = await db
        .from("supplier_import_rows")
        .select("parsed, action, match_product_id")
        .eq("batch_id", data.batch_id)
        .in(
          "action",
          data.mode === "existing_images" ? ["update_images"] : ["import", "update_images"],
        )
        .range(from, from + 999);
      for (const row of rows ?? []) {
        const parsed = (row.parsed ?? {}) as Record<string, unknown>;
        const keys = Array.isArray(parsed.r2_image_keys)
          ? (parsed.r2_image_keys.filter(Boolean) as string[])
          : [];
        const values = { ...parsed };
        delete values.r2_image_keys;
        delete values.r2_image_status;
        if (keys.length) {
          if (!integration)
            throw new Error("Integração Bling não encontrada para assinar as imagens.");
          const urls = await cdnImageUrlsForIntegration(keys, {
            ...integration,
            key_version: keyVersion,
          });
          values.url_imagens_externas = urls.join("|");
          values.imagem_principal_url = urls[0];
        }
        if (values.codigo && row.action === "update_images" && row.match_product_id)
          productsToUpdate.push({ id: row.match_product_id, values });
        else if (values.codigo) productsToInsert.push({ ...values, company_id: data.company_id });
      }
      if ((rows ?? []).length < 1000) break;
    }
    const productIds: string[] = [];
    for (let index = 0; index < productsToInsert.length; index += 200) {
      const { data: inserted, error } = await db
        .from("bling_products")
        .upsert(productsToInsert.slice(index, index + 200) as any, {
          onConflict: "company_id,codigo",
          ignoreDuplicates: true,
        })
        .select("id");
      if (error) throw new Error(error.message);
      productIds.push(...(inserted ?? []).map((product: { id: string }) => product.id));
    }
    for (const product of productsToUpdate) {
      const { error } = await db
        .from("bling_products")
        .update(product.values)
        .eq("id", product.id)
        .eq("company_id", data.company_id);
      if (error) throw new Error(error.message);
    }
    const updatedIds = productsToUpdate.map((product) => product.id);
    await db
      .from("supplier_import_batches")
      .update({ status: "aplicado", finished_at: new Date().toISOString() })
      .eq("id", data.batch_id);
    return {
      imported: productIds.length,
      updated: productsToUpdate.length,
      ignored: 0,
      product_ids: productIds,
      updated_product_ids: updatedIds,
    };
  });
