import { describe, expect, it } from "vitest";
import { prospectIssues, prospectRequiredIssues, prospectStock, prospectProfitOk } from "./ml-prospect-approval";

describe("garimpo seguro", () => {
  it("bloqueia qualquer erro mesmo junto com dez aprovações", () => {
    expect(prospectIssues([...Array.from({ length: 10 }, () => ({ rule: "foto", result: { status: "pass" as const } })), { rule: "foto", result: { status: "error" as const } }])).toHaveLength(1);
  });
  it("não permite aviso no cadastro aprovado", () => {
    expect(prospectIssues([{ rule: "ean", result: { status: "warning" } }])).toHaveLength(1);
  });
  it("limita o estoque a dez", () => expect(prospectStock(true, 50)).toBe(10));
  it("zera quando não há oferta válida", () => expect(prospectStock(false, 10)).toBe(0));
  it("não inventa quantidade ausente", () => expect(prospectStock(true, undefined)).toBe(0));
  it("mantém lucro mínimo ML de quarenta por cento", () => { expect(prospectProfitOk(139, 100)).toBe(false); expect(prospectProfitOk(140, 100)).toBe(true); });
  it("exige revisão individual de NCM e Anatel", () => {
    const row = { ean: "7891234567890", ncm: "12345678", weight_kg: 1, length_cm: 10, width_cm: 10, height_cm: 10, is_full: true, arrives_tomorrow: true, available_quantity: 1, pictures: ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg"] };
    expect(prospectRequiredIssues(row).map(x => x.rule)).toEqual(["ncm-obrigatorio", "anatel"]);
    expect(prospectRequiredIssues({ ...row, raw: { review: { ncm_confirmed: true, anatel_confirmed: true, anatel: "Não se aplica" } } })).toEqual([]);
  });
  it("exige três fotos antes do cadastro, mesmo na coleta rápida", () => {
    const row = { ean: "7891234567890", ncm: "12345678", weight_kg: 1, length_cm: 10, width_cm: 10, height_cm: 10, is_full: true, arrives_tomorrow: true, available_quantity: 1, pictures: ["https://a/1.jpg", "https://a/2.jpg"], raw: { review: { ncm_confirmed: true, anatel_confirmed: true, anatel: "Não se aplica" } } };
    expect(prospectRequiredIssues(row).map(x => x.rule)).toEqual(["fotos-minimas"]);
  });
});