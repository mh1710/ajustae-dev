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

/** IDs dos produtos que mudaram e ainda não foram sincronizados com o Bling. */
export const listChangedProductIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const ids: string[] = [];
    const pageSize = 1000;
    for (let from = 0; from < 100000; from += pageSize) {
      const { data: rows, error } = await context.supabase
        .from("bling_products")
        .select("id, preco, estoque, ultimo_preco_sincronizado, ultimo_estoque_sincronizado, dirty")
        .eq("company_id", data.company_id)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = (rows ?? []) as Array<Record<string, any>>;
      for (const r of batch) {
        const precoDif = Number(r.preco ?? 0) !== Number(r.ultimo_preco_sincronizado ?? NaN);
        const estoqueDif = Number(r.estoque ?? 0) !== Number(r.ultimo_estoque_sincronizado ?? NaN);
        if (r.dirty === true || precoDif || estoqueDif) ids.push(String(r.id));
      }
      if (batch.length < pageSize) break;
    }
    return { ids, total: ids.length };
  });

/** Retorna 1 produto pela id (com todos os campos). */
export const getProduct = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("bling_products")
      .select("*")
      .eq("id", data.product_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

/** Retorna 1 produto por (company_id, codigo). */
export const getProductBySku = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), sku: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("bling_products")
      .select("*")
      .eq("company_id", data.company_id)
      .eq("codigo", data.sku)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

const EDITABLE_FIELDS = [
  // Identificação / descrições
  "nome","codigo","descricao_complementar","descricao_curta","observacoes","situacao",
  "descricao_fornecedor","informacoes_adicionais",
  // Categorização / marca / fornecedor / localização
  "marca","categoria_produto","fornecedor","cod_fornecedor","localizacao","grupo_produtos",
  "grupo_tags","tipo_item","tipo_producao","produto_variacao","codigo_pai","codigo_integracao",
  "departamento",
  // Unidades / códigos fiscais
  "unidade","unidade_medida","ncm","origem_fiscal","gtin","gtin_embalagem","cest",
  "classe_ipi","codigo_lista_servicos","tributos","numero_fci",
  // Flags / atributos comerciais
  "condicao_produto","frete_gratis","cross_docking","clonar_dados_pai",
  "meses_garantia_fornecedor","data_validade",
  // Imagens & links
  "url_imagens_externas","link_externo","video",
  // Preços & estoque
  "preco","preco_custo","preco_compra","valor_ipi_fixo",
  "icms_st_base","icms_st_retencao","icms_proprio_substituto",
  "estoque","estoque_minimo","estoque_maximo",
  // Dimensões / logística
  "peso_liquido","peso_bruto","largura","altura","profundidade","volumes","itens_caixa",
] as const;

/** Atualiza os campos editáveis. */
export const updateProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        product_id: z.string().uuid(),
        company_id: z.string().uuid(),
        patch: z.record(z.string(), z.any()),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const clean: Record<string, unknown> = {};
    for (const k of EDITABLE_FIELDS) if (k in data.patch) clean[k] = data.patch[k];
    clean.dirty = true;
    clean.updated_at = new Date().toISOString();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("bling_products")
      .update(clean as any)
      .eq("id", data.product_id)
      .eq("company_id", data.company_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Deleta um ou mais produtos. */
export const deleteProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_ids: z.array(z.string().uuid()).min(1).max(10000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let deleted = 0;
    for (let i = 0; i < data.product_ids.length; i += 500) {
      const chunk = data.product_ids.slice(i, i + 500);
      // Loop até esvaziar o lote (a função apaga em blocos para não estourar timeout)
      for (let guard = 0; guard < 20; guard++) {
        const { data: n, error } = await supabaseAdmin.rpc("delete_products_batch", {
          _company_id: data.company_id,
          _limit: 300,
          _product_ids: chunk,
        });
        if (error) throw new Error(error.message);
        const count = Number(n ?? 0);
        deleted += count;
        if (count === 0) break;
      }
    }
    return { deleted };
  });

