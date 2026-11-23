import type { RuleModule } from "../types";

export const garantiaDuplicadaRule: RuleModule = {
  slug: "garantia-duplicada-desc-curta",
  name: 'Descrição curta não pode ter "Garantia" duplicado',
  description:
    'A descrição curta não pode conter a palavra "Garantia" mais de uma vez (case-insensitive: Garantia, GARANTIA, garantia).',
  category: "conteudo",
  defaultSeverity: "error",
  defaultConfig: {},
  evaluate: (p) => {
    const desc = (p.descricao_curta ?? "").toString();
    const matches = desc.match(/garantia/gi);
    const count = matches ? matches.length : 0;
    if (count <= 1) return { status: "pass" };
    return {
      status: "error",
      message: `Descrição curta contém a palavra "Garantia" ${count} vezes (máximo 1).`,
    };
  },
};
