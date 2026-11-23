import type { RuleModule } from "../types";

/** Usa os vínculos lidos do Bling (Fornecedores → Fornecedores no Bling). */
export const fornecedorVinculadoRule: RuleModule = {
  slug: "fornecedor-vinculado",
  name: "Produto com fornecedor vinculado",
  description: "O produto deve ter pelo menos um fornecedor vinculado no Bling.",
  category: "cadastro",
  defaultSeverity: "error",
  prepare: async (ctx) => {
    const ids = ctx.products.map((p) => p.id);
    const linked = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await ctx.supabaseAdmin
        .from("bling_product_suppliers")
        .select("product_id")
        .eq("company_id", ctx.companyId)
        .in("product_id", ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as { product_id: string }[]) linked.add(r.product_id);
    }
    return linked;
  },
  evaluate: (p, _cfg, prepared) => {
    const linked = prepared as Set<string> | undefined;
    if (linked?.has(p.id)) return { status: "pass" };
    return { status: "error", message: "Produto sem fornecedor vinculado no Bling." };
  },
};
