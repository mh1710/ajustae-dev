const KEY_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{43}$/;
const LEGACY_SIGNATURE_RE = /^cdn_[a-f0-9]{32}$/i;
const MAX_OBJECT_KEY_BYTES = 1024;

function hasControlCharacters(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function encodeBytes(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("Base64URL inválido.");
  }
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Base64URL inválido.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBytes(bytes) !== value) throw new Error("Base64URL não canônico.");
  return bytes;
}

export function encodeCdnObjectKey(key: string) {
  if (!key || hasControlCharacters(key)) throw new Error("Chave R2 inválida.");
  const bytes = new TextEncoder().encode(key);
  if (bytes.length > MAX_OBJECT_KEY_BYTES) throw new Error("Chave R2 excede 1024 bytes.");
  return encodeBytes(bytes);
}

export function decodeCdnObjectKey(encoded: string) {
  const bytes = decodeBytes(encoded);
  if (!bytes.length || bytes.length > MAX_OBJECT_KEY_BYTES)
    throw new Error("Tamanho de chave R2 inválido.");
  let key: string;
  try {
    key = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Chave R2 não contém UTF-8 válido.");
  }
  if (!key || hasControlCharacters(key) || encodeCdnObjectKey(key) !== encoded) {
    throw new Error("Chave R2 não canônica.");
  }
  return key;
}

export type ParsedCdnUrl =
  | { version: "v1"; publicId: string; objectKey: string }
  | { version: "v2"; publicId: string; objectKey: string; objectSignature: string };

function sameCdn(url: URL, base: URL) {
  const basePath = base.pathname.replace(/\/$/, "");
  return url.origin === base.origin && (basePath === "" || url.pathname.startsWith(`${basePath}/`));
}

export function parseCdnUrl(
  rawUrl: string,
  rawBase: string,
  legacyBucket = "ajustae",
): ParsedCdnUrl | null {
  let url: URL;
  let base: URL;
  try {
    url = new URL(rawUrl);
    base = new URL(rawBase);
  } catch {
    return null;
  }
  if (!sameCdn(url, base) || url.search || url.hash) return null;
  const baseParts = base.pathname.split("/").filter(Boolean);
  const parts = url.pathname.split("/").filter(Boolean).slice(baseParts.length);
  if (parts[0] === "v2") {
    if (parts.length !== 4 || !KEY_ID_RE.test(parts[1]) || !SIGNATURE_RE.test(parts[2]))
      return null;
    try {
      return {
        version: "v2",
        publicId: parts[1],
        objectSignature: parts[2],
        objectKey: decodeCdnObjectKey(parts[3]),
      };
    } catch {
      return null;
    }
  }
  if (parts.length < 3 || !LEGACY_SIGNATURE_RE.test(parts[0])) return null;
  let bucket: string;
  let key: string;
  try {
    bucket = decodeURIComponent(parts[1]);
    key = parts.slice(2).map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
  if (bucket !== legacyBucket || !key) return null;
  return { version: "v1", publicId: parts[0], objectKey: key };
}

export function splitImageUrls(value: unknown) {
  return String(value ?? "")
    .split(/[|\n\r]+/)
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//i.test(url));
}

export function imageVersionMatches(
  url: string,
  base: string,
  publicId: string,
  legacyBucket = "ajustae",
) {
  return parseCdnUrl(url, base, legacyBucket)?.publicId === publicId;
}
