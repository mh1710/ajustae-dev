import assert from "node:assert/strict";
import worker, { decodeObjectKey, encodeObjectKey } from "../cloudflare/image-worker.js";

const adminToken = "admin-token-with-at-least-24-characters";
const integrationId = "123e4567-e89b-42d3-a456-426614174000";
const keyId = "AbCdEfGhIjKlMnOpQrStUv";
const objectKey = "catálogo/NFC-é_1.jpg";
const objects = new Map([[objectKey, new Uint8Array([1, 2, 3, 4])]]);
const kv = new Map();

const env = {
  ADMIN_API_TOKEN: adminToken,
  CDN_SIGNING_MASTER_CURRENT: "master-secret-with-more-than-thirty-two-characters",
  CDN_SIGNING_MASTER_CURRENT_ID: "master-v1",
  R2_BUCKET_NAME: "ajustae",
  ASSINATURAS: {
    get: async (key) => kv.get(key) ?? null,
    put: async (key, value) => kv.set(key, value),
    delete: async (key) => kv.delete(key),
  },
  IMAGENS: {
    head: async (key) =>
      objects.has(key)
        ? {
            etag: "etag",
            httpEtag: '"etag"',
            writeHttpMetadata() {},
          }
        : null,
    get: async (key) =>
      objects.has(key)
        ? {
            etag: "etag",
            httpEtag: '"etag"',
            body: objects.get(key),
            writeHttpMetadata(headers) {
              headers.set("content-type", "image/jpeg");
            },
          }
        : null,
  },
};

function admin(path, init = {}) {
  return worker.fetch(
    new Request(`https://cdn.example.com${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${adminToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    }),
    env,
  );
}

const encoded = encodeObjectKey(objectKey);
assert.equal(decodeObjectKey(encoded).key, objectKey);
assert.notEqual(encodeObjectKey("é.jpg"), encodeObjectKey("e\u0301.jpg"));
for (const invalid of ["abc=", "abc%2Fdef", "abc+def", "abc/def", "a", "***"]) {
  assert.throws(() => decodeObjectKey(invalid));
}

let response = await admin("/__admin/key-versions", {
  method: "POST",
  body: JSON.stringify({ integration_id: integrationId, key_id: keyId }),
});
assert.equal(response.status, 201);

response = await admin(`/__admin/key-versions/${keyId}/activate`, { method: "POST" });
assert.equal(response.status, 200);

response = await admin("/__admin/sign", {
  method: "POST",
  body: JSON.stringify({ integration_id: integrationId, key_id: keyId, object_keys: [objectKey] }),
});
assert.equal(response.status, 200);
const signed = await response.json();
const signedUrl = signed.urls[0].url;

response = await worker.fetch(new Request(signedUrl), env);
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-tag"), `cdn-key-${keyId}`);

const tamperedUrl = signedUrl.replace(encoded, encodeObjectKey("outro.jpg"));
response = await worker.fetch(new Request(tamperedUrl), env);
assert.equal(response.status, 403);

response = await worker.fetch(new Request(`${signedUrl}?variant=1`), env);
assert.equal(response.status, 400);

response = await admin(`/__admin/key-versions/${keyId}/revoking`, { method: "POST" });
assert.equal(response.status, 200);
response = await worker.fetch(new Request(signedUrl), env);
assert.equal(response.status, 403);

console.log("OK: canonicalização, assinatura por objeto e revogação v2 validadas.");
