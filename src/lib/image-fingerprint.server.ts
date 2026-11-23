import { decode as decodeJpeg } from "jpeg-js";
import { decode as decodePng } from "fast-png";
import { imageLuminance, matchesPlaceholderPixels, isSafeImageTarget } from "./image-fingerprint";
import { isPlaceholderImage, normalizeImageUrl } from "./placeholder-images";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { IMAGE_AUDIT_PRODUCT_BATCH, IMAGE_AUDIT_CONCURRENCY, IMAGE_AUDIT_SHARDS, imageShard, productImageUrls, pendingImageUrls, completedImageProducts, imageCacheKeyBatches, isTransientImageStatus, transientRetryDelayMs, needsFullDownload, imageTotalSize, isSupportedImageType } from "./image-audit-batch";
import type { ImageAuditProduct, PlaceholderSignatures } from "./image-audit-batch";

const db = supabaseAdmin as any;
const VERSION = 1;

export function classifyImageBytes(bytes: Uint8Array) {
  if (bytes[0] === 255 && bytes[1] === 216) {
    const image = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 12, maxMemoryUsageInMB: 64 });
    return matchesPlaceholderPixels(imageLuminance({ ...image, channels: 4 }));
  }
  if (bytes[0] === 137 && bytes[1] === 80) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 24 || view.getUint32(16) * view.getUint32(20) > 12_000_000) throw new Error("Imagem muito grande.");
    const image = decodePng(bytes);
    if (image.palette) throw new Error("PNG indexado não verificado.");
    return matchesPlaceholderPixels(imageLuminance(image));
  }
  throw new Error("Formato não verificado: é necessário JPEG ou PNG.");
}

let signatureCache: { at: number; sig: PlaceholderSignatures } | null = null;
/** Sizes/hosts where placeholder images were already seen; refreshed every minute. */
async function placeholderSignatures(): Promise<PlaceholderSignatures> {
  if (signatureCache && Date.now() - signatureCache.at < 60_000) return signatureCache.sig;
  const { data, error } = await db.rpc("audit_placeholder_signatures");
  if (error) throw new Error(error.message);
  const sig = { sizes: new Set<number>((data?.sizes ?? []).map(Number)), hosts: new Set<string>((data?.hosts ?? []).map((h: string) => h.toLowerCase())) };
  signatureCache = { at: Date.now(), sig };
  return sig;
}

/** Always checks the photo now (no reuse across audits). Unknown = audit error with reason. */
export async function inspectImage(url: string, _skipCacheRead = true): Promise<"placeholder" | "valid" | "unknown"> {
  if (isPlaceholderImage(url)) return "placeholder";
  const row = await checkImageUrl(url, await placeholderSignatures());
  const { error } = await db.from("image_audit_cache").upsert(row);
  if (error) throw new Error(error.message);
  return row.status;
}

async function fetchImage(url: string, range: boolean) {
  let response: Response | undefined;
  // Rate limit (429) or CDN outage (5xx/timeout): wait and retry before judging the photo.
  for (let attempt = 0; attempt < 3; attempt++) {
    let target = url;
    const signal = AbortSignal.timeout(6000);
    try {
      for (let redirects = 0; redirects <= 3; redirects++) {
        if (!isSafeImageTarget(target)) throw new Error("Destino de imagem não permitido.");
        // Supplier CDNs (Oderço, Evolusom via Cloudflare) answer 403 to requests without a browser User-Agent.
        const headers: Record<string, string> = {
          Accept: "image/jpeg,image/png;q=0.9",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        };
        if (range) headers.Range = "bytes=0-0";
        response = await fetch(target, { redirect: "manual", headers, signal });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) throw new Error("Redirecionamento sem destino.");
          target = new URL(location, target).href; continue;
        }
        break;
      }
    } catch (e) {
      if (e instanceof Error && (e.message.startsWith("Destino") || e.message.startsWith("Redirecionamento"))) throw e;
      response = undefined;
    }
    if (response?.ok || (response && !isTransientImageStatus(response.status))) break;
    if (attempt < 2) {
      await response?.body?.cancel().catch(() => {});
      await new Promise((r) => setTimeout(r, transientRetryDelayMs(attempt, response?.headers.get("retry-after") ?? null)));
    }
  }
  if (!response?.ok) {
    const transient = isTransientImageStatus(response?.status ?? 0);
    const msg = response ? `Imagem indisponível (${response.status}).` : "Imagem sem resposta (tempo esgotado).";
    throw new Error(transient ? `${msg} Falha temporária do servidor de imagens.` : msg);
  }
  return response;
}

