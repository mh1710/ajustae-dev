import { describe, expect, it } from "vitest";
import {
  blingImagesMatch,
  blingNonMediaFieldsMatch,
  buildBlingMediaPatch,
  mergeLastSentMedia,
  nextRotationAt,
} from "./cdn-rotation";

const detail = {
  data: {
    id: 10,
    nome: "Produto",
    midia: {
      video: { url: "https://video.example/teste" },
      imagens: { externas: [{ link: "https://old.example/1.jpg" }] },
    },
  },
};

describe("payload de mídia da rotação CDN", () => {
  it("preserva vídeo e envia a mídia aninhada completa", () => {
    const patch = buildBlingMediaPatch(detail, [
      "https://cdn.example/v2/a",
      "https://cdn.example/v2/b",
    ]);
    expect(patch).toEqual({
      midia: {
        video: { url: "https://video.example/teste" },
        imagens: {
          imagensURL: [{ link: "https://cdn.example/v2/a" }, { link: "https://cdn.example/v2/b" }],
        },
      },
    });
  });

  it("usa vídeo vazio explicitamente quando o produto não tem vídeo", () => {
    expect(
      buildBlingMediaPatch({ data: { midia: { imagens: { externas: [] } } } }, [
        "https://cdn.example/a",
      ]),
    ).toMatchObject({ midia: { video: { url: "" } } });
  });

  it("só confirma URLs na mesma ordem", () => {
    expect(blingImagesMatch(detail, ["https://old.example/1.jpg"])).toBe(true);
    expect(blingImagesMatch(detail, ["https://old.example/2.jpg"])).toBe(false);
  });

  it("altera somente a mídia no snapshot local", () => {
    const patch = buildBlingMediaPatch(detail, ["https://cdn.example/a"]);
    expect(mergeLastSentMedia({ nome: "Produto", preco: 10 }, patch)).toEqual({
      nome: "Produto",
      preco: 10,
      midia: patch.midia,
    });
  });

  it("detecta mudança concorrente em campos importantes", () => {
    const after = structuredClone(detail);
    after.data.midia.imagens.externas = [{ link: "https://cdn.example/a" }];
    expect(blingNonMediaFieldsMatch(detail, after)).toBe(true);
    after.data.nome = "Outro nome";
    expect(blingNonMediaFieldsMatch(detail, after)).toBe(false);
  });

  it("agenda pelo calendário e horário de São Paulo", () => {
    const next = nextRotationAt(new Date("2026-11-18T15:00:00Z"), 30, 2, "America/Sao_Paulo");
    expect(next.toISOString()).toBe("2026-12-18T05:00:00.000Z");
  });
});
