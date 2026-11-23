import { test } from "node:test";
import { deepStrictEqual, throws } from "node:assert";
import { productCustomFieldModules, CUSTOM_FIELD_ACCESS_MESSAGE } from "./custom-field-modules";

test("resposta vazia real da FMOCIONE não significa busca concluída com zero campos", () => {
  throws(() => productCustomFieldModules({ data: [] }), { message: CUSTOM_FIELD_ACCESS_MESSAGE });
});

test("usa somente o módulo de produtos retornado pela própria empresa", () => {
  const products = { id: 98309, nome: "Produtos", modulo: "Produtos" };
  deepStrictEqual(productCustomFieldModules({ data: [{ id: 98308, nome: "Clientes e Fornecedores", modulo: "Contatos" }, products] }), [products]);
});

test("não confunde módulos de contatos nem resposta inválida com campos de produtos", () => {
  throws(() => productCustomFieldModules({ data: [{ id: 98308, modulo: "Contatos" }] }), { message: CUSTOM_FIELD_ACCESS_MESSAGE });
  throws(() => productCustomFieldModules({ data: null }), /inválida/);
});