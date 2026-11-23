import type { RuleModule } from "../types";

/**
 * Validação rápida das URLs de imagem sem chamadas HTTP.
 * Em auditorias em massa (22k+ produtos), fazer HEAD/GET em cada imagem
 * torna o processo lentíssimo e instável. Aqui apenas checamos formato
 * de URL e extensão declarada. A validação de dimensões deve ser feita
 * sob demanda no editor de produto (não em lote).
 */
export const imagensRule: RuleModule = {
  slug: "imagens-padrao",
  name: "Padrão das URLs de imagem (PNG/JPG)",
  description:
    "As URLs precisam ser HTTPS e terminar em .png/.jpg/.jpeg. A checagem de dimensões acontece na revisão individual do produto.",
  category: "imagens",
  defaultSeverity: "error",
  defaultConfig: {},
  evaluate: (p) => {
    const urls = extractUrls(p.url_imagens_externas ?? p.imagem_principal_url ?? "");
    if (urls.length === 0) return { status: "pass" };
    const failures: { url: string; reason: string }[] = [];
    for (const url of urls.slice(0, 12)) {
      let parsed: URL | null = null;
      try { parsed = new URL(url); } catch { /* ignore */ }
      if (!parsed) { failures.push({ url, reason: "URL inválida" }); continue; }
      if (parsed.protocol !== "https:") {
        failures.push({ url, reason: `protocolo ${parsed.protocol.replace(":", "")}` });
        continue;
      }
      const path = parsed.pathname.toLowerCase();
      if (!/\.(png|jpe?g)(\?|$)/.test(path + parsed.search)) {
        failures.push({ url, reason: "extensão não é PNG/JPG" });
      }
    }
    if (failures.length === 0) return { status: "pass" };
    return {
      status: "error",
      message: `${failures.length} URL(s) de imagem com problema.`,
      details: { failures },
    };
  },
};

function extractUrls(v: string): string[] {
  return v.split(/[|\n\r]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}
