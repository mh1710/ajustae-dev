import { test } from "node:test";
import { strictEqual } from "node:assert";
import { marcaObrigatoriaRule } from "./marca-obrigatoria";

test("marca vazia é erro e marca preenchida passa", async () => {
  strictEqual((await marcaObrigatoriaRule.evaluate({ marca: "  " } as never, {} as never)).status, "error");
  strictEqual((await marcaObrigatoriaRule.evaluate({ marca: "Hayamax" } as never, {} as never)).status, "pass");
});
