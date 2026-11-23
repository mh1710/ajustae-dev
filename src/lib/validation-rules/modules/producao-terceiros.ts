import type { RuleModule } from "../types";

export const producaoTerceirosRule: RuleModule = {
  slug: "producao-terceiros",
  name: "Produção sempre Terceiros",
  description: "A produção do produto deve ser sempre Terceiros.",
  category: "cadastro",
  defaultSeverity: "error",
  evaluate: (p) => {
    const raw = String((p as unknown as { tipo_producao?: string | null }).tipo_producao ?? "").trim();
    if (raw.toUpperCase().startsWith("T")) return { status: "pass" };
    return {
      status: "error",
      message: raw ? `Produção está como "${raw}"; deve ser Terceiros.` : "Produção não preenchida; deve ser Terceiros.",
    };
  },
};
