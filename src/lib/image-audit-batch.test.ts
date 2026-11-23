import { test } from "node:test";
import { strictEqual, deepStrictEqual } from "node:assert";
import { completedImageProducts, pendingImageUrls, IMAGE_AUDIT_PRODUCT_BATCH, imageCacheKeyBatches, IMAGE_CACHE_FILTER_BUDGET } from "./image-audit-batch";
import { normalizeImageUrl } from "./placeholder-images";

test("cache de fotos divide filtros grandes sem perder links nem ultrapassar o limite", () => {
  const keys = Array.from({ length: 500 }, (_, id) => `photos.example.com/${id}/${'foto com espaços,'.repeat(12)}.jpg`);
  const batches = imageCacheKeyBatches([...keys, keys[0]]);
  deepStrictEqual(batches.flat(), keys);
  strictEqual(batches.length > 1, true);
  for (const batch of batches) {
    const size = batch.reduce((total, key) => total + encodeURIComponent(JSON.stringify(key)).length + 3, 0);
    strictEqual(size <= IMAGE_CACHE_FILTER_BUDGET, true);
  }
});
test("cache vazio não gera consulta", () => {
  deepStrictEqual(imageCacheKeyBatches([]), []);
});

test("30 mil produtos em cache avançam em 60 lotes de 500 sem downloads", () => {
  const products = Array.from({ length: 30_000 }, (_, id) => ({ id: String(id), url_imagens_externas: "https://photos.example.com/shared.jpg", imagem_principal_url: null }));
  const cached = new Set([normalizeImageUrl("https://photos.example.com/shared.jpg")]);
  let checked = 0, batches = 0;
  for (let i = 0; i < products.length; i += IMAGE_AUDIT_PRODUCT_BATCH) {
    const batch = products.slice(i, i + IMAGE_AUDIT_PRODUCT_BATCH);
    deepStrictEqual(pendingImageUrls(batch, cached), []);
    checked += completedImageProducts(batch, cached); batches++;
  }
  strictEqual(checked, 30_000); strictEqual(batches, 60);
});
test("links repetidos são baixados uma única vez por lote", () => {
  const product = { id: "1", url_imagens_externas: "https://photos.example.com/a.jpg|https://photos.example.com/a.jpg", imagem_principal_url: null };
  strictEqual(pendingImageUrls([product, { ...product, id: "2" }], new Set()).length, 1);
});
test("cursor nunca ultrapassa produto com foto pendente", () => {
  const products = ["a", "b", "c"].map((id) => ({ id, url_imagens_externas: `https://photos.example.com/${id}.jpg`, imagem_principal_url: null }));
  strictEqual(completedImageProducts(products, new Set([normalizeImageUrl(products[0].url_imagens_externas), normalizeImageUrl(products[2].url_imagens_externas)])), 1);
});
test("produto só termina depois de conferir todas as fotos, inclusive além de três", () => {
  const urls = Array.from({ length: 10 }, (_, i) => `https://photos.example.com/${i}.jpg`);
  const product = { id: "1", url_imagens_externas: urls.join("|"), imagem_principal_url: null };
  strictEqual(completedImageProducts([product], new Set(urls.slice(0, 3).map(normalizeImageUrl))), 0);
  strictEqual(completedImageProducts([product], new Set(urls.map(normalizeImageUrl))), 1);
});
test("cada foto pertence a exatamente um dos 6 trabalhadores paralelos", async () => {
  const { imageShard, IMAGE_AUDIT_SHARDS } = await import("./image-audit-batch");
  strictEqual(IMAGE_AUDIT_SHARDS, 6);
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 6000; i++) { const s = imageShard(`photos.example.com/${i}.jpg`); strictEqual(s >= 0 && s < 6, true); counts[s]++; }
  strictEqual(counts.every((c) => c > 700), true);
});

import { isTransientImageStatus, transientRetryDelayMs, needsFullDownload, imageTotalSize, isSupportedImageType } from "./image-audit-batch";
test("429 e 500 são temporários; 404 e 403 não", () => {
  strictEqual(isTransientImageStatus(429), true);
  strictEqual(isTransientImageStatus(500), true);
  strictEqual(isTransientImageStatus(404), false);
  strictEqual(isTransientImageStatus(403), false);
});
test("respeita Retry-After até 4s", () => {
  strictEqual(transientRetryDelayMs(0, "2"), 2000);
  strictEqual(transientRetryDelayMs(0, "30"), 4000);
  strictEqual(transientRetryDelayMs(1, null), 1600);
});
test("só baixa inteira a foto suspeita de ser imagem padrão", () => {
  const sig = { sizes: new Set([5120]), hosts: new Set(["oderco.com.br"]) };
  strictEqual(needsFullDownload(36280, "http2.mlstatic.com", sig), false);
  strictEqual(needsFullDownload(5120, "http2.mlstatic.com", sig), true);
  strictEqual(needsFullDownload(36280, "Oderco.com.br", sig), true);
  strictEqual(needsFullDownload(null, "http2.mlstatic.com", sig), true);
});
test("lê o tamanho total pelos cabeçalhos", () => {
  strictEqual(imageTotalSize(206, "bytes 0-0/36280", "1"), 36280);
  strictEqual(imageTotalSize(200, null, "132665"), 132665);
  strictEqual(imageTotalSize(206, null, "1"), null);
});
test("aceita só JPEG e PNG", () => {
  strictEqual(isSupportedImageType("image/jpeg"), true);
  strictEqual(isSupportedImageType("image/png"), true);
  strictEqual(isSupportedImageType("image/webp"), false);
  strictEqual(isSupportedImageType("text/html"), false);
});
