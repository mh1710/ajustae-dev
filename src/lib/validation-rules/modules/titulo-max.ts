import type { RuleModule } from "../types";

export const tituloMaxRule: RuleModule = {
  slug: "titulo-maximo",
  name: "Título máximo",
  description: "Nome do produto deve ter no máximo N caracteres.",
  category: "conteudo",
  defaultSeverity: "error",
  defaultConfig: { max: 60 },
  evaluate: (p, cfg) => {
    const max = Number((cfg as { max?: number }).max ?? 60);
    const len = (p.nome ?? "").length;
    if (len === 0) return { status: "error", message: "Título vazio." };
    return len <= max
      ? { status: "pass" }
      : { status: "error", message: `Título com ${len} caracteres (máximo ${max}).` };
  },
};
