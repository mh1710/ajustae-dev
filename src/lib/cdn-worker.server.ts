type KeyStatus = "activate" | "grace" | "revoking" | "revoke";

type WorkerKeyVersion = {
  key_id: string;
  integration_id: string;
  status: "pending" | "active" | "grace" | "revoking" | "revoked";
  master_key_id: string;
  created_at: string;
  activated_at: string | null;
  retire_after: string | null;
  revoked_at: string | null;
};

function config() {
  const rawBase = (process.env.CDN_BASE_URL ?? "").trim().replace(/\/$/, "");
  const base = rawBase && !/^https?:\/\//i.test(rawBase) ? `https://${rawBase}` : rawBase;
  const token = (process.env.CLOUDFLARE_WORKER_ADMIN_TOKEN ?? "").trim();
  if (!base || token.length < 24) {
    throw new Error("Configure CDN_BASE_URL e CLOUDFLARE_WORKER_ADMIN_TOKEN no servidor.");
  }
  try {
    new URL(base);
  } catch {
    throw new Error("CDN_BASE_URL inválido.");
  }
  return { base, token };
}

async function workerRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { base, token } = config();
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(
      `Worker CDN respondeu HTTP ${response.status}: ${body.error ?? "erro desconhecido"}.`,
    );
  }
  return body as T;
}

export function cdnWorkerBaseUrl() {
  return config().base;
}

export function assertCdnPurgeConfigured() {
  const zoneId = (process.env.CLOUDFLARE_ZONE_ID ?? "").trim();
  const token = (process.env.CLOUDFLARE_CACHE_PURGE_TOKEN ?? "").trim();
  if (!zoneId || token.length < 24) {
    throw new Error(
      "Configure CLOUDFLARE_ZONE_ID e CLOUDFLARE_CACHE_PURGE_TOKEN com permissão Cache Purge.",
    );
  }
  return { zoneId, token };
}

export async function activateLegacyCdnSignature(signature: string) {
  await workerRequest("/__admin/signatures", {
    method: "POST",
    body: JSON.stringify({ signature }),
  });
}

export async function deactivateLegacyCdnSignature(signature: string) {
  await workerRequest(`/__admin/signatures/${encodeURIComponent(signature)}`, { method: "DELETE" });
}

export async function createCdnKeyVersion(integrationId: string, keyId?: string) {
  const result = await workerRequest<{ version: WorkerKeyVersion }>("/__admin/key-versions", {
    method: "POST",
    body: JSON.stringify({ integration_id: integrationId, ...(keyId ? { key_id: keyId } : {}) }),
  });
  return result.version;
}

export async function setCdnKeyVersionStatus(keyId: string, status: KeyStatus) {
  const result = await workerRequest<{ version: WorkerKeyVersion }>(
    `/__admin/key-versions/${encodeURIComponent(keyId)}/${status}`,
    { method: "POST" },
  );
  return result.version;
}

export async function getCdnKeyVersion(keyId: string) {
  const result = await workerRequest<{ version: WorkerKeyVersion }>(
    `/__admin/key-versions/${encodeURIComponent(keyId)}`,
  );
  return result.version;
}

export async function signCdnObjectUrls(
  integrationId: string,
  keyId: string,
  objectKeys: string[],
) {
  const unique = [...new Set(objectKeys)];
  const output = new Map<string, string>();
  for (let offset = 0; offset < unique.length; offset += 100) {
    const result = await workerRequest<{ urls: Array<{ key: string; url: string }> }>(
      "/__admin/sign",
      {
        method: "POST",
        body: JSON.stringify({
          integration_id: integrationId,
          key_id: keyId,
          object_keys: unique.slice(offset, offset + 100),
        }),
      },
    );
    for (const item of result.urls ?? []) output.set(item.key, item.url);
  }
  if (output.size !== unique.length)
    throw new Error("O Worker não assinou todos os objetos solicitados.");
  return output;
}

export function buildLegacyCdnUrls(keys: string[], signature: string) {
  const base = config().base;
  const bucket = (
    process.env.R2_BUCKET_NAME ??
    process.env.CLOUDFLARE_R2_BUCKET ??
    "ajustae"
  ).trim();
  return keys.map(
    (key) =>
      `${base}/${signature}/${encodeURIComponent(bucket)}/${key
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
  );
}

export async function purgeCdnPublicId(publicId: string, format: "v1" | "v2") {
  const { zoneId, token } = assertCdnPurgeConfigured();
  const base = new URL(config().base);
  const root = base.pathname.replace(/\/$/, "");
  const path = format === "v2" ? `${root}/v2/${publicId}/` : `${root}/${publicId}/`;
  const prefix = `${base.host}${path}`;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/purge_cache`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ prefixes: [prefix] }),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    result?: { id?: string };
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok || !body.success) {
    const message = body.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `Cloudflare purge falhou (HTTP ${response.status}): ${message || "erro desconhecido"}.`,
    );
  }
  return { requestId: body.result?.id ?? null, prefix };
}

export async function probeCdnUrl(url: string) {
  const response = await fetch(url, {
    method: "HEAD",
    redirect: "manual",
    headers: { "cache-control": "no-cache" },
  });
  return {
    status: response.status,
    cacheStatus: response.headers.get("cf-cache-status"),
    ok: response.ok,
  };
}
