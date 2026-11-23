import type { RuleModule } from "../types";

function extractUrls(v: string): string[] {
  return v.split(/[|\n\r]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

export const imagensExtensaoRule: RuleModule = {
  slug: "imagens-extensao",
  name: "Extensão das imagens (.png/.jpg)",
  description: "Todas as URLs de imagem devem terminar em .png, .jpg ou .jpeg.",
  category: "imagens",
  defaultSeverity: "error",
  defaultConfig: {},
  evaluate: (p) => {
    const urls = extractUrls((p.url_imagens_externas ?? p.imagem_principal_url ?? "").toString());
    if (urls.length === 0) return { status: "pass" };
    const bad = urls.filter((u) => !/\.(png|jpe?g)$/i.test(u.split("?")[0].split("#")[0].trim()));
    if (bad.length === 0) return { status: "pass" };
    return {
      status: "error",
      message: `${bad.length} imagem(ns) sem extensão .png/.jpg.`,
      details: { urls: bad.slice(0, 5) },
    };
  },
};
