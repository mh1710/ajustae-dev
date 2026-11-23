import type { RuleModule } from "../types";

export const eanObrigatorioRule: RuleModule = {
  slug: "ean-obrigatorio",
  name: "EAN obrigatório",
  description: "O campo GTIN/EAN não pode estar vazio.",
  category: "conteudo",
  defaultSeverity: "warning",
  defaultConfig: {},
  evaluate: (p) => {
    const gtin = ((p as unknown as { gtin?: string | null }).gtin ?? "").toString().trim();
    return gtin.length > 0
      ? { status: "pass" }
      : { status: "warning", message: "GTIN/EAN não informado." };
  },
};