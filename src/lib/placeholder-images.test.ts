import { test } from "node:test";
import { strictEqual } from "node:assert";
import { isPlaceholderImage } from "./placeholder-images";
import { imagemPlaceholderRule } from "./validation-rules/modules/imagem-placeholder";
import { normalizeImageUrl } from "./placeholder-images";

test("identifica a imagem confirmada do O338274 mesmo com parâmetros", () => {
  strictEqual(isPlaceholderImage("https://oderco.com.br/media/catalog/product/4/-/4-17691023004367003.jpeg?width=262"), true);
});
test("não marca toda imagem da Oderço como inválida", () => {
  strictEqual(isPlaceholderImage("https://oderco.com.br/media/catalog/product/4/-/outra-foto.jpeg"), false);
  strictEqual(isPlaceholderImage("https://outra-loja.test/media/catalog/product/4/-/4-17691023004367003.jpeg"), false);
});
test("quatro links não escondem o erro de uma imagem padrão", async () => {
  const result = await imagemPlaceholderRule.evaluate({ url_imagens_externas: "https://fotos.test/1.jpg|https://fotos.test/2.jpg|https://fotos.test/3.jpg|https://oderco.com.br/media/catalog/product/4/-/4-17691023004367003.jpeg" } as any, {});
  strictEqual(result.status, "error");
});
test("foto inacessível gera erro sem ser classificada como imagem padrão", async () => {
  const url = "https://fotos.test/403.jpg";
  const result = await imagemPlaceholderRule.evaluate({ url_imagens_externas: url } as any, {}, new Map([[normalizeImageUrl(url), { status: "unknown", reason: "Imagem indisponível (403)." }]]));
  strictEqual(result.status, "error");
  strictEqual((result.details?.failures as any[])[0].status, "unknown");
});
test("formato não suportado gera erro de auditoria", async () => {
  const url = "https://fotos.test/foto.webp";
  const result = await imagemPlaceholderRule.evaluate({ url_imagens_externas: url } as any, {}, new Map([[normalizeImageUrl(url), { status: "unknown", reason: "Formato não verificado: é necessário JPEG ou PNG." }]]));
  strictEqual(result.status, "error");
});
test("foto verificada como válida não gera erro", async () => {
  const url = "https://fotos.test/real.jpg";
  const result = await imagemPlaceholderRule.evaluate({ url_imagens_externas: url } as any, {}, new Map([[normalizeImageUrl(url), { status: "valid", reason: null }]]));
  strictEqual(result.status, "pass");
});