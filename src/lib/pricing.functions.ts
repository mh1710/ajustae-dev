import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadSupplierPrefixMap, supplierFromSku } from "@/lib/supplier-prefix-map";

export type PricingSettings = {
  embalagem_default: number;
  transporte_default: number;
  taxa_operacional_valor: number;
  taxa_operacional_min_custo: number;
  frete_medio_percent: number;
  custo_fixo_percent: number;
  devolucao_percent: number;
  default_marketplace_id: string | null;
  stock_cap_default: number | null;
  profit_bands: Array<{ min: number; max: number | null; margin_percent: number }>;
  price_anchors: Array<{ min: number; max: number; price: number }>;
};

const DEFAULT_BANDS: PricingSettings["profit_bands"] = [
  { min: 0, max: 9.99, margin_percent: 0 },
  { min: 10, max: 39.99, margin_percent: 0 },
  { min: 40, max: 79.99, margin_percent: 0 },
  { min: 80, max: 299.99, margin_percent: 0 },
  { min: 300, max: 799.99, margin_percent: 0 },
  { min: 800, max: null, margin_percent: 0 },
];

const DEFAULT_SETTINGS: PricingSettings = {
  embalagem_default: 0,
  transporte_default: 0,
  taxa_operacional_valor: 0,
  taxa_operacional_min_custo: 0,
  frete_medio_percent: 0,
  custo_fixo_percent: 0,
  devolucao_percent: 0,
  default_marketplace_id: null,
  stock_cap_default: null,
  profit_bands: DEFAULT_BANDS,
  price_anchors: [],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeBands(raw: any): PricingSettings["profit_bands"] {
  if (!Array.isArray(raw)) return DEFAULT_BANDS;
  const out = raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((b: any) => ({
      min: Number(b?.min ?? 0) || 0,
      max: b?.max == null ? null : Number(b.max),
      margin_percent: Number(b?.margin_percent ?? 0) || 0,
    }))
    .filter((b) => Number.isFinite(b.min));
  return out.length > 0 ? out : DEFAULT_BANDS;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureMember(supabase: any, companyId: string, userId: string) {
  const { data, error } = await supabase
    .from("company_users")
    .select("ativo")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.ativo) throw new Error("Sem acesso à empresa selecionada.");
}

const SETTINGS_COLUMNS =
  "embalagem_default, transporte_default, taxa_operacional_valor, taxa_operacional_min_custo, frete_medio_percent, custo_fixo_percent, devolucao_percent, default_marketplace_id, stock_cap_default, profit_bands, price_anchors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeAnchors(raw: any): PricingSettings["price_anchors"] {
  if (!Array.isArray(raw)) return [];
  return raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((a: any) => ({
      min: Number(a?.min ?? 0) || 0,
      max: Number(a?.max ?? 0) || 0,
      price: Number(a?.price ?? 0) || 0,
    }))
    .filter((a) => a.price > 0 && a.max >= a.min);
}

export const getPricingSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<PricingSettings> => {
    await ensureMember(context.supabase, data.company_id, context.userId);
    const { data: row, error } = await context.supabase
      .from("pricing_settings")
      .select(SETTINGS_COLUMNS)
      .eq("company_id", data.company_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return DEFAULT_SETTINGS;
    return {
      embalagem_default: Number(row.embalagem_default) || 0,
      transporte_default: Number(row.transporte_default) || 0,
      taxa_operacional_valor: Number(row.taxa_operacional_valor) || 0,
      taxa_operacional_min_custo: Number(row.taxa_operacional_min_custo) || 0,
      frete_medio_percent: Number(row.frete_medio_percent) || 0,
      custo_fixo_percent: Number(row.custo_fixo_percent) || 0,
      devolucao_percent: Number(row.devolucao_percent) || 0,
      default_marketplace_id: (row as { default_marketplace_id: string | null }).default_marketplace_id ?? null,
      stock_cap_default: (row as { stock_cap_default: number | null }).stock_cap_default ?? null,
      profit_bands: normalizeBands((row as { profit_bands: unknown }).profit_bands),
      price_anchors: normalizeAnchors((row as { price_anchors: unknown }).price_anchors),
    };
  });

const bandSchema = z.object({
  min: z.number().min(0),
  max: z.number().min(0).nullable(),
  margin_percent: z.number().min(0).max(100),
});

