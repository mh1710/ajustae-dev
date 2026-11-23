import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { eanMatches, pickMlImageUrls, pickSupplierImageUrls, supplierFirstImages, currentImageCorrection, mergeVerifiedImages } from "./ml-images";

test("só aceita GTIN exatamente igual ao EAN", () => {
  const attrs = [{ id: "GTIN", value_name: "7891234567895, 7890000000001" }];
  strictEqual(eanMatches(attrs, "7891234567895"), true);
  strictEqual(eanMatches(attrs, "7891234567896"), false);
});
test("dez fotos inválidas não bloqueiam a busca pelo mínimo de três", () => {
  const current = Array.from({ length: 10 }, (_, i) => `https://fotos.test/${i}.jpg`);
  const result = currentImageCorrection(current, [], 3, 18);
  strictEqual(result.skip, false);
  strictEqual(result.cleanupOnly, false);
  strictEqual(result.valid.length, 0);
  strictEqual(result.invalid.length, 10);
});
test("três fotos válidas e uma inválida sugerem limpeza, não pulam correção", () => {
  const valid = ["https://fotos.test/1.jpg", "https://fotos.test/2.jpg", "https://fotos.test/3.jpg"];
  const result = currentImageCorrection([...valid, "https://fotos.test/403.jpg"], valid, 3, 18);
  strictEqual(result.skip, false);
  strictEqual(result.cleanupOnly, true);
  deepStrictEqual(result.valid, valid);
});
test("somente três fotos verificadas e sem inválidas permitem pular", () => {
  const valid = ["https://fotos.test/1.jpg", "https://fotos.test/2.jpg", "https://fotos.test/3.jpg"];
  strictEqual(currentImageCorrection(valid, valid, 3, 18).skip, true);
});
test("preserva fotos válidas ao completar com fornecedor sem duplicar", () => {
  deepStrictEqual(mergeVerifiedImages(["https://fotos.test/1.jpg"], ["https://fotos.test/1.jpg", "https://fotos.test/2.jpg", "https://fotos.test/3.jpg"], 18), ["https://fotos.test/1.jpg", "https://fotos.test/2.jpg", "https://fotos.test/3.jpg"]);
});

test("três imagens do fornecedor resolvem sem consultar o Mercado Livre", async () => {
  const fotos = pickSupplierImageUrls("https://fornecedor.test/1.jpg|https://fornecedor.test/2.png|https://fornecedor.test/3.jpg", 18);
  let calls = 0;
  const result = await supplierFirstImages(fotos, 3, async () => { calls++; return []; });
  strictEqual(result.source, "fornecedor");
  strictEqual(result.imagens?.length, 3);
  strictEqual(calls, 0);
});

test("menos de três imagens do fornecedor recorre ao Mercado Livre", async () => {
  let calls = 0;
  const result = await supplierFirstImages(["https://fornecedor.test/1.jpg", "https://fornecedor.test/2.jpg"], 3, async () => { calls++; return ["ml"]; });
  strictEqual(result.source, "mercado_livre");
  strictEqual(calls, 1);
  deepStrictEqual(result.result, ["ml"]);
});

test("fornecedor sem fotos também recorre ao Mercado Livre", async () => {
  let calls = 0;
  await supplierFirstImages([], 3, async () => { calls++; return null; });
  strictEqual(calls, 1);
});

test("descarta não JPG/PNG, repetidas e respeita o máximo", () => {
  const pics = [
    { secure_url: "https://http2.mlstatic.com/a.jpg" },
    { secure_url: "https://http2.mlstatic.com/a.jpg" },
    { secure_url: "https://http2.mlstatic.com/b.webp" },
    { url: "http://http2.mlstatic.com/c.png" },
    { secure_url: "https://http2.mlstatic.com/d.jpg" },
  ];
  deepStrictEqual(pickMlImageUrls(pics, 2), ["https://http2.mlstatic.com/a.jpg", "https://http2.mlstatic.com/c.png"]);
});
test("dez fotos válidas e uma inválida: erro corrigido só removendo a ruim", () => {
  const valid = Array.from({ length: 10 }, (_, i) => `https://fotos.test/${i}.jpg`);
  const result = currentImageCorrection([...valid, "https://fotos.test/ruim.jpg"], valid, 3, 18);
  strictEqual(result.skip, false);
  strictEqual(result.cleanupOnly, true);
  deepStrictEqual(result.valid, valid);
  deepStrictEqual(result.invalid, ["https://fotos.test/ruim.jpg"]);
});
