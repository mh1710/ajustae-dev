import { describe, expect, it } from "vitest";
import { preparedIssues, type PreparedProspect } from "./ml-prospect-ready";

const desc = "Descrição completa do produto ".repeat(8) + "Garantia: 3 meses | Código Anatel: Não se aplica | Anvisa: Isento";
const complete = (over: Record<string, unknown> = {}, extra: Partial<PreparedProspect> = {}): PreparedProspect => ({
  row: {
    id: "1", titulo: "Suporte articulado para monitor", marca: "Zinnia", ncm: "83025000",
    weight_kg: 2.6, length_cm: 12, width_cm: 30, height_cm: 41,
    raw: { review: { titulo: "Suporte articulado para monitor", anatel: "Não se aplica", descricao_curta: desc }, prepared: {} },
    ...over,
  },
  blockers: [], ...extra,
});

describe("somente produtos 100% vão para a importação", () => {
  it("produto completo não tem pendência", () => {
    expect(preparedIssues(complete())).toEqual([]);
  });
  it("faltando peso fica fora", () => {
    expect(preparedIssues(complete({ weight_kg: null }))).toEqual(["Falta: peso (kg)"]);
  });
  it("EAN de outra variação fica fora", () => {
    const p = complete();
    p.row.raw.prepared.identity_note = "EAN é do Redmi Buds Active";
    expect(preparedIssues(p)).toHaveLength(1);
  });
  it("regra de auditoria não atendida fica fora", () => {
    expect(preparedIssues(complete({}, { blockers: ["Margem abaixo de 40%"] }))).toEqual(["Margem abaixo de 40%"]);
  });
  it("aviso informativo do fornecedor não é pendência", () => {
    expect(preparedIssues(complete({}, { notes: ["O fornecedor Mercado Livre será cadastrado."] }))).toEqual([]);
  });
});