const anchorSchema = z.object({
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  price: z.number().positive(),
});

const settingsSchema = z.object({
  company_id: z.string().uuid(),
  embalagem_default: z.number().nonnegative(),
  transporte_default: z.number().nonnegative(),
  taxa_operacional_valor: z.number().nonnegative(),
  taxa_operacional_min_custo: z.number().nonnegative(),
  frete_medio_percent: z.number().nonnegative(),
  custo_fixo_percent: z.number().nonnegative(),
  devolucao_percent: z.number().nonnegative(),
  stock_cap_default: z.number().int().nonnegative().nullable().optional(),
  profit_bands: z.array(bandSchema).min(1).optional(),
  price_anchors: z.array(anchorSchema).optional(),
});

export const upsertPricingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => settingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    await ensureMember(context.supabase, data.company_id, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = {
      company_id: data.company_id,
      embalagem_default: data.embalagem_default,
      transporte_default: data.transporte_default,
      taxa_operacional_valor: data.taxa_operacional_valor,
      taxa_operacional_min_custo: data.taxa_operacional_min_custo,
      frete_medio_percent: data.frete_medio_percent,
      custo_fixo_percent: data.custo_fixo_percent,
      devolucao_percent: data.devolucao_percent,
    };
    if (data.profit_bands) patch.profit_bands = data.profit_bands;
    if (data.price_anchors !== undefined) patch.price_anchors = data.price_anchors;
    if (data.stock_cap_default !== undefined) patch.stock_cap_default = data.stock_cap_default;
    const { error } = await context.supabase
      .from("pricing_settings")
      .upsert(patch, { onConflict: "company_id" });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const setDefaultMarketplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      marketplace_id: z.string().uuid().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureMember(context.supabase, data.company_id, context.userId);
    const { error } = await context.supabase
      .from("pricing_settings")
      .upsert(
        { company_id: data.company_id, default_marketplace_id: data.marketplace_id },
        { onConflict: "company_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export type ProductCostInputsResult = {
  product: {
    id: string;
    codigo: string;
    nome: string;
    valor_compra: number;
  };
  supplier: {
    codigo: string;
    nome: string;
    preco_embalagem: number | null;
    preco_transporte: number | null;
    taxa_devolucao: number | null;
    taxa_promocao: number | null;
  } | null;
  override: {
    embalagem: number | null;
    transporte: number | null;
    taxa_operacional: number | null;
    stock_cap: number | null;
  } | null;
  settings: PricingSettings;
};

export const getProductCostInputs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), product_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ProductCostInputsResult> => {
    await ensureMember(context.supabase, data.company_id, context.userId);

    const { data: product, error: pErr } = await context.supabase
      .from("bling_products")
      .select("id, codigo, nome, preco_custo, preco_compra")
      .eq("id", data.product_id)
      .eq("company_id", data.company_id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!product) throw new Error("Produto não encontrado.");

    const prefixMap = await loadSupplierPrefixMap(context.supabase);
    const supCode = supplierFromSku(product.codigo ?? "", prefixMap);
    let supplier: ProductCostInputsResult["supplier"] = null;
    if (supCode) {
      const { data: s, error: sErr } = await context.supabase
        .from("fornecedores")
        .select("codigo, nome, preco_embalagem, preco_transporte, taxa_devolucao, taxa_promocao")
        .eq("codigo", supCode)
        .maybeSingle();
      if (sErr) throw new Error(sErr.message);
      if (s) {
        supplier = {
          codigo: s.codigo as string,
          nome: s.nome as string,
          preco_embalagem: s.preco_embalagem == null ? null : Number(s.preco_embalagem),
          preco_transporte: s.preco_transporte == null ? null : Number(s.preco_transporte),
          taxa_devolucao: s.taxa_devolucao == null ? null : Number(s.taxa_devolucao),
          taxa_promocao: s.taxa_promocao == null ? null : Number(s.taxa_promocao),
        };
      }
    }

    const { data: ov, error: oErr } = await context.supabase
      .from("product_cost_overrides")
      .select("embalagem, transporte, taxa_operacional, stock_cap")
      .eq("company_id", data.company_id)
      .eq("product_id", data.product_id)
      .maybeSingle();
    if (oErr) throw new Error(oErr.message);

    const { data: setRow, error: setErr } = await context.supabase
      .from("pricing_settings")
      .select(SETTINGS_COLUMNS)
      .eq("company_id", data.company_id)
      .maybeSingle();
    if (setErr) throw new Error(setErr.message);

    const settings: PricingSettings = setRow
      ? {
          embalagem_default: Number(setRow.embalagem_default) || 0,
          transporte_default: Number(setRow.transporte_default) || 0,
          taxa_operacional_valor: Number(setRow.taxa_operacional_valor) || 0,
          taxa_operacional_min_custo: Number(setRow.taxa_operacional_min_custo) || 0,
          frete_medio_percent: Number(setRow.frete_medio_percent) || 0,
          custo_fixo_percent: Number(setRow.custo_fixo_percent) || 0,
          devolucao_percent: Number(setRow.devolucao_percent) || 0,
          default_marketplace_id: (setRow as { default_marketplace_id: string | null }).default_marketplace_id ?? null,
          stock_cap_default: (setRow as { stock_cap_default: number | null }).stock_cap_default ?? null,
          profit_bands: normalizeBands((setRow as { profit_bands: unknown }).profit_bands),
          price_anchors: normalizeAnchors((setRow as { price_anchors: unknown }).price_anchors),
        }
      : DEFAULT_SETTINGS;

    const valor_compra = Number(
      (product as { preco_custo: unknown; preco_compra: unknown }).preco_custo ??
        (product as { preco_compra: unknown }).preco_compra ??
        0,
    ) || 0;

    return {
      product: {
        id: product.id as string,
        codigo: (product.codigo as string) ?? "",
        nome: (product.nome as string) ?? "",
        valor_compra,
      },
      supplier,
      override: ov
        ? {
            embalagem: ov.embalagem == null ? null : Number(ov.embalagem),
            transporte: ov.transporte == null ? null : Number(ov.transporte),
            taxa_operacional: ov.taxa_operacional == null ? null : Number(ov.taxa_operacional),
            stock_cap: (ov as { stock_cap: number | null }).stock_cap ?? null,
          }
        : null,
      settings,
    };
  });

