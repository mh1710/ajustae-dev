import type { RuleModule } from "../types";

export const unidadeMedidaCentimetrosRule: RuleModule = {
  slug: "unidade-medida-centimetros",
  name: "Unidade de medida em centímetros",
  description: "A unidade de medida das dimensões do produto deve ser sempre centímetros.",
  category: "dimensoes",
  defaultSeverity: "error",
  evaluate: (p) => {
    const raw = String((p as unknown as { unidade_medida?: string | null }).unidade_medida ?? "").trim();
    const norm = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (norm.startsWith("centimetro") || norm === "cm") return { status: "pass" };
    return {
      status: "error",
      message: raw
        ? `Unidade de medida está em "${raw}"; deve ser Centímetros.`
        : "Unidade de medida não preenchida; deve ser Centímetros.",
    };
  },
};