/** Deleta TODOS os produtos da empresa (em lotes, para evitar timeout). */
export const deleteAllProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let deleted = 0;
    // Cada chamada apaga até 500 produtos; repete até acabar (ou até o teto de segurança).
    for (let i = 0; i < 2000; i++) {
      const { data: n, error } = await supabaseAdmin.rpc("delete_products_batch", {
        _company_id: data.company_id,
        _limit: 500,
      });

      if (error) throw new Error(error.message);
      const count = Number(n ?? 0);
      deleted += count;
      if (count === 0) break;
    }
    return { deleted };
  });


/**
 * Remove produtos duplicados por SKU (Código) dentro de uma empresa.
 * `keep`: 'newest' mantém o mais recente (por created_at DESC), 'oldest' o mais antigo.
 */
export const dedupeProductsBySku = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        keep: z.enum(["newest", "oldest"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Busca id + codigo + created_at em páginas.
    const PAGE = 1000;
    const rows: { id: string; codigo: string | null; created_at: string }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data: r, error } = await supabaseAdmin
        .from("bling_products")
        .select("id, codigo, created_at")
        .eq("company_id", data.company_id)
        .not("codigo", "is", null)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!r || r.length === 0) break;
      rows.push(...(r as typeof rows));
      if (r.length < PAGE) break;
    }

    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = (r.codigo ?? "").trim();
      if (!key) continue;
      const arr = groups.get(key) ?? [];
      arr.push(r);
      groups.set(key, arr);
    }

    const toDelete: string[] = [];
    let groupsWithDupes = 0;
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      groupsWithDupes++;
      arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
      const keeper = data.keep === "newest" ? arr[arr.length - 1] : arr[0];
      for (const r of arr) if (r.id !== keeper.id) toDelete.push(r.id);
    }

    // deleta em lotes
    for (let i = 0; i < toDelete.length; i += 200) {
      const chunk = toDelete.slice(i, i + 200);
      const { error } = await supabaseAdmin.from("bling_products").delete().in("id", chunk);
      if (error) throw new Error(error.message);
    }

    return { groups_with_duplicates: groupsWithDupes, deleted: toDelete.length };
  });

/**
 * Copia (duplica) todos os produtos de uma empresa de origem para uma empresa de destino.
 * Faz upsert por (company_id, codigo) — produtos já existentes na empresa destino NÃO são sobrescritos.
 */
export const duplicateCompanyProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        source_company_id: z.string().uuid(),
        target_company_id: z.string().uuid(),
        overwrite: z.boolean().default(false),
        offset: z.number().int().min(0).default(0),
        page_size: z.number().int().min(1).max(200).default(50),
      })
      .refine((v) => v.source_company_id !== v.target_company_id, {
        message: "Empresas de origem e destino devem ser diferentes.",
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.source_company_id);
    await assertMember(context, data.target_company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Colunas que NÃO devem ser copiadas (identidade / vínculos da empresa origem).
    const STRIP = new Set([
      "id",
      "company_id",
      "integration_id",
      "last_seen_sync_job_id",
      "created_at",
      "updated_at",
      "detail_synced",
      "detail_synced_at",
      "detail_sync_error",
      "bling_created_at",
      "bling_updated_at",
    ]);

    // Contagem total (para progresso) — pedimos apenas na 1ª chamada.
    let total: number | null = null;
    if (data.offset === 0) {
      const { count, error: cErr } = await supabaseAdmin
        .from("bling_products")
        .select("id", { count: "exact", head: true })
        .eq("company_id", data.source_company_id);
      if (cErr) throw new Error(cErr.message);
      total = count ?? 0;
    }

    const from = data.offset;
    const to = from + data.page_size - 1;
    const { data: src, error } = await supabaseAdmin
      .from("bling_products")
      .select("*")
      .eq("company_id", data.source_company_id)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);

    const batch = src ?? [];
    const rows = batch
      .filter((r: any) => r.codigo && String(r.codigo).trim() !== "")
      .map((r: any) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) if (!STRIP.has(k)) out[k] = v;
        out.company_id = data.target_company_id;
        out.source = "clone";
        out.detail_synced = false;
        out.dirty = true;
        out.last_imported_at = new Date().toISOString();
        return out;
      });
    const skipped = batch.length - rows.length;
    let copied = 0;

    if (rows.length > 0) {
      const { error: upErr, count } = await supabaseAdmin
        .from("bling_products")
        .upsert(rows as any, {
          onConflict: "company_id,codigo",
          ignoreDuplicates: !data.overwrite,
          count: "exact",
        });
      if (upErr) throw new Error(upErr.message);
      copied = count ?? rows.length;
    }

    const done = batch.length < data.page_size;
    const next_offset = done ? null : from + batch.length;
    return { copied, skipped, next_offset, total, processed: from + batch.length };
  });

