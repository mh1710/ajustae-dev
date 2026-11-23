import type { RuleModule } from "../types";

function extractUrls(v: string): string[] {
  return v.split(/[|\n\r]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

export const imagensMinRule: RuleModule = {
  slug: "imagens-minimo",
  name: "Mínimo de 3 imagens",
  description: "O produto deve ter no mínimo 3 imagens.",
  category: "imagens",
  defaultSeverity: "error",
  defaultConfig: { min: 3 },
  evaluate: (p, cfg) => {
    const min = Number((cfg as { min?: number } | undefined)?.min ?? 3);
    const urls = extractUrls((p.url_imagens_externas ?? p.imagem_principal_url ?? "").toString());
    if (urls.length >= min) return { status: "pass" };
    return { status: "error", message: `Produto tem ${urls.length} imagem(ns) (mínimo ${min}).` };
  },
};
