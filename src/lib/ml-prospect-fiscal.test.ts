import { expect, it } from "vitest";
import { exactSupplierNcm } from "./ml-prospect-fiscal";
it("usa NCM informado pelo fornecedor de EAN exato", () => {
  expect(exactSupplierNcm([{ ncm: "8473.30.90" }])?.ncm).toBe("84733090");
});
it("não escolhe entre classificações conflitantes", () => {
  expect(exactSupplierNcm([{ ncm: "84733090" }, { ncm: "85183000" }])).toBeNull();
});
it("não inventa NCM quando o fornecedor não informa", () => {
  expect(exactSupplierNcm([{ ncm: null }])).toBeNull();
});