const overrideSchema = z.object({
  company_id: z.string().uuid(),
  product_id: z.string().uuid(),
  embalagem: z.number().nonnegative().nullable(),
  transporte: z.number().nonnegative().nullable(),
  taxa_operacional: z.number().nonnegative().nullable(),
  stock_cap: z.number().int().nonnegative().nullable().optional(),
});

export const upsertProductCostOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => overrideSchema.parse(d))
  .handler(async ({ data, context }) => {
    await ensureMember(context.supabase, data.company_id, context.userId);
    const stockCap = data.stock_cap ?? null;
    const allNull =
      data.embalagem == null &&
      data.transporte == null &&
      data.taxa_operacional == null &&
      stockCap == null;
    if (allNull) {
      const { error } = await context.supabase
        .from("product_cost_overrides")
        .delete()
        .eq("company_id", data.company_id)
        .eq("product_id", data.product_id);
      if (error) throw new Error(error.message);
      return { ok: true as const, cleared: true as const };
    }
    const { error } = await context.supabase
      .from("product_cost_overrides")
      .upsert(
        {
          company_id: data.company_id,
          product_id: data.product_id,
          embalagem: data.embalagem,
          transporte: data.transporte,
          taxa_operacional: data.taxa_operacional,
          stock_cap: stockCap,
        },
        { onConflict: "company_id,product_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true as const, cleared: false as const };
  });

export const searchProductsForPricing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), q: z.string().trim().max(200).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureMember(context.supabase, data.company_id, context.userId);
    let query = context.supabase
      .from("bling_products")
      .select("id, codigo, nome, preco_custo, preco_compra")
      .eq("company_id", data.company_id)
      .order("nome", { ascending: true })
      .limit(30);
    if (data.q && data.q.length > 0) {
      const q = data.q.replace(/[%_]/g, "");
      query = query.or(`codigo.ilike.%${q}%,nome.ilike.%${q}%`);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      codigo: (r.codigo as string) ?? "",
      nome: (r.nome as string) ?? "",
      valor_compra:
        Number(
          (r as { preco_custo: unknown; preco_compra: unknown }).preco_custo ??
            (r as { preco_compra: unknown }).preco_compra ??
            0,
        ) || 0,
    }));
  });

