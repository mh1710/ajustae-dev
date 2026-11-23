import type { RuleModule } from "../types";

export const descricaoComplementarIgualNomeRule: RuleModule = {
  slug: "descricao-complementar-igual-nome",
  name: "Descrição complementar igual ao nome",
  description: "A descrição complementar deve ser idêntica ao nome/descrição do produto.",
  category: "conteudo",
  defaultSeverity: "error",
  defaultConfig: { autofix: true },
  evaluate: (p) => {
    const nome = (p.nome ?? "").trim();
    const desc = (p.descricao_complementar ?? "").trim();
    if (!nome) return { status: "error", message: "Nome vazio." };
    if (nome === desc) return { status: "pass" };
    return {
      status: "error",
      message: "Descrição complementar difere do nome (auto-corrigível).",
      details: { autofix: true, expected: nome },
    };
  },
};