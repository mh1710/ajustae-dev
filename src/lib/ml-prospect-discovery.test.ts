import { afterEach, expect, it, vi } from "vitest";
import { collectCandidates, discoverNext, initialDiscovery } from "./ml-prospect.server";

afterEach(() => vi.unstubAllGlobals());

it("busca produtos além do primeiro nível das categorias selecionadas", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const path = new URL(input).pathname;
    const data = path === "/categories/informatica"
      ? { children_categories: [{ id: "acessorios" }] }
      : path === "/categories/acessorios"
        ? { children_categories: [{ id: "mouse" }] }
        : path.endsWith("/category/mouse")
          ? { content: [{ id: "MLB123", type: "PRODUCT" }] }
          : {};
    return new Response(JSON.stringify(data), { status: 200 });
  }));
  const rows = await collectCandidates("test", { categories: ["informatica", "eletronicos"], keywords: [], max_cost: 1000, max_length_cm: 70, max_weight_kg: 30, zip_code: "87020000" });
  expect(rows.map(row => row.catalog_product_id)).toContain("MLB123");
});

it("preserva o cursor entre ciclos e percorre mais de 25 subcategorias", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const path = new URL(input).pathname;
    return new Response(JSON.stringify(path === "/categories/root"
      ? { children_categories: Array.from({ length: 26 }, (_, i) => ({ id: `child${i}` })) }
      : path.endsWith("/category/child25") ? { content: [{ id: "MLB26", type: "PRODUCT" }] } : {}));
  }));
  const params = { categories: ["root"], keywords: [], max_cost: 1000, max_length_cm: 70, max_weight_kg: 30, zip_code: "87020000" };
  let step = await discoverNext("test", initialDiscovery(params));
  expect(step.state.categories).toHaveLength(26);
  expect(step.exhausted).toBe(false);
  const found: string[] = [];
  while (!step.exhausted) {
    step = await discoverNext("test", JSON.parse(JSON.stringify(step.state)));
    found.push(...step.candidates.map(c => c.catalog_product_id));
  }
  expect(found).toEqual(["MLB26"]);
  expect(step.state.visited).toHaveLength(27);
});

it("deduplica produtos entre categorias e termina em fonte vazia", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => new Response(JSON.stringify(
    new URL(input).pathname.includes("/highlights/") ? { content: [{ id: "MLB1", type: "PRODUCT" }] } : {},
  ))));
  const rows = await collectCandidates("test", { categories: ["a", "b"], keywords: [], max_cost: 1000, max_length_cm: 70, max_weight_kg: 30, zip_code: "87020000" });
  expect(rows).toHaveLength(1);
  const empty = await discoverNext("test", { categories: [], visited: [], keywords: [], keywordOffset: 0 });
  expect(empty.exhausted).toBe(true);
  expect(empty.candidates).toEqual([]);
});

it("continua palavras-chave depois dos primeiros 150 resultados", async () => {
  const offsets: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const offset = Number(new URL(input).searchParams.get("offset"));
    offsets.push(offset);
    return new Response(JSON.stringify({ paging: { total: 201 }, results: Array.from({ length: Math.min(50, 201 - offset) }, (_, i) => ({ id: `MLB${offset + i}` })) }));
  }));
  const rows = await collectCandidates("test", { categories: [], keywords: ["mouse"], max_cost: 1000, max_length_cm: 70, max_weight_kg: 30, zip_code: "87020000" });
  expect(rows).toHaveLength(201);
  expect(offsets).toEqual([0, 50, 100, 150, 200]);
});