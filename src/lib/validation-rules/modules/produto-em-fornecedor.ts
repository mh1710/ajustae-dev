import type { RuleModule } from "../types";
import { loadSupplierPrefixMap, parseSkuPrefix } from "@/lib/supplier-prefix-map";

type Prepared = {
  codesBySupplier: Map<string, Set<string>>;
  supplierNames: Map<string, string>;
  suppliersWithProducts: Set<string>;
  prefixMap: Record<string, string>;
};

// Prefixos do SKU → código do fornecedor vêm do mapa central (supplier_prefix_map).
function parseSku(sku: string): { prefix: string; numeric: string } | null {
  return parseSkuPrefix(sku);
}

export const produtoEmFornecedorRule: RuleModule = {
  slug: "produto-em-fornecedor",
  name: "Produtos ativos presentes na base do fornecedor",
  description:
    "Somente produtos ativos são avaliados. O prefixo do SKU identifica o fornecedor conforme o mapa central de prefixos (O/ODS/ODR=Oderço, HX/HA/HAY=Hayamax, EV/E/EVS=Evolusom). O código numérico após o prefixo precisa existir na base do fornecedor.",
  category: "conteudo",
  defaultSeverity: "error",
  defaultConfig: {},
  prepare: async (ctx) => {
    const { data: sups, error: suppliersError } = await ctx.supabaseAdmin
      .from("fornecedores")
      .select("id, codigo, nome, product_count");
    if (suppliersError) throw new Error(suppliersError.message);
    const prefixMap = await loadSupplierPrefixMap(ctx.supabaseAdmin);


    const supIdByCodigo = new Map<string, string>();
    const supplierNames = new Map<string, string>();
    const suppliersWithProducts = new Set<string>();
    for (const s of (sups ?? []) as { id: string; codigo: string; nome: string; product_count: number | null }[]) {
      supIdByCodigo.set(s.codigo, s.id);
      supplierNames.set(s.codigo, s.nome);
      if ((s.product_count ?? 0) > 0) suppliersWithProducts.add(s.codigo);
    }
    const codesBySupplier = new Map<string, Set<string>>();
    const uniqueSupCodes = Array.from(new Set(Object.values(prefixMap)));
    for (const codigo of uniqueSupCodes) {
      const supId = supIdByCodigo.get(codigo);
      const set = new Set<string>();
      const wantedCodes = Array.from(
        new Set(
          ctx.products
            .map((product) => parseSku((product.codigo ?? "").trim()))
            .filter((parsed): parsed is { prefix: string; numeric: string } =>
              Boolean(parsed && prefixMap[parsed.prefix] === codigo && parsed.numeric),
            )
            .map((parsed) => parsed.numeric),
        ),
      );
      if (supId && wantedCodes.length > 0) {
        for (let from = 0; from < wantedCodes.length; from += 100) {
          const { data, error } = await ctx.supabaseAdmin
            .from("fornecedor_produtos")
            .select("codigo")
            .eq("fornecedor_id", supId)
            .eq("ativo", true)
            .in("codigo", wantedCodes.slice(from, from + 100));
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as { codigo: string }[];
          for (const r of rows) set.add(String(r.codigo).trim());
        }
      }
      codesBySupplier.set(codigo, set);
    }
    return { codesBySupplier, supplierNames, suppliersWithProducts, prefixMap } satisfies Prepared;
  },
  evaluate: (p, _cfg, prepared) => {
    // Produtos inativos não são avaliados por esta regra.
    const situacao = String((p as { situacao?: string | null }).situacao ?? "A").trim().toUpperCase();
    if (situacao !== "A" && situacao !== "ATIVO") return { status: "pass" };
    const sku = (p.codigo ?? "").trim();
    if (!sku) return { status: "error", message: "SKU vazio." };
    const parsed = parseSku(sku);
    if (!parsed) return { status: "warning", message: `SKU "${sku}" fora do padrão esperado.` };
    const prepEarly = prepared as Prepared | undefined;
    const supCodigo = prepEarly?.prefixMap[parsed.prefix];
    if (!supCodigo) {
      return {
        status: "warning",
        message: `Prefixo "${parsed.prefix}" não está mapeado a um fornecedor conhecido.`,
      };
    }
    const prep = prepared as Prepared | undefined;
    const set = prep?.codesBySupplier.get(supCodigo);
    const nome = prep?.supplierNames.get(supCodigo) ?? supCodigo;
    if (!prep?.suppliersWithProducts.has(supCodigo)) {
      return {
        status: "warning",
        message: `Base do fornecedor ${nome} está vazia. Atualize o fornecedor antes de auditar.`,
      };
    }
    if (!parsed.numeric) {
      return { status: "error", message: `SKU "${sku}" sem código após o prefixo ${parsed.prefix}.` };
    }
    if (!set?.has(parsed.numeric)) {
      return {
        status: "error",
        message: `Código ${parsed.numeric} não foi encontrado na base do fornecedor ${nome}.`,
        details: { prefix: parsed.prefix, supplier: supCodigo, codigo: parsed.numeric },
      };
    }
    return { status: "pass" };
  },
};