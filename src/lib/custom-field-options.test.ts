import { test } from "node:test";
import { deepStrictEqual, ok } from "node:assert";
import {
  CUSTOM_FIELD_TIPO_NOMES,
  customFieldOptions,
  customFieldValueAllowed,
  isCustomFieldList,
} from "./custom-field-options";

const garantia = {
  tipo_campo_id: 3,
  opcoes: [
    { id: 0, nome: "Selecione uma opção" },
    { id: 368286000, nome: "1 mês" },
    { id: 368286001, nome: "3 meses" },
    { id: 368286002, nome: "6 meses" },
    { id: 368286003, nome: "12 meses" },
  ],
};

test("lista suspensa mostra as opções reais sem o aviso de seleção", () => {
  ok(isCustomFieldList(garantia));
  deepStrictEqual(customFieldOptions(garantia), ["1 mês", "3 meses", "6 meses", "12 meses"]);
});

test("campo de texto simples não tem opções e aceita qualquer valor", () => {
  const texto = { tipo_campo_id: 4, opcoes: null };
  ok(!isCustomFieldList(texto));
  deepStrictEqual(customFieldOptions(texto), []);
  ok(customFieldValueAllowed("qualquer coisa", texto));
});

test("valor com a mesma grafia da lista é aceito, mesmo mudando maiúsculas", () => {
  ok(customFieldValueAllowed("3 meses", garantia));
  ok(customFieldValueAllowed("3 MESES", garantia));
});

test("valor fora da lista é rejeitado e vazio serve para limpar", () => {
  ok(!customFieldValueAllowed("3 Meses!", garantia));
  ok(!customFieldValueAllowed("Garantia estendida", garantia));
  ok(customFieldValueAllowed("", garantia));
});

test("tipo 3 aparece como Lista na legenda", () => {
  deepStrictEqual(CUSTOM_FIELD_TIPO_NOMES[3], "Lista");
});
