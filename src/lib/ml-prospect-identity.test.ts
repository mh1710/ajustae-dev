import { afterEach, expect, it, vi } from "vitest";
import { evaluateCandidate, resolveProspectIdentity } from "./ml-prospect.server";

afterEach(() => vi.unstubAllGlobals());
const params = { categories: [], keywords: [], max_cost: 200, max_weight_kg: 30, max_length_cm: 70, zip_code: "87020000", shipping_mode: "full" as const };
function mockIdentity(attributes: unknown[], variations: unknown[] = []) {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const path = new URL(input).pathname;
    const data = path === "/items/MLB1" ? { catalog_product_id: "MLB123", attributes, variations }
      : path.endsWith("/shipping_options") ? { options: [{ cost: 0 }] }
      : path.endsWith("/items") ? { results: [{ id: "MLB1", price: 100, shipping: { logistic_type: "fulfillment" } }] }
      : { name: "Mouse", attributes: [], pictures: [1, 2, 3].map(i => ({ url: `https://example.com/${i}.jpg` })) };
    return new Response(JSON.stringify(data));
  }));
}
it("recupera EAN do anúncio quando o catálogo não informa", async () => {
  mockIdentity([{ id: "GTIN", value_name: "7891234567890" }]);
  const result = await evaluateCandidate("test", "MLB123", params);
  expect(result.ok && result.row.ean).toBe("7891234567890");
});
it("não conta produto sem EAN como encontrado", async () => {
  mockIdentity([]);
  const result = await evaluateCandidate("test", "MLB123", params);
  expect(result.ok).toBe(false);
  expect(!result.ok && result.reason).toContain("EAN");
});
it("não usa EAN de outra variação de catálogo", async () => {
  mockIdentity([], [{ catalog_product_id: "MLB999", attributes: [{ id: "GTIN", value_name: "7891234567890" }] }]);
  expect((await evaluateCandidate("test", "MLB123", params)).ok).toBe(false);
});
it("recupera o EAN da variação exata", async () => {
  mockIdentity([], [{ catalog_product_id: "MLB123", attributes: [{ id: "GTIN", values: [{ name: "7891234567890" }] }] }]);
  const result = await evaluateCandidate("test", "MLB123", params);
  expect(result.ok && result.row.ean).toBe("7891234567890");
});

it("403 nos detalhes não descarta o EAN publicado no catálogo", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "access_denied" }), { status: 403 }));
  vi.stubGlobal("fetch", fetcher);
  const identity = await resolveProspectIdentity("test", "MLB123", "MLB1", { attributes: [{ id: "GTIN", value_name: "7891234567890" }] });
  expect(identity.ean).toBe("7891234567890");
  expect(identity.accessDenied).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("403 e catálogo sem EAN não autoriza identidade inventada", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
  const identity = await resolveProspectIdentity("test", "MLB123", "MLB1", { attributes: [] });
  expect(identity.ean).toBeNull();
  expect(identity.accessDenied).toBe(true);
});
it("usa o EAN da busca de catálogo quando o anúncio é negado", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/products/search") return new Response(JSON.stringify({ results: [
      { id: "MLB999", attributes: [{ id: "GTIN", value_name: "7898169739120" }] },
      { id: "MLB123", attributes: [{ id: "GTIN", value_name: "7896637669542" }] },
    ] }));
    return new Response("{}", { status: 403 });
  }));
  const identity = await resolveProspectIdentity("test", "MLB123", "MLB1", { attributes: [] });
  expect(identity.ean).toBe("7896637669542");
});

it("coleta rápida não barra por poucas fotos, mas mantém o EAN obrigatório", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const path = new URL(input).pathname;
    const data = path === "/items/MLB1" ? { catalog_product_id: "MLB123", attributes: [], variations: [] }
      : path.endsWith("/shipping_options") ? { options: [{ cost: 0 }] }
      : path === "/products/search" ? { results: [] }
      : path.endsWith("/items") ? { results: [{ id: "MLB1", price: 100, shipping: { logistic_type: "fulfillment" } }] }
      : { name: "Mouse", attributes: [], pictures: [{ url: "https://example.com/1.jpg" }] };
    return new Response(JSON.stringify(data));
  }));
  const strict = await evaluateCandidate("test", "MLB123", params);
  expect(!strict.ok && strict.reason).toContain("foto");
  const quick = await evaluateCandidate("test", "MLB123", { ...params, quick_collect: true });
  expect(!quick.ok && quick.reason).toContain("EAN");
});
