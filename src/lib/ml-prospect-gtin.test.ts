import { expect, it } from "vitest";
import { catalogSearchGtin, validGtin } from "./ml-prospect-gtin";
import { mergeProspectPictures } from "./ml-prospect-photos";

it("aceita somente EAN com dígito verificador válido", () => {
  expect(validGtin("7896637669542")).toBe(true);
  expect(validGtin("7896637669543")).toBe(false);
});
it("usa o EAN da busca somente para o mesmo produto de catálogo", () => {
  const results = [
    { id: "MLB999", attributes: [{ id: "GTIN", value_name: "7898169739120" }] },
    { id: "MLB123", attributes: [{ id: "GTIN", value_name: "7896637669542" }] },
  ];
  expect(catalogSearchGtin(results, "MLB123")).toBe("7896637669542");
  expect(catalogSearchGtin(results, "MLB555")).toBeNull();
});
it("lista com vários EANs do mesmo catálogo usa o primeiro válido", () => {
  const results = [{ id: "MLB123", attributes: [{ id: "GTIN", value_name: "7896637669543, 07898169739120" }] }];
  expect(catalogSearchGtin(results, "MLB123")).toBe("7898169739120");
});
it("catálogo sem EAN válido continua sem EAN", () => {
  expect(catalogSearchGtin([{ id: "MLB123", attributes: [{ id: "GTIN", value_name: "123" }] }], "MLB123")).toBeNull();
});
it("completa fotos com as do fornecedor sem repetir", () => {
  const pics = mergeProspectPictures(["https://a/1.jpg"], ["https://a/1.jpg|https://b/2.png|https://b/3.webp", "https://c/4.JPG"]);
  expect(pics).toEqual(["https://a/1.jpg", "https://b/2.png", "https://c/4.JPG"]);
});
