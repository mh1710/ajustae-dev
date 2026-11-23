import { test } from "node:test";
import { strictEqual } from "node:assert";
import { CUSTOM_FIELD_FIXED_VALUES } from "./custom-field-fixed-values";

test("garantia por extenso preenche exatamente 3 meses", () => {
  strictEqual(CUSTOM_FIELD_FIXED_VALUES.garantia_extenso, "3 meses");
});

test("garantia numérica continua preenchendo 3", () => {
  strictEqual(CUSTOM_FIELD_FIXED_VALUES.garantia, "3");
});