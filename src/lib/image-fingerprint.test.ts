import { test } from "node:test";
import { strictEqual } from "node:assert";
import { encode } from "jpeg-js";
import { encode as pngEncode } from "fast-png";
import { imageLuminance, matchesPlaceholderPixels, isSafeImageTarget } from "./image-fingerprint";
import { PLACEHOLDER_LUMA } from "./placeholder-image-reference";
import { classifyImageBytes } from "./image-fingerprint.server";

function referencePixels(scale: number) {
  const size = 16 * scale, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const value = PLACEHOLDER_LUMA[Math.floor(y / scale) * 16 + Math.floor(x / scale)];
    const i = (y * size + x) * 4;
    data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
  }
  return { width: size, height: size, data };
}
test("reconhece a mesma imagem JPEG em outra resolução e compressão, sem usar URL", () => {
  strictEqual(classifyImageBytes(encode(referencePixels(4), 85).data), true);
});
test("reconhece a mesma imagem como PNG", () => {
  strictEqual(classifyImageBytes(pngEncode({ ...referencePixels(2), channels: 4 })), true);
});
test("fundo branco não é confundido com a imagem padrão", () => {
  strictEqual(matchesPlaceholderPixels(Array(256).fill(248)), false);
});
test("foto com desenho diferente não é a imagem padrão", () => {
  strictEqual(matchesPlaceholderPixels(Array.from({ length: 256 }, (_, i) => i % 2 ? 241 : 248)), false);
});
test("normalização visual independe da resolução", () => {
  strictEqual(matchesPlaceholderPixels(imageLuminance({ ...referencePixels(5), channels: 4 })), true);
});
test("URLs internas e credenciais não são destinos de leitura de foto", () => {
  strictEqual(isSafeImageTarget("https://127.0.0.1/foto.jpg"), false);
  strictEqual(isSafeImageTarget("https://localhost/foto.jpg"), false);
  strictEqual(isSafeImageTarget("https://user:pass@example.com/foto.jpg"), false);
  strictEqual(isSafeImageTarget("https://oderco.com.br/foto.jpg"), true);
});