/** Remove tags HTML de campos de texto (transforma HTML em texto puro). */
export const transformStripHtml = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid(), product_ids: z.array(z.string().uuid()).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("transform_strip_html", { _company_id: data.company_id, _product_ids: data.product_ids ?? null });
    if (error) throw new Error(error.message);
    const updated = res && typeof res === "object" && "updated" in (res as any) ? Number((res as any).updated ?? 0) : Number(res ?? 0);
    return { updated: Number.isFinite(updated) ? updated : 0 };
  });

/** Preenche descricao_complementar = nome onde diferem. */
export const transformFillDescComplementar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid(), product_ids: z.array(z.string().uuid()).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("transform_fill_desc_complementar", { _company_id: data.company_id, _product_ids: data.product_ids ?? null });
    if (error) throw new Error(error.message);
    const updated = res && typeof res === "object" && "updated" in (res as any) ? Number((res as any).updated ?? 0) : Number(res ?? 0);
    return { updated: Number.isFinite(updated) ? updated : 0 };
  });

/** Preenche Garantia (3 meses) e Código Anatel na descrição curta de todos os produtos. */
export const transformFillGarantiaAnatel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid(), product_ids: z.array(z.string().uuid()).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("transform_fill_garantia_anatel", { _company_id: data.company_id, _product_ids: data.product_ids ?? undefined });
    if (error) throw new Error(error.message);
    const updated = res && typeof res === "object" && "updated" in (res as any) ? Number((res as any).updated ?? 0) : Number(res ?? 0);
    return { updated: Number.isFinite(updated) ? updated : 0 };
  });

/** Atualiza SOMENTE o "Código Anatel" dentro da descrição curta, preservando o restante do texto. */
export const transformUpdateAnatelCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid(), product_ids: z.array(z.string().uuid()).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await (context.supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>).call(
      context.supabase,
      "transform_update_anatel_code",
      { _company_id: data.company_id, _product_ids: data.product_ids ?? null },
    );
    if (error) throw new Error(error.message);
    const updated = res && typeof res === "object" && "updated" in (res as any) ? Number((res as any).updated ?? 0) : Number(res ?? 0);
    return { updated: Number.isFinite(updated) ? updated : 0 };
  });


/** Remove todas as ocorrências do bloco "Garantia: 3 meses | Código Anatel: ..." da descrição curta. */
export const transformRemoveGarantiaAnatel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid(), product_ids: z.array(z.string().uuid()).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("transform_remove_garantia_anatel", { _company_id: data.company_id, _product_ids: data.product_ids ?? null });
    if (error) throw new Error(error.message);
    const updated = res && typeof res === "object" && "updated" in (res as any) ? Number((res as any).updated ?? 0) : Number(res ?? 0);
    return { updated: Number.isFinite(updated) ? updated : 0 };
  });

/** Reduz o número de imagens de cada produto para no máximo N (padrão 18), removendo apenas o excedente. */
export const transformTrimImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    product_ids: z.array(z.string().uuid()).optional(),
    max: z.number().int().min(1).max(50).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("transform_trim_images" as any, {
      _company_id: data.company_id,
      _product_ids: data.product_ids ?? null,
      _max: data.max ?? 18,
    });
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as { updated?: number; removed?: number; max?: number };
    return { updated: Number(r.updated ?? 0), removed: Number(r.removed ?? 0), max: Number(r.max ?? 18) };
  });