async function readBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Imagem vazia.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    length += part.value.length;
    if (length > 5_000_000) { await reader.cancel(); throw new Error("Imagem acima de 5 MB."); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/**
 * Asks only for the first byte (headers give type and size). The full photo is
 * downloaded only when its size/host matches a known placeholder or is unknown.
 */
async function checkImageUrl(url: string, sig: PlaceholderSignatures) {
  const key = normalizeImageUrl(url);
  let status: "placeholder" | "valid" | "unknown" = "unknown";
  let reason: string | null = null;
  let size: number | null = null;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
    let response = await fetchImage(url, true);
    if (!isSupportedImageType(response.headers.get("content-type"))) {
      await response.body?.cancel().catch(() => {});
      throw new Error("Formato não suportado: é necessário JPEG ou PNG.");
    }
    size = imageTotalSize(response.status, response.headers.get("content-range"), response.headers.get("content-length"));
    if (size !== null && size > 5_000_000) { await response.body?.cancel().catch(() => {}); throw new Error("Imagem acima de 5 MB."); }
    if (!needsFullDownload(size, host, sig)) {
      await response.body?.cancel().catch(() => {});
      status = "valid";
    } else {
      if (response.status === 206) { await response.body?.cancel().catch(() => {}); response = await fetchImage(url, false); }
      const bytes = await readBody(response);
      size = bytes.length;
      status = classifyImageBytes(bytes) ? "placeholder" : "valid";
    }
  } catch (e) { reason = e instanceof Error ? e.message : "Imagem não verificada."; }
  return { url_key: key, status, reason, version: VERSION, checked_at: new Date().toISOString(), byte_size: size, host: host || null };
}

export async function withoutVisualPlaceholders(urls: string[]) {
  // Checks photos in parallel (bounded) and keeps the original order.
  const { mapLimited } = await import("@/lib/image-apply-batch");
  const checks = await mapLimited(urls, (url) => inspectImage(url));
  return urls.filter((_, i) => checks[i] === "valid");
}

/**
 * Cursor and leases persist in PostgreSQL; resumes every minute without a user.
 * Up to IMAGE_AUDIT_SHARDS invocations work on the same run at once, each on its own
 * hash shard of the pending photos; the cursor only advances past fully cached products.
 */
