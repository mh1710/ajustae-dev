import { test } from "node:test";
import { strictEqual } from "node:assert";
import { isCompanyFunctionAllowed } from "./company-access-policy";

test("conta de empresa consulta ofertas ML já sincronizadas", () => {
  strictEqual(isCompanyFunctionAllowed("mercadolivre.functions.ts", "getMlSupplierQuote"), true);
  strictEqual(isCompanyFunctionAllowed("mercadolivre.functions.ts", "getCompanyCatalogStatus"), true);
});
test("conta de empresa não altera sincronização nem preços do ML", () => {
  for (const action of ["startMlMapping", "refreshMlSupplierQuote", "disconnectMl", "cancelMlMapping"]) {
    strictEqual(isCompanyFunctionAllowed("mercadolivre.functions.ts", action), false);
  }
});
test("conta de empresa pode cadastrar, consultar e excluir repasses no DRE", () => {
  for (const action of ['listRepasses','saveRepasse','deleteRepasse']) {
    strictEqual(isCompanyFunctionAllowed('repasses.functions.ts',action),true);
  }
  strictEqual(isCompanyFunctionAllowed('repasses.functions.ts','clearAllRepasses'),false);
});