import { describe, expect, it } from "vitest";
import { autoCustomFieldValues, creationCustomFieldValues, type AutoFieldRole } from "./custom-field-auto-values";

const sos: AutoFieldRole[] = [
  { role: "anatel_homologacao", cf: "a", bid: 1, valor: null, nome: "Codigo Homologaçao Anatel" },
  { role: "anvisa", cf: "b", bid: 2, valor: null, nome: "Anvisa" },
  { role: "anatel", cf: "c", bid: 3, valor: null, nome: "Anatel" },
];

describe("campos customizados automáticos", () => {
  it("produto com código Anatel leva o código nos dois campos Anatel e Anvisa Não se aplica", () => {
    expect(autoCustomFieldValues(sos, { anatel: "07706-24-09185", modelo: null }).map((v) => v.valor))
      .toEqual(["07706-24-09185", "Não se aplica", "07706-24-09185"]);
  });
  it("sem código Anatel grava Não se aplica, nunca Isento", () => {
    expect(autoCustomFieldValues(sos, { anatel: "isento", modelo: null })[0]?.valor).toBe("Não se aplica");
  });
  it("garantia por extenso vai como 3 meses e numérica como 3", () => {
    const roles: AutoFieldRole[] = [
      { role: "garantia_extenso", cf: "g", bid: 9, valor: null, nome: "Garantia" },
      { role: "garantia", cf: "n", bid: 8, valor: null, nome: "Meses" },
    ];
    expect(autoCustomFieldValues(roles, { anatel: null, modelo: null }).map((v) => v.valor)).toEqual(["3 meses", "3"]);
  });
  it("no cadastro não envia valor fora da lista do Bling", () => {
    const roles: AutoFieldRole[] = [{ role: "garantia_extenso", cf: "g", bid: 9, valor: null, nome: "Garantia", field: { tipo_campo_id: 3, opcoes: [{ id: 1, nome: "1 mês" }] } }];
    expect(creationCustomFieldValues(roles, { anatel: null, modelo: null })).toEqual([]);
  });
  it("modelo não encontrado não é enviado", () => {
    const roles: AutoFieldRole[] = [{ role: "modelo", cf: "m", bid: 5, valor: null, nome: "Modelo" }];
    expect(creationCustomFieldValues(roles, { anatel: null, modelo: null })).toEqual([]);
  });
});
