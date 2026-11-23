import { afterEach, expect, it, vi } from "vitest";
import { evaluateCandidate } from "./ml-prospect.server";
import { prospectRequiredIssues } from "./ml-prospect-approval";

afterEach(() => vi.unstubAllGlobals());

function mockOffer(full: boolean, tomorrow: boolean) {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const path = new URL(input).pathname;
    const data = path.endsWith("/shipping_options") ? { options: [{ cost: 10, estimated_delivery_time: { date: new Date(Date.now() + (tomorrow ? 12 : 120) * 3600_000).toISOString() } }] }
      : path.endsWith("/items") ? { results: [{ id: "MLB1", price: 100, available_quantity: 5, condition: "new", shipping: { logistic_type: full ? "fulfillment" : "cross_docking" } }] }
      : { name: "Mouse", pictures: [1, 2, 3].map(i => ({ url: `https://example.com/${i}.jpg` })), attributes: [{ id: "GTIN", value_name: "7891234567890" }] };
    return new Response(JSON.stringify(data));
  }));
}
const params = { categories: [], keywords: [], max_cost: 200, max_weight_kg: 30, max_length_cm: 70, zip_code: "87020000" };

it("envio Full aprova mesmo chegando depois de amanhã na busca e revisão", async () => {
  mockOffer(true, false);
  const result = await evaluateCandidate("test", "MLB123", { ...params, shipping_mode: "full" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.row.is_full).toBe(true);
  expect(result.row.arrives_tomorrow).toBe(false);
  expect(prospectRequiredIssues(result.row).filter(x => x.rule === "oferta-ml")).toEqual([]);
});
it("chega amanhã aprova sem Full na busca e revisão", async () => {
  mockOffer(false, true);
  const result = await evaluateCandidate("test", "MLB123", { ...params, shipping_mode: "tomorrow" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.row.is_full).toBe(false);
  expect(result.row.arrives_tomorrow).toBe(true);
  expect(prospectRequiredIssues(result.row).filter(x => x.rule === "oferta-ml")).toEqual([]);
});
it("Full rejeita oferta não Full", async () => {
  mockOffer(false, true);
  expect((await evaluateCandidate("test", "MLB123", { ...params, shipping_mode: "full" })).ok).toBe(false);
});
it("chega amanhã rejeita Full com prazo maior", async () => {
  mockOffer(true, false);
  expect((await evaluateCandidate("test", "MLB123", { ...params, shipping_mode: "tomorrow" })).ok).toBe(false);
});
it("escolha não dispensa o teto de preço mais frete", async () => {
  mockOffer(true, true);
  expect((await evaluateCandidate("test", "MLB123", { ...params, max_cost: 105, shipping_mode: "full" })).ok).toBe(false);
});