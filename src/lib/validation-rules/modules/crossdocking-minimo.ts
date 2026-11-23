import type { RuleModule } from "../types";

export const crossdockingMinimoRule: RuleModule = {
  slug: "crossdocking-minimo",
  name: "Crossdocking mínimo",
  description: "O crossdocking do produto deve ser de no mínimo 3 dias.",
  category: "estoque",
  defaultSeverity: "warning",
  defaultConfig: { min_dias: 3 },
  evaluate: (p, cfg) => {
    const min = Number((cfg as { min_dias?: number } | undefined)?.min_dias ?? 3);
    const raw = String((p as unknown as { cross_docking?: string | null }).cross_docking ?? "").trim();
    const dias = Number(raw.match(/^\d+/)?.[0] ?? 0);
    if (dias >= min) return { status: "pass" };
    return {
      status: "warning",
      message: raw
        ? `Crossdocking de ${raw} dia(s) é menor que o mínimo de ${min} dias.`
        : `Crossdocking não preenchido (mínimo ${min} dias).`,
    };
  },
};
