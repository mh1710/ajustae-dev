const KEY_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const OBJECT_SIGNATURE_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_OBJECT_KEY_BYTES = 1024;
const MAX_SIGN_OBJECTS = 100;
const V2_DOMAIN = new TextEncoder().encode("ajustae-cdn-url-v2");
const DERIVATION_DOMAIN = new TextEncoder().encode("ajustae-cdn-key-v2");

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

function constantTimeEqual(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function authorized(request, env) {
  const received = request.headers.get("authorization") || "";
  const tokens = [env.ADMIN_API_TOKEN, env.ADMIN_API_TOKEN_PREVIOUS]
    .map((value) => String(value || "").trim())
    .filter((value) => value.length >= 24);
  let accepted = 0;
  for (const token of tokens) accepted |= constantTimeEqual(received, `Bearer ${token}`) ? 1 : 0;
  return accepted === 1;
}

export function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecodeStrict(value, expectedLength) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("invalid_base64url");
  }
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("invalid_base64url");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (expectedLength !== undefined && bytes.length !== expectedLength)
    throw new Error("invalid_length");
  if (base64UrlEncode(bytes) !== value) throw new Error("non_canonical_base64url");
  return bytes;
}

export function encodeObjectKey(key) {
  if (typeof key !== "string" || !key || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new Error("invalid_object_key");
  }
  const bytes = new TextEncoder().encode(key);
  if (bytes.length > MAX_OBJECT_KEY_BYTES) throw new Error("object_key_too_long");
  return base64UrlEncode(bytes);
}

export function decodeObjectKey(value) {
  const bytes = base64UrlDecodeStrict(value);
  if (!bytes.length || bytes.length > MAX_OBJECT_KEY_BYTES)
    throw new Error("invalid_object_key_length");
  let key;
  try {
    key = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("invalid_object_key_utf8");
  }
  if (!key || /[\u0000-\u001f\u007f]/.test(key) || encodeObjectKey(key) !== value) {
    throw new Error("invalid_object_key");
  }
  return { key, bytes };
}

function uuidBytes(value) {
  if (!UUID_RE.test(value)) throw new Error("invalid_integration_id");
  const compact = value.replace(/-/g, "");
  return Uint8Array.from(compact.match(/../g), (pair) => Number.parseInt(pair, 16));
}

export function buildSigningMessage(keyId, integrationId, objectKeyBytes) {
  if (!KEY_ID_RE.test(keyId)) throw new Error("invalid_key_id");
  const keyIdBytes = new TextEncoder().encode(keyId);
  const integrationBytes = uuidBytes(integrationId);
  const output = new Uint8Array(
    2 +
      V2_DOMAIN.length +
      2 +
      keyIdBytes.length +
      integrationBytes.length +
      4 +
      objectKeyBytes.length,
  );
  const view = new DataView(output.buffer);
  let offset = 0;
  view.setUint16(offset, V2_DOMAIN.length, false);
  offset += 2;
  output.set(V2_DOMAIN, offset);
  offset += V2_DOMAIN.length;
  view.setUint16(offset, keyIdBytes.length, false);
  offset += 2;
  output.set(keyIdBytes, offset);
  offset += keyIdBytes.length;
  output.set(integrationBytes, offset);
  offset += integrationBytes.length;
  view.setUint32(offset, objectKeyBytes.length, false);
  offset += 4;
  output.set(objectKeyBytes, offset);
  return output;
}

function currentMasterId(env) {
  return String(env.CDN_SIGNING_MASTER_CURRENT_ID || "current-v1").trim();
}

function masterForVersion(env, masterId) {
  if (masterId === currentMasterId(env)) return String(env.CDN_SIGNING_MASTER_CURRENT || "");
  const previousId = String(env.CDN_SIGNING_MASTER_PREVIOUS_ID || "").trim();
  if (previousId && masterId === previousId) return String(env.CDN_SIGNING_MASTER_PREVIOUS || "");
  return "";
}