/** Remove apenas as URLs de imagem que não terminam em .png/.jpg/.jpeg. */
export const transformRemoveInvalidImageUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    product_ids: z.array(z.string().uuid()).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("transform_remove_invalid_image_urls" as any, {
      _company_id: data.company_id,
      _product_ids: (data.product_ids ?? null) as any,
    });
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as { updated?: number; removed?: number };
    return { updated: Number(r.updated ?? 0), removed: Number(r.removed ?? 0) };
  });

/** Zera o estoque dos produtos (para sincronizar estoque 0 no Bling). */
export const transformZeroStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    product_ids: z.array(z.string().uuid()).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("transform_zero_stock" as any, {
      _company_id: data.company_id,
      _product_ids: (data.product_ids ?? null) as any,
    });
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as { updated?: number };
    return { updated: Number(r.updated ?? 0) };
  });

/** Define o estoque dos produtos para um valor fixo informado pelo usuário. */
export const transformSetStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    product_ids: z.array(z.string().uuid()).max(500).optional(),
    value: z.number().int().min(0).max(1_000_000),
    limit: z.number().int().min(1).max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("transform_set_stock" as any, {
      _company_id: data.company_id,
      _product_ids: (data.product_ids ?? null) as any,
      _value: data.value,
      _limit: data.limit ?? 250,
    });
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as { updated?: number; value?: number; has_more?: boolean };
    return {
      updated: Number(r.updated ?? 0),
      value: Number(r.value ?? data.value),
      has_more: Boolean(r.has_more),
    };
  });

/** Preenche o GTIN/EAN a partir da base do fornecedor (usa prefixo do SKU). */
export const transformFillEanFromSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid(), product_ids: z.array(z.string().uuid()).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("transform_fill_ean_from_supplier" as any, { _company_id: data.company_id, _product_ids: data.product_ids ?? null });
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as { updated?: number; candidates?: number; not_found?: number };
    return { updated: Number(r.updated ?? 0), candidates: Number(r.candidates ?? 0), not_found: Number(r.not_found ?? 0) };
  });

/** Atualiza preço de custo, preço de compra, preço de venda (via Política de Precificação) e estoque, opcionalmente propagando para multilojas. */
export const transformUpdatePriceStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    product_ids: z.array(z.string().uuid()).optional(),
    include_stores: z.boolean().optional(),
    run_id: z.string().uuid().optional(),
    only_price: z.boolean().optional(),
    only_stock: z.boolean().optional(),
    consider_ml_stock: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await context.supabase.rpc("transform_update_price_stock" as any, {
      _company_id: data.company_id,
      _product_ids: (data.product_ids ?? null) as any,
      _include_stores: !!data.include_stores,
      _run_id: (data.run_id ?? null) as any,
      _only_stock: !!data.only_stock,
      _only_price: !!data.only_price,
      _consider_ml_stock: data.consider_ml_stock,
    });
    if (error) throw new Error(error.message);
    return (res ?? {}) as {
      total: number; encontrados: number; nao_encontrados: number; sem_fornecedor: number;
      preco_atualizado: number; estoque_atualizado: number; preco_e_estoque_atualizados: number;
      inalterados: number; stores_updated: number; no_default_marketplace: boolean;
      estoque_via_ml?: number;
      items: Array<{
        sku: string; nome: string; fornecedor: string | null; status: string;
        preco_atual: number | null; preco_novo: number | null;
        estoque_atual: number | null; estoque_novo: number | null;
        estoque_origem?: "fornecedor" | "mercado_livre";
        preco_atual_venda: number | null; preco_novo_venda: number | null;
      }>;
    };
  });

/** @deprecated Compatibilidade — use transformUpdatePriceStock. */
export const transformSyncSupplierStockPrice = transformUpdatePriceStock;


/** Corrige todos os erros auto-corrigíveis (atualmente = preencher descrição complementar). */
export const autoFixAllErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      product_ids: z.array(z.string().uuid()).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: fixed, error } = await context.supabase.rpc("transform_fill_desc_complementar", {
      _company_id: data.company_id,
      _product_ids: data.product_ids ?? null,
    });
    if (error) throw new Error(error.message);
    return { fixed: Number(fixed ?? 0) };
  });
