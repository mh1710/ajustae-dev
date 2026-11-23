import type { RuleModule } from "../types";

export const ncmObrigatorioRule: RuleModule = {
  slug: "ncm-obrigatorio",
  name: "NCM obrigatório",
  description: "O produto deve ter NCM preenchido no Bling.",
  category: "fiscal",
  defaultSeverity: "error",
  evaluate: (p) => {
    const ncm = String((p as unknown as { ncm?: string | null }).ncm ?? "").trim();
    return ncm ? { status: "pass" } : { status: "error", message: "NCM não preenchido no Bling." };
  },
};