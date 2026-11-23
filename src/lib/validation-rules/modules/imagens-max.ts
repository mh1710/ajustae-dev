import type { RuleModule } from "../types";

function extractUrls(v: string): string[] {
  return v.split(/[|\n\r]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

export const imagensMaxRule: RuleModule = {
  slug: "imagens-maximo",
  name: "Máximo de 18 imagens",
  description: "O produto deve ter no máximo 18 imagens.",
  category: "imagens",
  defaultSeverity: "error",
  defaultConfig: { max: 18 },
  evaluate: (p, cfg) => {
    const max = Number((cfg as { max?: number } | undefined)?.max ?? 18);
    const urls = extractUrls((p.url_imagens_externas ?? p.imagem_principal_url ?? "").toString());
    if (urls.length <= max) return { status: "pass" };
    return { status: "error", message: `Produto tem ${urls.length} imagens (máximo ${max}).` };
  },
};
