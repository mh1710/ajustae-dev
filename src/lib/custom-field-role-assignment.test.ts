import { test } from "node:test";
import { deepStrictEqual } from "node:assert";
import { assignCustomFieldRole } from "./custom-field-role-assignment";

test("apontar Anatel no campo real mantém os apontamentos dos outros campos", () => {
  deepStrictEqual(assignCustomFieldRole({ mapa: "campo-a", anvisa: "campo-b" }, "campo-a", "anatel"), {
    anatel: "campo-a", anvisa: "campo-b",
  });
});

test("Não atualizar remove somente os papéis do campo escolhido", () => {
  deepStrictEqual(assignCustomFieldRole({ mapa: "campo-a", anatel: "campo-a", garantia: "campo-b" }, "campo-a", null), {
    garantia: "campo-b",
  });
});