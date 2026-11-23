import type { RuleModule } from "../types";

export const imagensObrigatoriasRule: RuleModule = {
  slug: "imagens-obrigatorias",
  name: "Precisa ter imagens",
  description: "O produto precisa ter ao menos uma imagem.",
  category: "imagens",
  defaultSeverity: "error",
  defaultConfig: {},
  evaluate: (p) => {
    const raw = (p.url_imagens_externas ?? p.imagem_principal_url ?? "").toString();
    const urls = raw.split(/[|\n\r]+/).map((s) => s.trim()).filter(Boolean);
    return urls.length > 0
      ? { status: "pass" }
      : { status: "error", message: "Nenhuma imagem informada." };
  },
};