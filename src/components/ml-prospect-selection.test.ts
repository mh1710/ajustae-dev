import { describe, expect, it } from "vitest";
import { loadAllProspectIds } from "./ml-prospect-selection";

describe("selecionar todos os produtos do garimpo", () => {
  it("seleciona também os produtos além dos 200 da página", async () => {
    const rows = Array.from({ length: 451 }, (_, id) => ({ id: `produto-${id + 1}` }));
    const pages: number[] = [];
    const ids = await loadAllProspectIds(async (page, size) => {
      pages.push(page);
      return { rows: rows.slice((page - 1) * size, page * size), total: rows.length };
    });
    expect(pages).toEqual([1, 2, 3]);
    expect(ids.size).toBe(451);
    expect(ids.has("produto-451")).toBe(true);
  });
  it("não duplica produtos entre páginas", async () => {
    const ids = await loadAllProspectIds(async page => ({
      rows: page === 1 ? Array.from({ length: 200 }, (_, id) => ({ id })) : [{ id: 199 }, { id: 200 }],
      total: 202,
    }));
    expect(ids.size).toBe(201);
  });
  it("não oferece uma seleção parcial se uma página falhar", async () => {
    await expect(loadAllProspectIds(async page => {
      if (page === 2) throw new Error("Falha na consulta");
      return { rows: Array.from({ length: 200 }, (_, id) => ({ id })), total: 451 };
    })).rejects.toThrow("Falha na consulta");
  });
});