/** Preenche a marca vazia com a marca do mesmo SKU na base do fornecedor (prefixo central). */
export const transformFillBrandFromSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid(), product_ids: z.array(z.string().uuid()).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await (context.supabase as any).rpc("transform_fill_brand_from_supplier", {
      _company_id: data.company_id,
      _product_ids: data.product_ids ?? null,
    });
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as { updated?: number; not_found?: number; supplier_incomplete?: number };
    return { updated: Number(r.updated ?? 0), not_found: Number(r.not_found ?? 0), supplier_incomplete: Number(r.supplier_incomplete ?? 0) };
  });

/** Preenche peso e dimensões a partir da base do fornecedor (usa prefixo do SKU). */
export const transformFillDimensionsFromSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid(), product_ids: z.array(z.string().uuid()).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await (context.supabase as any).rpc("transform_fill_dimensions_from_supplier", {
      _company_id: data.company_id,
      _product_ids: data.product_ids ?? null,
    });
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as { updated?: number; candidates?: number; not_found?: number; supplier_incomplete?: number; resolved?: number };
    return {
      updated: Number(r.updated ?? 0), candidates: Number(r.candidates ?? 0),
      not_found: Number(r.not_found ?? 0), supplier_incomplete: Number(r.supplier_incomplete ?? 0),
      resolved: Number(r.resolved ?? 0),
    };
  });

/** Define o crossdocking mínimo (padrão 3 dias) nos produtos abaixo do mínimo. */
export const transformSetCrossdocking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    product_ids: z.array(z.string().uuid()).optional(),
    dias: z.number().int().min(1).max(60).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: res, error } = await (context.supabase as any).rpc("transform_set_crossdocking", {
      _company_id: data.company_id,
      _product_ids: data.product_ids ?? null,
      _dias: data.dias ?? 3,
    });
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as { updated?: number };
    return { updated: Number(r.updated ?? 0) };
  });

/** Define a unidade de medida das dimensões como "Centímetros". */
export const transformSetUnidadeCentimetros = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    product_ids: z.array(z.string().uuid()).min(1).max(50000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    // bling_products não tem política de UPDATE para usuários: usa o admin após validar o membro.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let updated = 0;
    for (let i = 0; i < data.product_ids.length; i += 200) {
      const slice = data.product_ids.slice(i, i + 200);
      const { data: rows, error } = await (supabaseAdmin as any)
        .from("bling_products")
        .update({ unidade_medida: "Centímetros", dirty: true })
        .eq("company_id", data.company_id)
        .in("id", slice)
        .select("id");
      if (error) throw new Error(error.message);
      updated += (rows ?? []).length;
    }
    return { updated };
  });

/** Define campos fixos de cadastro: condição = NOVO ou produção = Terceiros. */
export const transformSetFixedField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    field: z.enum(["condicao", "producao"]),
    product_ids: z.array(z.string().uuid()).min(1).max(50000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch = data.field === "condicao" ? { condicao_produto: "NOVO" } : { tipo_producao: "Terceiros" };
    let updated = 0;
    for (let i = 0; i < data.product_ids.length; i += 200) {
      const { data: rows, error } = await (supabaseAdmin as any)
        .from("bling_products")
        .update({ ...patch, dirty: true })
        .eq("company_id", data.company_id)
        .in("id", data.product_ids.slice(i, i + 200))
        .select("id");
      if (error) throw new Error(error.message);
      updated += (rows ?? []).length;
    }
    return { updated };
  });

/** Resolve IDs de produtos a partir de uma lista de SKUs (codigo) da empresa. */
export const resolveProductIdsBySkus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        skus: z.array(z.string().min(1)).min(1).max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: rows, error } = await context.supabase
      .from("bling_products")
      .select("id, codigo")
      .eq("company_id", data.company_id)
      .in("codigo", data.skus);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<{ id: string; codigo: string | null }>;
    const found = new Set(list.map((r) => (r.codigo ?? "").toUpperCase()));
    const missing = data.skus.filter((s) => !found.has(s.toUpperCase()));
    return { ids: list.map((r) => r.id), missing };
  });
