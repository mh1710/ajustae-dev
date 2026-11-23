import type { RuleModule } from "../types";

export const marcaObrigatoriaRule: RuleModule = {
  slug: "marca-obrigatoria",
  name: "Marca obrigatória",
  description: "O produto deve ter a marca preenchida no Bling.",
  category: "cadastro",
  defaultSeverity: "error",
  evaluate: (p) => (String(p.marca ?? "").trim() ? { status: "pass" } : { status: "error", message: "Marca não preenchida no Bling." }),
};
