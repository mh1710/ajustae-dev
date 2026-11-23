import type { RuleModule } from "../types";

export const condicaoNovoRule: RuleModule = {
  slug: "condicao-novo",
  name: "Condição sempre Novo",
  description: "A condição do produto deve ser sempre Novo.",
  category: "cadastro",
  defaultSeverity: "error",
  evaluate: (p) => {
    const raw = String((p as unknown as { condicao_produto?: string | null }).condicao_produto ?? "").trim();
    if (raw.toUpperCase().startsWith("NOVO")) return { status: "pass" };
    return {
      status: "error",
      message: raw ? `Condição está como "${raw}"; deve ser Novo.` : "Condição não preenchida; deve ser Novo.",
    };
  },
};
