import { afterEach, expect, it, vi } from "vitest";
import { excludedProspectType, usesAllProspectCategories } from "./ml-prospect-scope";
import { collectCandidates, evaluateCandidate } from "./ml-prospect.server";

afterEach(() => vi.unstubAllGlobals());

it("sem categorias e sem palavras busca todos os departamentos", () => {
  expect(usesAllProspectCategories([], [])).toBe(true);
  expect(usesAllProspectCategories(["informatica"], [], true)).toBe(true);
  expect(usesAllProspectCategories(["informatica"], [])).toBe(false);
  expect(usesAllProspectCategories([], ["mouse"])).toBe(false);
});
it.each([
  ["MLB-MEDICINES", "Saúde > Medicamentos", "Remédio"],
  ["MLB-SUPPLEMENTS", "Suplementos", "Whey protein"],
  ["MLB-FOODS", "Alimentos e Bebidas", "Arroz"],
  ["MLB-BEVERAGES", "Bebidas", "Suco"],
  ["MLB-PET_FOOD", "Animais > Rações", "Ração"],
])("exclui ingeríveis: %s", (domain, category, title) => {
  expect(excludedProspectType(domain, category, title)).toBe(true);
});
it.each(["Mouse bluetooth", "Panela elétrica", "Cafeteira", "Suporte para suplementos", "Organizador de remédios"])("preserva objetos classificados: %s", title => {
  expect(excludedProspectType("MLB-HOME_APPLIANCES", "Casa > Utensílios", title)).toBe(false);
});
it("avaliação bloqueia suplemento antes de consultar frete ou cadastrar", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ name: "Whey protein", domain_id: "MLB-SUPPLEMENTS" })));
  vi.stubGlobal("fetch", fetchMock);
  const result = await evaluateCandidate("test", "MLB1", { categories: [], keywords: [], max_cost: 1000, max_length_cm: 70, max_weight_kg: 30, zip_code: "87020000" });
  expect(result.ok).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("busca geral percorre todos os departamentos fornecidos e suas subcategorias", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const path = new URL(input).pathname;
    const data = path === "/categories/casa" ? { children_categories: [{ id: "panelas" }] }
      : path.endsWith("/category/panelas") ? { content: [{ id: "MLB1", type: "PRODUCT" }] }
      : path.endsWith("/category/informatica") ? { content: [{ id: "MLB2", type: "PRODUCT" }] } : {};
    return new Response(JSON.stringify(data));
  }));
  const rows = await collectCandidates("test", { categories: ["casa", "informatica"], keywords: [], max_cost: 1000, max_length_cm: 70, max_weight_kg: 30, zip_code: "87020000" });
  expect(rows.map(r => r.catalog_product_id).sort()).toEqual(["MLB1", "MLB2"]);
});