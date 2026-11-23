import type { RuleModule } from "../types";

export const margemMinimaRule: RuleModule = {
  slug: "margem-minima",
  name: "Margem mínima sobre custo",
  description:
    "Preço de venda (base e de cada loja vinculada) deve ser maior que o preço de custo em pelo menos N% (padrão 10%).",
  category: "preco",
  defaultSeverity: "error",
  defaultConfig: { min_percent: 10 },
  evaluate: (p, cfg) => {
    const minPct = Number((cfg as { min_percent?: number }).min_percent ?? 10);
    const preco = typeof p.preco === "number" ? p.preco : null;
    // preco_custo não está no AuditProduct tipado; leitura dinâmica preserva compat.
    const custo = (p as unknown as { preco_custo?: number | null }).preco_custo ?? null;
    if (preco == null || custo == null || custo <= 0) return { status: "pass" };
    const minPreco = custo * (1 + minPct / 100);
    if (preco < minPreco) {
      return {
        status: "error",
        message: `Preço R$ ${preco.toFixed(2)} é menor que o mínimo R$ ${minPreco.toFixed(2)} (custo R$ ${custo.toFixed(2)} + ${minPct}%).`,
      };
    }
    return { status: "pass" };
  },
};