export type PricingPolicyStatus = {
  ok: boolean;
  has_settings: boolean;
  bands_zero?: boolean;
  has_default_marketplace?: boolean;
  issues: string[];
};

/** Verifica se a política de preços está definida e utilizável. */
export const getPricingPolicyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<PricingPolicyStatus> => {
    await ensureMember(context.supabase, data.company_id, context.userId);
    const { data: r, error } = await context.supabase.rpc("pricing_policy_status", {
      _company_id: data.company_id,
    });
    if (error) throw new Error(error.message);
    const raw = (r ?? {}) as Record<string, unknown>;
    return {
      ok: Boolean(raw.ok),
      has_settings: Boolean(raw.has_settings),
      bands_zero: Boolean(raw.bands_zero),
      has_default_marketplace: Boolean(raw.has_default_marketplace),
      issues: Array.isArray(raw.issues) ? (raw.issues as string[]) : [],
    };
  });

export type LowMarginResult = {
  count: number;
  threshold: number;
  items: Array<{
    id: string;
    sku: string | null;
    nome: string | null;
    loja_id: string | null;
    loja_nome: string | null;
    marketplace_nome: string | null;
    preco: number;
    custo_completo: number;
    comissao: number;
    margem_percent: number;
  }>;
};

/** Produtos cuja margem final (após todos os custos e a comissão da loja) está abaixo do limite. */
export const getLowMarginProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        threshold: z.number().min(0).max(100).default(20),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<LowMarginResult> => {
    await ensureMember(context.supabase, data.company_id, context.userId);
    const { data: r, error } = await context.supabase.rpc("low_margin_products", {
      _company_id: data.company_id,
      _threshold: data.threshold,
      _limit: data.limit,
    });
    if (error) throw new Error(error.message);
    const raw = (r ?? {}) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (Array.isArray(raw.items) ? raw.items : []).map((x: any) => ({
      id: String(x.id),
      sku: x.sku ?? null,
      nome: x.nome ?? null,
      loja_id: x.loja_id ?? null,
      loja_nome: x.loja_nome ?? null,
      marketplace_nome: x.marketplace_nome ?? null,
      preco: Number(x.preco) || 0,
      custo_completo: Number(x.custo_completo) || 0,
      comissao: Number(x.comissao) || 0,
      margem_percent: Number(x.margem_percent) || 0,
    }));
    return { count: Number(raw.count) || 0, threshold: Number(raw.threshold) || data.threshold, items };
  });

export type PriceAuditResult = {
  total: number;
  avaliados: number;
  ok: number;
  divergentes: number;
  sem_base: number;
  no_default_marketplace: boolean;
  items: Array<{
    sku: string | null;
    nome: string | null;
    preco_atual: number | null;
    preco_esperado: number | null;
    diferenca: number | null;
  }>;
};

/** Compara o preço de venda atual com o preço que a política de precificação atual geraria. */
export const auditPricePolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_ids: z.array(z.string().uuid()).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<PriceAuditResult> => {
    await ensureMember(context.supabase, data.company_id, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: r, error } = await (context.supabase as any).rpc("audit_price_policy", {
      _company_id: data.company_id,
      _product_ids: data.product_ids ?? null,
      _limit: data.limit,
    });
    if (error) throw new Error(error.message);
    const raw = (r ?? {}) as Record<string, unknown>;
    return {
      total: Number(raw.total) || 0,
      avaliados: Number(raw.avaliados) || 0,
      ok: Number(raw.ok) || 0,
      divergentes: Number(raw.divergentes) || 0,
      sem_base: Number(raw.sem_base) || 0,
      no_default_marketplace: Boolean(raw.no_default_marketplace),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: (Array.isArray(raw.items) ? raw.items : []).map((x: any) => ({
        sku: x.sku ?? null,
        nome: x.nome ?? null,
        preco_atual: x.preco_atual == null ? null : Number(x.preco_atual),
        preco_esperado: x.preco_esperado == null ? null : Number(x.preco_esperado),
        diferenca: x.diferenca == null ? null : Number(x.diferenca),
      })),
    };
  });
