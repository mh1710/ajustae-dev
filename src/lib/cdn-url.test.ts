import { describe, expect, it } from "vitest";
import { decodeCdnObjectKey, encodeCdnObjectKey, parseCdnUrl } from "./cdn-url";

const base = "https://cdn.example.com";
const keyId = "AbCdEfGhIjKlMnOpQrStUv";
const signature = "A".repeat(43);

describe("canonicalização de URL CDN v2", () => {
  it.each([
    "catalogo/CAS145145_1.jpg",
    "acentos/ação.png",
    "formas/NFC-é.jpg",
    "formas/NFD-e\u0301.jpg",
    "pontos/../são-parte-da-chave.webp",
  ])("preserva os bytes UTF-8 de %s", (key) => {
    const encoded = encodeCdnObjectKey(key);
    expect(decodeCdnObjectKey(encoded)).toBe(key);
    expect(parseCdnUrl(`${base}/v2/${keyId}/${signature}/${encoded}`, base)).toEqual({
      version: "v2",
      publicId: keyId,
      objectSignature: signature,
      objectKey: key,
    });
  });

  it.each(["abc=", "abc%2Fdef", "abc+def", "abc/def", "a", "***"])(
    "rejeita Base64URL ambíguo ou inválido: %s",
    (encoded) => expect(() => decodeCdnObjectKey(encoded)).toThrow(),
  );

  it("rejeita query strings e segmentos extras", () => {
    const encoded = encodeCdnObjectKey("foto.jpg");
    expect(parseCdnUrl(`${base}/v2/${keyId}/${signature}/${encoded}?x=1`, base)).toBeNull();
    expect(parseCdnUrl(`${base}/v2/${keyId}/${signature}/${encoded}/extra`, base)).toBeNull();
  });

  it("não normaliza NFC e NFD", () => {
    expect(encodeCdnObjectKey("é.jpg")).not.toBe(encodeCdnObjectKey("e\u0301.jpg"));
  });

  it("continua interpretando URL v1 durante a migração", () => {
    const legacy = "cdn_0123456789abcdef0123456789abcdef";
    expect(parseCdnUrl(`${base}/${legacy}/ajustae/pasta/foto%201.jpg`, base)).toEqual({
      version: "v1",
      publicId: legacy,
      objectKey: "pasta/foto 1.jpg",
    });
  });
});
