import { describe, expect, it } from "vitest";
import {
  buildShortDescription, cleanResearchText, fillMeasures, fitTitle, keepPreparedMeasures, measureLimitIssue,
  normalizeAnatel, normalizeNcm, researchAnatel, researchNcm, type ProspectResearch,
} from "./ml-prospect-prepare";

const research = (over: Partial<ProspectResearch> = {}): ProspectResearch => ({
  brand: "Xiaomi", title_60: null, description: null, identity_note: null,
  ncm: { code: "8518.30.00", basis: "classificacao", source_url: "https://gov.br/ncm" },
  anatel: { status: "codigo", code: "07706-24-09185", source_url: "https://loja/produto" },
  measures: { weight_kg: 0.05, length_cm: 5.4, width_cm: 5.4, height_cm: 2.7, kind: "produto", source_url: "https://mi.com/specs" },
  ...over,
});

describe("preparação antes de importar", () => {
  it("descrição curta tem uma única Garantia de 3 meses, Anatel e Anvisa Isento", () => {
    const text = buildShortDescription("Fone sem fio. Garantia de 1 ano do fabricante. Bateria de 36 horas.", "07706-24-09185");
    expect(text.match(/garantia/gi)).toHaveLength(1);
    expect(text).toContain("Garantia: 3 meses | Código Anatel: 07706-24-09185 | Anvisa: Isento");
    expect(text).not.toContain("1 ano");
  });

  it("título passa de 60 caracteres só cortando em palavra inteira", () => {
    const title = fitTitle("Fone De Ouvido Sem Fio Xiaomi Redmi Buds 6 Active Bluetooth 5.4 Preto Original");
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("Bluetooth")).toBe(true);
  });

  it("NCM precisa de 8 dígitos e fonte citada", () => {
    expect(normalizeNcm("8518.30.00")).toBe("85183000");
    expect(normalizeNcm("8518")).toBeNull();
    expect(researchNcm(research())?.ncm).toBe("85183000");
    expect(researchNcm(research({ ncm: { code: "85183000", basis: "ean", source_url: null } }))).toBeNull();
  });

  it("Anatel aceita código com fonte ou Não se aplica para produto sem rádio", () => {
    expect(normalizeAnatel("isento")).toBe("Não se aplica");
    expect(researchAnatel(research())).toBe("07706-24-09185");
    expect(researchAnatel(research({ anatel: { status: "codigo", code: "07706-24-09185", source_url: null } }))).toBeNull();
    expect(researchAnatel(research({ anatel: { status: "nao_encontrado", code: null, source_url: null } }))).toBeNull();
  });

  it("medidas pesquisadas só preenchem campos vazios e exigem fonte", () => {
    const base = { weight_kg: 0.7, length_cm: 29.7, width_cm: null, height_cm: null };
    const { measures } = fillMeasures(base, research());
    expect(measures).toEqual({ weight_kg: 0.7, length_cm: 29.7, width_cm: 5.4, height_cm: 2.7 });
    const noSource = research({ measures: { ...research().measures, source_url: null } });
    expect(fillMeasures(base, noSource).measures.width_cm).toBeNull();
  });

  it("na importação a medida atual do Mercado Livre vence e a preparada cobre o que falta", () => {
    const kept = keepPreparedMeasures({ weight_kg: 1, length_cm: null, width_cm: null, height_cm: 3 }, { weight_kg: 2, length_cm: 10, width_cm: 8, height_cm: 4 });
    expect(kept.measures).toEqual({ weight_kg: 1, length_cm: 10, width_cm: 8, height_cm: 3 });
    expect(kept.complete).toBe(true);
  });

  it("limites de peso e comprimento do garimpo continuam valendo", () => {
    expect(measureLimitIssue({ weight_kg: 31, length_cm: 10, width_cm: 10, height_cm: 10 }, 30, 70)).toContain("Peso");
    expect(measureLimitIssue({ weight_kg: 1, length_cm: 71, width_cm: 10, height_cm: 10 }, 30, 70)).toContain("71");
    expect(measureLimitIssue({ weight_kg: 1, length_cm: 70, width_cm: 10, height_cm: 10 }, 30, 70)).toBeNull();
  });

  it("remove links e citações da pesquisa", () => {
    expect(cleanResearchText("Fone com IPX4. ([loja.com](https://loja.com/x?utm=1))")).toBe("Fone com IPX4.");
  });
});
