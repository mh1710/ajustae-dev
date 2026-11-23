import type { RuleModule } from "../types";

export const garantiaAnatelRule: RuleModule = {
  slug: "garantia-anatel-desc-complementar",
  name: "Descrição curta precisa conter Garantia, Anatel e Anvisa",
  description:
    "A descrição curta deve conter as palavras \"Garantia\", \"Anatel\" e \"Anvisa\" (não importa maiúsculas/minúsculas).",
  category: "conteudo",
  defaultSeverity: "error",
  defaultConfig: {},
  evaluate: (p) => {
    const desc = (p.descricao_curta ?? "").toString();
    const faltando = [
      { termo: "Garantia", ok: /garantia/i.test(desc) },
      { termo: "Anatel", ok: /anatel/i.test(desc) },
      { termo: "Anvisa", ok: /anvisa/i.test(desc) },
    ]
      .filter((t) => !t.ok)
      .map((t) => t.termo);

    if (faltando.length === 0) return { status: "pass" };
    return {
      status: "error",
      message:
        faltando.length === 1
          ? `Descrição curta não contém "${faltando[0]}".`
          : `Descrição curta não contém ${faltando.map((t) => `"${t}"`).join(" nem ")}.`,
    };
  },
};