export async function scanImageAuditRun(runId: string, budgetMs = 25_000) {
  const holder = crypto.randomUUID();
  let shard = -1;
  for (let s = 0; s < IMAGE_AUDIT_SHARDS && shard < 0; s++) {
    const { data: acquired, error: leaseError } = await db.rpc("acquire_worker_lease", { _pool: `image-audit:${runId}`, _key: `image-audit:${runId}:${s}`, _holder: holder, _ttl_seconds: 90, _max_concurrent: IMAGE_AUDIT_SHARDS });
    if (leaseError) throw new Error(leaseError.message);
    if (acquired) shard = s;
  }
  if (shard < 0) return { done: false, checked: 0, busy: true };
  const deadline = Date.now() + budgetMs;
  const sig = await placeholderSignatures();
  try {
    let checked = 0;
    while (true) {
      const { data: run, error } = await db.from("audit_runs").select("*").eq("id", runId).single();
      if (error) throw new Error(error.message);
      checked = run.image_scan_checked ?? 0;
      if (run.status === "cancelada" || run.image_scan_done) return { done: true, checked };
      let lastSlice = true;
      let query = db.from("bling_products").select("id,url_imagens_externas,imagem_principal_url").eq("company_id", run.company_id).order("id").limit(IMAGE_AUDIT_PRODUCT_BATCH);
      if (run.product_ids?.length) {
        // Long ID lists overflow the request URL (400); take only the next slice after the cursor.
        const slice = [...run.product_ids].sort().filter((id: string) => !run.image_scan_cursor || id > run.image_scan_cursor).slice(0, 151);
        lastSlice = slice.length <= 150;
        slice.length = Math.min(slice.length, 150);
        if (!slice.length) slice.push("00000000-0000-0000-0000-000000000000");
        query = query.in("id", slice);
      } else if (run.image_scan_cursor) query = query.gt("id", run.image_scan_cursor);
      if (run.only_active) query = query.in("situacao", ["A", "Ativo", "ativo", "ATIVO"]);
      const { data: products, error: readError } = await query;
      if (readError) throw new Error(readError.message);
      const batch: ImageAuditProduct[] = products ?? [];
      const keys = [...new Set(batch.flatMap(productImageUrls).map(normalizeImageUrl))];
      const cached = new Set<string>();
      // Each audit checks its photos again: only results written during this run count.
      const freshAfter = run.started_at ?? run.created_at;
      const readCache = async (list: string[]) => {
        for (const keyBatch of imageCacheKeyBatches(list)) {
          const { data: rows, error: cacheError } = await db.from("image_audit_cache").select("url_key").in("url_key", keyBatch).eq("version", VERSION).gte("checked_at", freshAfter);
          if (cacheError) throw new Error(cacheError.message);
          for (const row of rows ?? []) cached.add(row.url_key);
        }
      };
      await readCache(keys);
      const mine = pendingImageUrls(batch, cached).filter((url) => imageShard(normalizeImageUrl(url)) === shard);
      // Pool of IMAGE_AUDIT_CONCURRENCY runners; no new download starts within 6s of the deadline.
      const rows: Awaited<ReturnType<typeof checkImageUrl>>[] = [];
      let next = 0;
      const flush = async () => {
        if (!rows.length) return;
        const chunk = rows.splice(0, rows.length);
        const { error: upsertError } = await db.from("image_audit_cache").upsert(chunk);
        if (upsertError) throw new Error(upsertError.message);
        for (const row of chunk) cached.add(row.url_key);
      };
      await Promise.all(Array.from({ length: IMAGE_AUDIT_CONCURRENCY }, async () => {
        while (next < mine.length && Date.now() < deadline - 6_000) {
          const url = mine[next++];
          rows.push(await checkImageUrl(url, sig));
          if (rows.length >= 60) await flush();
        }
      }));
      await flush();
      // Other shards may have finished their photos meanwhile.
      const stillPending = pendingImageUrls(batch, cached).map(normalizeImageUrl);
      if (stillPending.length) await readCache(stillPending);
      const complete = completedImageProducts(batch, cached);
      const done = lastSlice && batch.length < IMAGE_AUDIT_PRODUCT_BATCH && complete === batch.length;
      if (complete || done) {
        // Optimistic: only the worker that still sees the same cursor advances it.
        let update = db.from("audit_runs").update({ image_scan_cursor: complete ? batch[complete - 1].id : run.image_scan_cursor, image_scan_checked: checked + complete, image_scan_url_index: 0, image_scan_done: done }).eq("id", runId).neq("status", "cancelada");
        update = run.image_scan_cursor ? update.eq("image_scan_cursor", run.image_scan_cursor) : update.is("image_scan_cursor", null);
        const { error: saveError } = await update;
        if (saveError) throw new Error(saveError.message);
        checked += complete;
        if (done) return { done, checked };
      }
      if (Date.now() >= deadline - 6_000) return { done: false, checked };
      // Nothing left for this shard while others still download: yield the slot.
      if (!complete && !mine.length) return { done: false, checked };
    }
  } finally { await db.rpc("release_worker_lease", { _key: `image-audit:${runId}:${shard}`, _holder: holder }); }
}
