import { test } from "node:test";
import { deepStrictEqual, throws } from "node:assert";
import { customFieldEditScope } from "./custom-field-edit-scope";

test("edição individual envia somente o produto aberto, mesmo com outros selecionados e filtro ativo", () => {
  deepStrictEqual(customFieldEditScope("produto-1", "filtered", new Set(["produto-2", "produto-3"]), { search: "HA" }), { product_ids: ["produto-1"] });
});

test("seleção vazia nunca amplia a edição para todos os produtos", () => {
  throws(() => customFieldEditScope(null, "selected", new Set(), {}));
});