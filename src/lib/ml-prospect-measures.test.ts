import { afterEach, expect, it, vi } from "vitest";
import { mergeExactMeasures } from "./ml-prospect-measures";
import { evaluateCandidate } from "./ml-prospect.server";
const empty = { weight_kg: null, length_cm: null, width_cm: null, height_cm: null };
const complete = { weight_kg: 1, length_cm: 20, width_cm: 10, height_cm: 5 };
afterEach(() => vi.unstubAllGlobals());
it("aceita só doadores de EAN exato", () => {
  expect(mergeExactMeasures(empty, "7891234567890", [{ ean: "7891234567891", source: "outro", measures: complete }]).measures).toEqual(empty);
});
it("mantém valores informados e bloqueia doadores conflitantes", () => {
  const result = mergeExactMeasures({ ...empty, weight_kg: 2 }, "7891234567890", [
    { ean: "7891234567890", source: "a", measures: complete },
    { ean: "7891234567890", source: "b", measures: { ...complete, length_cm: 30 } },
  ]);
  expect(result.measures).toEqual({ ...complete, weight_kg: 2, length_cm: null });
});
function mockDonor(ean = "7891234567890", weight = "1 kg", variations = false, searchEan: string | null = null) {
  const attrs = [{ id: "GTIN", value_name: ean }, { id: "PACKAGE_WEIGHT", value_name: weight }, { id: "PACKAGE_LENGTH", value_name: "20 cm" }, { id: "PACKAGE_WIDTH", value_name: "10 cm" }, { id: "PACKAGE_HEIGHT", value_name: "5 cm" }];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const path = new URL(input).pathname;
    const data = path === "/products/search" && searchEan ? { results: [{ id: "MLB999" }] }
      : path === "/products/MLB999" ? { attributes: attrs.map(a => a.id === "GTIN" ? { ...a, value_name: searchEan } : a) }
      : path === "/products/MLB123" ? { name: "Mouse", pictures: [1,2,3].map(i => ({ url: `https://example.com/${i}.jpg` })), attributes: [{ id: "GTIN", value_name: "7891234567890" }] }
      : path.endsWith("/items") ? { results: [ { id: "MLB1", price: 100, shipping: { logistic_type: "fulfillment" } }, { id: "MLB2", price: 900, shipping: { logistic_type: "cross_docking" } } ] }
      : path.endsWith("/shipping_options") ? { options: [{ cost: 10 }] }
      : path === "/items/MLB2" ? { id: "MLB2", attributes: attrs, variations: variations ? [{ attributes: [{ id: "GTIN", value_name: "7891234567891" }] }] : [] }
      : {};
    return new Response(JSON.stringify(data));
  }));
}
const params = { categories: [], keywords: [], max_cost: 200, max_weight_kg: 30, max_length_cm: 70, zip_code: "87020000", shipping_mode: "full" as const, require_measures: true };
it("oferta Full usa medidas do mesmo EAN em oferta cara não Full sem copiar custo/frete", async () => {
  mockDonor();
  const result = await evaluateCandidate("test", "MLB123", params);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Esperado recuperar medidas");
  expect(result.row.weight_kg).toBe(1);
  expect(result.row.length_cm).toBe(20);
  expect(result.row.item_id).toBe("MLB1");
  expect(result.row.total_price).toBe(110);
  expect(result.row.is_full).toBe(true);
  expect(result.row.raw.measurement_sources).toEqual({ weight_kg: ["Anúncio MLB2"], length_cm: ["Anúncio MLB2"], width_cm: ["Anúncio MLB2"], height_cm: ["Anúncio MLB2"] });
});
it("rejeita doador com EAN diferente", async () => {
  mockDonor("7891234567891");
  expect((await evaluateCandidate("test", "MLB123", params)).ok).toBe(false);
});
it("reaplica limite de peso após recuperar", async () => {
  mockDonor("7891234567890", "31 kg");
  expect((await evaluateCandidate("test", "MLB123", params)).ok).toBe(false);
});
it("não usa medidas gerais de anúncio com outra variação", async () => {
  mockDonor("7891234567890", "1 kg", true);
  expect((await evaluateCandidate("test", "MLB123", params)).ok).toBe(false);
});
it("recupera medidas em outro catálogo que publica o mesmo EAN", async () => {
  mockDonor("7891234567891", "1 kg", false, "7891234567890");
  const result = await evaluateCandidate("test", "MLB123", params);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Esperado catálogo doador exato");
  expect(result.row.weight_kg).toBe(1);
  expect(result.row.raw.measurement_sources).toEqual({ weight_kg: ["Catálogo MLB999"], length_cm: ["Catálogo MLB999"], width_cm: ["Catálogo MLB999"], height_cm: ["Catálogo MLB999"] });
});
it("resultado de busca por EAN não autoriza catálogo com outro código", async () => {
  mockDonor("7891234567891", "1 kg", false, "7891234567892");
  expect((await evaluateCandidate("test", "MLB123", params)).ok).toBe(false);
});