async function deriveSigningKey(env, metadata) {
  const master = masterForVersion(env, metadata.master_key_id);
  if (master.length < 32) throw new Error("signing_master_unavailable");
  const masterKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(master),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const integration = uuidBytes(metadata.integration_id);
  const keyId = new TextEncoder().encode(metadata.key_id);
  const derivationInput = new Uint8Array(
    DERIVATION_DOMAIN.length + integration.length + keyId.length,
  );
  derivationInput.set(DERIVATION_DOMAIN, 0);
  derivationInput.set(integration, DERIVATION_DOMAIN.length);
  derivationInput.set(keyId, DERIVATION_DOMAIN.length + integration.length);
  const derived = await crypto.subtle.sign("HMAC", masterKey, derivationInput);
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function signObject(env, metadata, objectKeyBytes) {
  const key = await deriveSigningKey(env, metadata);
  const message = buildSigningMessage(metadata.key_id, metadata.integration_id, objectKeyBytes);
  const signature = await crypto.subtle.sign("HMAC", key, message);
  return base64UrlEncode(new Uint8Array(signature));
}

async function verifyObject(env, metadata, objectKeyBytes, signatureText) {
  let signature;
  try {
    signature = base64UrlDecodeStrict(signatureText, 32);
  } catch {
    return false;
  }
  const key = await deriveSigningKey(env, metadata);
  const message = buildSigningMessage(metadata.key_id, metadata.integration_id, objectKeyBytes);
  return crypto.subtle.verify("HMAC", key, signature, message);
}

function generateKeyId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function loadKeyVersion(env, keyId) {
  const raw = await env.ASSINATURAS.get(`key-version:${keyId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.key_id === keyId ? parsed : null;
  } catch {
    return null;
  }
}

async function saveKeyVersion(env, metadata) {
  await env.ASSINATURAS.put(`key-version:${metadata.key_id}`, JSON.stringify(metadata));
}

async function readBody(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 128 * 1024) throw new Error("body_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 128 * 1024) throw new Error("body_too_large");
  return JSON.parse(text);
}

async function adminApi(request, env, url) {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);

  if (url.pathname === "/__admin/inventory" && request.method === "GET") {
    const cursor = url.searchParams.get("cursor") || undefined;
    const listed = await env.IMAGENS.list({
      cursor,
      limit: 1000,
      include: ["httpMetadata", "customMetadata"],
    });
    return json({
      objects: listed.objects.map((object) => ({
        key: object.key,
        size: object.size,
        etag: object.etag,
        uploaded: object.uploaded?.toISOString?.() || object.uploaded || null,
      })),
      truncated: listed.truncated,
      cursor: listed.truncated ? listed.cursor : null,
    });
  }

  if (url.pathname === "/__admin/signatures" && request.method === "POST") {
    const body = await readBody(request).catch(() => null);
    const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
    if (!/^cdn_[a-f0-9]{32}$/i.test(signature)) return json({ error: "invalid_signature" }, 400);
    await env.ASSINATURAS.put(`signature:${signature}`, "1");
    return json({ ok: true, signature }, 201);
  }

  const legacySignatureMatch = /^\/__admin\/signatures\/(cdn_[a-f0-9]{32})$/i.exec(url.pathname);
  if (legacySignatureMatch && request.method === "DELETE") {
    await env.ASSINATURAS.delete(`signature:${legacySignatureMatch[1]}`);
    return json({ ok: true });
  }

  if (url.pathname === "/__admin/key-versions" && request.method === "POST") {
    const body = await readBody(request).catch(() => null);
    const integrationId =
      typeof body?.integration_id === "string" ? body.integration_id.trim() : "";
    const requestedId = typeof body?.key_id === "string" ? body.key_id.trim() : "";
    const keyId = requestedId || generateKeyId();
    if (!UUID_RE.test(integrationId) || !KEY_ID_RE.test(keyId))
      return json({ error: "invalid_key_version" }, 400);
    const existing = await loadKeyVersion(env, keyId);
    if (existing) {
      if (existing.integration_id !== integrationId) return json({ error: "key_id_conflict" }, 409);
      return json({ ok: true, version: existing });
    }
    const metadata = {
      key_id: keyId,
      integration_id: integrationId,
      status: "pending",
      master_key_id: currentMasterId(env),
      created_at: new Date().toISOString(),
      activated_at: null,
      retire_after: null,
      revoked_at: null,
    };
    await saveKeyVersion(env, metadata);
    return json({ ok: true, version: metadata }, 201);
  }

  const versionMatch = /^\/__admin\/key-versions\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
  if (versionMatch && request.method === "GET") {
    const metadata = await loadKeyVersion(env, versionMatch[1]);
    return metadata ? json({ ok: true, version: metadata }) : json({ error: "not_found" }, 404);
  }

  const statusMatch =
    /^\/__admin\/key-versions\/([A-Za-z0-9_-]{22})\/(activate|grace|revoking|revoke)$/.exec(
      url.pathname,
    );
  if (statusMatch && request.method === "POST") {
    const metadata = await loadKeyVersion(env, statusMatch[1]);
    if (!metadata) return json({ error: "not_found" }, 404);
    const target = { activate: "active", grace: "grace", revoking: "revoking", revoke: "revoked" }[
      statusMatch[2]
    ];
    const allowed =
      {
        pending: ["active", "revoked"],
        active: ["grace", "revoking", "revoked"],
        grace: ["active", "revoking", "revoked"],
        revoking: ["grace", "revoked"],
        revoked: [],
      }[metadata.status] || [];
    if (metadata.status !== target && !allowed.includes(target)) {
      return json({ error: "invalid_transition", from: metadata.status, to: target }, 409);
    }
    metadata.status = target;
    if (target === "active" && !metadata.activated_at)
      metadata.activated_at = new Date().toISOString();
    if (target === "revoked") metadata.revoked_at = new Date().toISOString();
    await saveKeyVersion(env, metadata);
    return json({ ok: true, version: metadata });
  }

  if (url.pathname === "/__admin/sign" && request.method === "POST") {
    const body = await readBody(request).catch(() => null);
    const keyId = typeof body?.key_id === "string" ? body.key_id.trim() : "";
    const integrationId =
      typeof body?.integration_id === "string" ? body.integration_id.trim() : "";
    const objectKeys = Array.isArray(body?.object_keys) ? body.object_keys : [];
    if (!KEY_ID_RE.test(keyId) || !UUID_RE.test(integrationId))
      return json({ error: "invalid_sign_request" }, 400);
    if (!objectKeys.length || objectKeys.length > MAX_SIGN_OBJECTS)
      return json({ error: "invalid_object_count" }, 400);
    const metadata = await loadKeyVersion(env, keyId);
    if (!metadata || metadata.integration_id !== integrationId)
      return json({ error: "key_version_not_found" }, 404);
    if (!new Set(["pending", "active", "grace"]).has(metadata.status)) {
      return json({ error: "key_version_not_signable" }, 409);
    }
    const unique = [...new Set(objectKeys)];
    if (unique.length !== objectKeys.length || unique.some((key) => typeof key !== "string")) {
      return json({ error: "invalid_object_keys" }, 400);
    }
    let encoded;
    try {
      encoded = unique.map((key) => ({
        key,
        encoded: encodeObjectKey(key),
        bytes: new TextEncoder().encode(key),
      }));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid_object_key" }, 400);
    }
    const heads = await Promise.all(encoded.map(({ key }) => env.IMAGENS.head(key)));
    const missing = encoded.filter((_, index) => !heads[index]).map(({ key }) => key);
    if (missing.length) return json({ error: "objects_not_found", missing }, 404);
    const urls = [];
    for (const item of encoded) {
      const signature = await signObject(env, metadata, item.bytes);
      urls.push({
        key: item.key,
        url: `${url.origin}/v2/${keyId}/${signature}/${item.encoded}`,
      });
    }
    return json({ ok: true, key_id: keyId, urls });
  }

  return json({ error: "not_found" }, 404);
}

async function serveObject(request, env, key, cacheTag) {
  const object =
    request.method === "HEAD" ? await env.IMAGENS.head(key) : await env.IMAGENS.get(key);
  if (!object)
    return new Response("Imagem não encontrada", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag || object.etag);
  headers.set("cache-control", "public, max-age=3600, stale-while-revalidate=86400");
  headers.set("x-content-type-options", "nosniff");
  if (cacheTag) headers.set("Cache-Tag", cacheTag);
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

async function serveV2(request, env, url, parts) {
  if (url.search)
    return new Response("Query string não permitida", {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  if (parts.length !== 4) return new Response("Imagem não encontrada", { status: 404 });
  const [, keyId, signature, encodedKey] = parts;
  if (!KEY_ID_RE.test(keyId) || !OBJECT_SIGNATURE_RE.test(signature)) {
    return new Response("Imagem não encontrada", { status: 404 });
  }
  let decoded;
  try {
    decoded = decodeObjectKey(encodedKey);
  } catch {
    return new Response("Imagem não encontrada", { status: 404 });
  }
  const metadata = await loadKeyVersion(env, keyId);
  if (!metadata || !new Set(["active", "grace"]).has(metadata.status)) {
    return new Response("Chave inválida ou revogada", {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }
  let verified = false;
  try {
    verified = await verifyObject(env, metadata, decoded.bytes, signature);
  } catch {
    verified = false;
  }
  if (!verified)
    return new Response("Assinatura inválida", {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  return serveObject(request, env, decoded.key, `cdn-key-${keyId}`);
}

async function serveLegacy(request, env, parts) {
  if (parts.length < 3) return new Response("Formato: /assinatura/bucket/imagem", { status: 400 });
  const [signature, bucket, ...encodedKey] = parts;
  if (!/^cdn_[a-f0-9]{32}$/i.test(signature))
    return new Response("Imagem não encontrada", { status: 404 });
  if (bucket !== (env.R2_BUCKET_NAME || "ajustae"))
    return new Response("Imagem não encontrada", { status: 404 });
  const permission = await env.ASSINATURAS.get(`signature:${signature}`);
  if (!permission) {
    return new Response("Assinatura inválida ou revogada", {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }
  let key;
  try {
    key = encodedKey.map(decodeURIComponent).join("/");
  } catch {
    return new Response("Caminho inválido", { status: 400 });
  }
  return serveObject(request, env, key, `cdn-legacy-${signature}`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/__admin/")) return adminApi(request, env, url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[0] === "v2" ? serveV2(request, env, url, parts) : serveLegacy(request, env, parts);
  },
};
