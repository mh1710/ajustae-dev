import { test } from "node:test";
import { strictEqual } from "node:assert";
import { customFieldAnatelValue } from "./custom-field-anatel";

test("Anatel sem código preenche Não se aplica nos campos customizados", () => {
  for (const code of [null, undefined, "", "   ", "Isento", " isento "]) {
    strictEqual(customFieldAnatelValue(code), "Não se aplica");
  }
});

test("Anatel com código mantém o número de homologação", () => {
  strictEqual(customFieldAnatelValue("12345-26-01234"), "12345-26-01234");
});