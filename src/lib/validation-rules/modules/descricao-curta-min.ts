import type { RuleModule } from "../types";
import { descriptionVisibleLength } from "../../description-text";

export const descricaoCurtaMinRule: RuleModule = {
  slug: "descricao-curta-minima",
  name: "Descrição curta mínima",
  description: "A descrição curta deve ter no mínimo N caracteres.",
  category: "conteudo",
  defaultSeverity: "error",
  defaultConfig: { min: 150 },
  evaluate: (p, cfg) => {
    const min = Number((cfg as { min?: number }).min ?? 150);
    const len = descriptionVisibleLength(p.descricao_curta);
    return len >= min
      ? { status: "pass" }
      : { status: "error", message: `Descrição curta com ${len} caracteres (mínimo ${min}).` };
  },
};
