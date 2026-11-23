import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadSupplierPrefixMap, parseSkuPrefix } from "@/lib/supplier-prefix-map";
import { cdnImageUrlsForIntegration } from "@/lib/r2-images.server";
import { activateLegacyCdnSignature, deactivateLegacyCdnSignature } from "@/lib/cdn-worker.server";

const db = supabaseAdmin as any;
const IMAGE_FILE = /^(.*?)(?:_(\d+))?\.(jpg|jpeg|png|webp|avif)$/i;
const LEASE_MS = 90_000;

function checked<T extends { error?: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(result.error.message);
  return result;
}

export function normalizeImageToken(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function normalizeSupplierAlias(value: unknown) {
  return normalizeImageToken(value).replace(/(LTDA|LIMITADA|EIRELI|ME|EPP|SA)+$/g, "");
}

function workerConfig() {
  const rawBase = (process.env.CDN_BASE_URL ?? "").trim().replace(/\/$/, "");
  const base = rawBase && !/^https?:\/\//i.test(rawBase) ? `https://${rawBase}` : rawBase;
  const token = (process.env.CLOUDFLARE_WORKER_ADMIN_TOKEN ?? "").trim();
  const bucket = (
    process.env.R2_BUCKET_NAME ??
    process.env.CLOUDFLARE_R2_BUCKET ??
    "ajustae"
  ).trim();
  if (!base || token.length < 24)
    throw new Error("Configure CDN_BASE_URL e CLOUDFLARE_WORKER_ADMIN_TOKEN no servidor.");
  try {
    new URL(base);
  } catch {
    throw new Error("CDN_BASE_URL inválido. Use, por exemplo, https://cdn.agenciasimplifya.com.br");
  }
  return { base, token, bucket };
}

async function workerRequest(path: string, init: RequestInit = {}) {
  const config = workerConfig();
  const response = await fetch(`${config.base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      `Worker CDN respondeu HTTP ${response.status}: ${body.error ?? "erro desconhecido"}.`,
    );
  return body as any;
}

export async function activateCdnSignature(signature: string) {
  await activateLegacyCdnSignature(signature);
}

export async function deactivateCdnSignature(signature: string) {
  await deactivateLegacyCdnSignature(signature);
}

function assetFromObject(object: any, syncId: string) {
  const fileName =
    String(object.key ?? "")
      .split("/")
      .pop() ?? "";
  const normalizedName = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
  const match = IMAGE_FILE.exec(normalizedName);
  if (!match) return null;
  const baseKey = normalizeImageToken(match[1]);
  if (!baseKey) return null;
  return {
    r2_key: String(object.key),
    file_name: fileName,
    normalized_name: normalizedName,
    base_key: baseKey,
    variant_index: Number(match[2] ?? 0),
    extension: match[3].toLowerCase(),
    size_bytes: object.size ?? null,
    etag: object.etag ?? null,
    uploaded_at: object.uploaded ?? null,
    active: true,
    last_seen_sync: syncId,
    updated_at: new Date().toISOString(),
  };
}

export async function enqueueCdnImageTick(jobId: string) {
  const base = (process.env.APP_PUBLIC_URL ?? "").replace(/\/$/, "");
  const secret = (process.env.BLING_WORKER_SECRET ?? "").trim();
  if (!base || !secret)
    throw new Error("Configure APP_PUBLIC_URL e BLING_WORKER_SECRET para executar a propagação.");
  checked(
    await db.rpc("enqueue_http_job", {
      _url: `${base}/api/public/cdn-images/tick`,
      _secret: secret,
      _body: { job_id: jobId },
    }),
  );
}

async function keepRunning(jobId: string, token: string) {
  const { data } = checked(
    await db.from("cdn_image_jobs_v2").select("status,lease_token").eq("id", jobId).single(),
  );
  return (
    ["inventario", "preparando", "processando"].includes(data.status) && data.lease_token === token
  );
}

async function integrationVersions(items: any[]) {
  type IntegrationRow = {
    id: string;
    company_id: string;
    status: string;
    cdn_signature: string | null;
    cdn_signature_active: boolean | null;
    cdn_key_version_id: string | null;
  };
  const companyIds = Array.from(new Set(items.map((item) => item.company_id)));
  const integrations = (checked(
    await db
      .from("bling_integrations")
      .select("id,company_id,status,cdn_signature,cdn_signature_active,cdn_key_version_id")
      .in("company_id", companyIds)
      .eq("status", "conectada"),
  ).data ?? []) as IntegrationRow[];
  const byId = new Map<string, IntegrationRow>(integrations.map((row) => [row.id, row]));
  const byCompany = new Map<string, IntegrationRow[]>();
  for (const row of integrations)
    byCompany.set(row.company_id, [...(byCompany.get(row.company_id) ?? []), row]);
  const versionIds = integrations.map((row) => row.cdn_key_version_id).filter(Boolean) as string[];
  const versions = versionIds.length
    ? (checked(
        await db.from("cdn_key_versions").select("id,public_id,format,status").in("id", versionIds),
      ).data ?? [])
    : [];
  const versionById = new Map(versions.map((version: any) => [version.id, version]));
  const resolved = new Map<string, IntegrationRow & { key_version: any | null }>();
  for (const item of items) {
    let integration = item.integration_id ? byId.get(item.integration_id) : undefined;
    if (integration && integration.company_id !== item.company_id) integration = undefined;
    if (!integration) {
      const candidates = byCompany.get(item.company_id) ?? [];
      if (candidates.length === 1) integration = candidates[0];
    }
    if (!integration) continue;
    resolved.set(item.id, {
      ...integration,
      key_version: integration.cdn_key_version_id
        ? (versionById.get(integration.cdn_key_version_id) ?? null)
        : null,
    });
  }
  return resolved;
}

async function candidateContext(items: any[]) {
  const prefixMap = await loadSupplierPrefixMap(db);
  const prefixesBySupplier = new Map<string, string[]>();
  for (const [prefix, supplier] of Object.entries(prefixMap)) {
    const key = supplier.trim().toLowerCase();
    prefixesBySupplier.set(key, [...(prefixesBySupplier.get(key) ?? []), prefix.toUpperCase()]);
  }
  const companyIds = Array.from(new Set(items.map((item) => item.company_id)));
  const suppliers =
    checked(
      await db.from("fornecedores").select("company_id,codigo,nome").in("company_id", companyIds),
    ).data ?? [];
  const supplierAliases = new Map<string, string>();
  for (const row of suppliers) {
    supplierAliases.set(
      `${row.company_id}:${normalizeSupplierAlias(row.codigo)}`,
      String(row.codigo).toLowerCase(),
    );
    supplierAliases.set(
      `${row.company_id}:${normalizeSupplierAlias(row.nome)}`,
      String(row.codigo).toLowerCase(),
    );
  }
  return { prefixMap, prefixesBySupplier, supplierAliases };
}

function candidatesFor(item: any, context: Awaited<ReturnType<typeof candidateContext>>) {
  const result = new Set<string>();
  const sku = normalizeImageToken(item.codigo);
  const supplierSku = normalizeImageToken(item.cod_fornecedor);
  if (sku) result.add(sku);
  if (supplierSku && /^[A-Z]+/.test(supplierSku)) result.add(supplierSku);
  const parsed = parseSkuPrefix(String(item.codigo ?? ""));
  let supplierCode = parsed ? context.prefixMap[parsed.prefix] : undefined;
  if (!supplierCode) {
    for (const raw of [item.fornecedor, item.descricao_fornecedor]) {
      const alias = context.supplierAliases.get(
        `${item.company_id}:${normalizeSupplierAlias(raw)}`,
      );
      if (alias) {
        supplierCode = alias;
        break;
      }
    }
  }
  const suffix = normalizeImageToken(parsed?.numeric || item.cod_fornecedor);
  if (supplierCode && suffix)
    for (const prefix of context.prefixesBySupplier.get(supplierCode.toLowerCase()) ?? [])
      result.add(`${normalizeImageToken(prefix)}${suffix}`);
  return Array.from(result).filter(Boolean);
}

async function processItems(job: any, token: string) {
  checked(
    await db
      .from("cdn_image_job_items_v2")
      .update({ status: "pendente", updated_at: new Date().toISOString() })
      .eq("job_id", job.id)
      .eq("status", "processando")
      .lt("updated_at", new Date(Date.now() - LEASE_MS * 2).toISOString()),
  );
  const items =
    checked(await db.rpc("claim_cdn_image_items_v2", { _job_id: job.id, _limit: 100 })).data ?? [];
  if (!items.length)
    return checked(await db.rpc("refresh_cdn_image_job_v2", { _job_id: job.id })).data;
  const context = await candidateContext(items);
  const integrations = await integrationVersions(items);
  const candidates = new Map<string, string[]>();
  const allBases = new Set<string>();
  for (const item of items) {
    const values = candidatesFor(item, context);
    candidates.set(item.id, values);
    values.forEach((x) => allBases.add(x));
  }
  const assets: any[] = [];
  const baseList = Array.from(allBases);
  for (let i = 0; i < baseList.length; i += 200) {
    assets.push(
      ...(checked(
        await db
          .from("cdn_image_assets")
          .select("r2_key,base_key,variant_index")
          .eq("active", true)
          .in("base_key", baseList.slice(i, i + 200)),
      ).data ?? []),
    );
  }
  const assetsByBase = new Map<string, any[]>();
  for (const asset of assets)
    assetsByBase.set(asset.base_key, [...(assetsByBase.get(asset.base_key) ?? []), asset]);
  let handled = 0;
  for (const item of items) {
    if (!(await keepRunning(job.id, token))) return { done: true, stopped: true };
    const bases = candidates.get(item.id) ?? [];
    const matched = Array.from(
      new Map(
        bases.flatMap((base) => assetsByBase.get(base) ?? []).map((a) => [a.r2_key, a]),
      ).values(),
    ).sort((a, b) => a.variant_index - b.variant_index || a.r2_key.localeCompare(b.r2_key));
    const integration = integrations.get(item.id);
    let patch: any;
    try {
      if (!integration)
        patch = {
          status: "sem_integracao",
          reason: "Produto sem integração Bling conectada e inequívoca.",
        };
      else if (!matched.length)
        patch = {
          status: "sem_imagem",
          reason: "Nenhuma imagem do inventário corresponde aos códigos candidatos.",
        };
      else {
        const urls = await cdnImageUrlsForIntegration(
          matched.map((x) => x.r2_key),
          integration,
        );
        const product = checked(
          await db
            .from("bling_products")
            .select("url_imagens_externas,imagem_principal_url")
            .eq("id", item.product_id)
            .single(),
        ).data;
        const current = String(product.url_imagens_externas ?? "")
          .split(/[|\n\r]+/)
          .map((x) => x.trim())
          .filter(Boolean);
        if (
          current.length &&
          current.length === urls.length &&
          current.every((url, index) => url === urls[index])
        ) {
          patch = {
            status: "ja_cdn",
            reason: "As URLs atuais já usam a versão CDN vigente; nenhuma substituição foi feita.",
            image_urls: current.join("|"),
          };
        } else {
          checked(
            await db
              .from("bling_products")
              .update({ url_imagens_externas: urls.join("|"), imagem_principal_url: urls[0] })
              .eq("id", item.product_id)
              .eq("company_id", item.company_id),
          );
          patch = {
            status: "atualizado",
            reason: "URLs substituídas pelas imagens correspondentes do R2.",
            image_urls: urls.join("|"),
          };
        }
        patch.image_keys = matched.map((x) => x.r2_key);
      }
    } catch (error) {
      patch = {
        status: "erro",
        reason: "Falha ao atualizar o produto.",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    checked(
      await db
        .from("cdn_image_job_items_v2")
        .update({
          ...patch,
          candidate_bases: bases,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id)
        .eq("status", "processando"),
    );
    handled++;
    if (handled % 10 === 0)
      checked(
        await db
          .from("cdn_image_jobs_v2")
          .update({
            lease_until: new Date(Date.now() + LEASE_MS).toISOString(),
            heartbeat_at: new Date().toISOString(),
          })
          .eq("id", job.id)
          .eq("lease_token", token),
      );
  }
  return checked(await db.rpc("refresh_cdn_image_job_v2", { _job_id: job.id })).data;
}

export async function processCdnImageTick(requestedJobId?: string) {
  const now = new Date();
  const token = crypto.randomUUID();
  let query = db
    .from("cdn_image_jobs_v2")
    .select("*")
    .in("status", ["inventario", "preparando", "processando"])
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .order("started_at")
    .limit(1);
  if (requestedJobId) query = query.eq("id", requestedJobId);
  else query = query.lte("next_tick_at", now.toISOString());
  const candidate = checked(await query.maybeSingle()).data;
  if (!candidate) return { done: true };
  let claim = db
    .from("cdn_image_jobs_v2")
    .update({
      lease_token: token,
      lease_until: new Date(Date.now() + LEASE_MS).toISOString(),
      heartbeat_at: now.toISOString(),
    })
    .eq("id", candidate.id)
    .in("status", ["inventario", "preparando", "processando"])
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`);
  if (!requestedJobId) claim = claim.lte("next_tick_at", now.toISOString());
  const job = checked(await claim.select("*").maybeSingle()).data;
  if (!job) return { done: false, busy: true };
  let result: any = { done: true };
  let shouldContinue = false;
  try {
    if (job.status === "inventario") {
      const params = new URLSearchParams();
      if (job.inventory_cursor) params.set("cursor", job.inventory_cursor);
      const page = await workerRequest(`/__admin/inventory?${params}`);
      const rows = (page.objects ?? [])
        .map((object: any) => assetFromObject(object, job.inventory_sync_id))
        .filter(Boolean);
      if (rows.length)
        checked(await db.from("cdn_image_assets").upsert(rows, { onConflict: "r2_key" }));
      if (page.truncated && page.cursor) {
        checked(
          await db
            .from("cdn_image_jobs_v2")
            .update({
              inventory_cursor: page.cursor,
              inventory_scanned: Number(job.inventory_scanned ?? 0) + rows.length,
              next_tick_at: new Date().toISOString(),
            })
            .eq("id", job.id)
            .eq("lease_token", token),
        );
        result = { done: false, phase: "inventario" };
      } else {
        checked(
          await db
            .from("cdn_image_assets")
            .update({ active: false, updated_at: new Date().toISOString() })
            .neq("last_seen_sync", job.inventory_sync_id),
        );
        checked(
          await db
            .from("cdn_image_jobs_v2")
            .update({
              status: "preparando",
              inventory_cursor: null,
              inventory_scanned: Number(job.inventory_scanned ?? 0) + rows.length,
              next_tick_at: new Date().toISOString(),
            })
            .eq("id", job.id)
            .eq("lease_token", token),
        );
        result = { done: false, phase: "preparando" };
      }
    } else if (job.status === "preparando") {
      const total = checked(await db.rpc("prepare_cdn_image_job_v2", { _job_id: job.id })).data;
      result = { done: Number(total) === 0, phase: "processando", total };
    } else result = await processItems(job, token);
    const current = checked(
      await db.from("cdn_image_jobs_v2").select("status").eq("id", job.id).single(),
    ).data;
    if (["inventario", "preparando", "processando"].includes(current.status)) {
      checked(
        await db
          .from("cdn_image_jobs_v2")
          .update({ next_tick_at: new Date(Date.now() + 1000).toISOString() })
          .eq("id", job.id)
          .eq("lease_token", token),
      );
      shouldContinue = true;
    }
  } catch (error) {
    checked(
      await db
        .from("cdn_image_jobs_v2")
        .update({
          status: "erro",
          last_error: error instanceof Error ? error.message : String(error),
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("lease_token", token),
    );
    result = { done: true, error: error instanceof Error ? error.message : String(error) };
  } finally {
    checked(
      await db
        .from("cdn_image_jobs_v2")
        .update({ lease_token: null, lease_until: null })
        .eq("id", job.id)
        .eq("lease_token", token),
    );
  }
  if (shouldContinue) {
    try {
      await enqueueCdnImageTick(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checked(
        await db
          .from("cdn_image_jobs_v2")
          .update({ status: "erro", last_error: message, finished_at: new Date().toISOString() })
          .eq("id", job.id)
          .in("status", ["inventario", "preparando", "processando"]),
      );
      return { done: true, error: message };
    }
  }
  return result;
}
