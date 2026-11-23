import type { RuleModule } from "../types";

export const dimensoesPesoRule: RuleModule = {
  slug: "dimensoes-peso-obrigatorios",
  name: "Peso e dimensões obrigatórios",
  description: "Peso, largura, altura e profundidade devem estar preenchidos e maiores que zero.",
  category: "dimensoes",
  defaultSeverity: "error",
  defaultConfig: {},
  evaluate: (p) => {
    const missing: string[] = [];
    if (!p.peso_liquido || p.peso_liquido <= 0) missing.push("peso");
    if (!p.largura || p.largura <= 0) missing.push("largura");
    if (!p.altura || p.altura <= 0) missing.push("altura");
    if (!p.profundidade || p.profundidade <= 0) missing.push("profundidade");
    return missing.length === 0
      ? { status: "pass" }
      : { status: "error", message: `Campos ausentes ou zerados: ${missing.join(", ")}.` };
  },
};
