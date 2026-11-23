import { isPlaceholderImage, normalizeImageUrl } from "./placeholder-images";

export const IMAGE_AUDIT_PRODUCT_BATCH = 500;
/** Cloudflare Workers keep at most 6 simultaneous outbound connections per invocation. */
export const IMAGE_AUDIT_CONCURRENCY = 6;
/** Parallel workers per audit run; each downloads a disjoint hash shard of the pending photos. */
export const IMAGE_AUDIT_SHARDS = 6;
export function imageShard(key: string, shards = IMAGE_AUDIT_SHARDS) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % shards;
}

/** Keep PostgREST GET filters below proxy request-line limits, including escaping. */
export const IMAGE_CACHE_FILTER_BUDGET = 5_000;
export function imageCacheKeyBatches(keys: string[]) {
  const batches: string[][] = [];
  let batch: string[] = [];
  let size = 0;
  for (const key of new Set(keys)) {
    const encodedSize = encodeURIComponent(JSON.stringify(key)).length + 3;
    if (batch.length && size + encodedSize > IMAGE_CACHE_FILTER_BUDGET) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(key);
    size += encodedSize;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export type ImageAuditProduct = { id: string; url_imagens_externas: string | null; imagem_principal_url: string | null };
export function productImageUrls(product: ImageAuditProduct) {
  return (product.url_imagens_externas || product.imagem_principal_url || "").split(/[|\n\r]+/).map((url) => url.trim()).filter(Boolean);
}
export function pendingImageUrls(products: ImageAuditProduct[], cached: Set<string>) {
  const unique = new Map<string, string>();
  for (const product of products) for (const url of productImageUrls(product)) {
    const key = normalizeImageUrl(url);
    if (!cached.has(key) && !isPlaceholderImage(url)) unique.set(key, url);
  }
  return [...unique.values()];
}
/** Advance only the contiguous fully checked prefix, never skip pending photos. */
export function completedImageProducts(products: ImageAuditProduct[], cached: Set<string>) {
  let completed = 0;
  for (const product of products) {
    if (productImageUrls(product).some((url) => !cached.has(normalizeImageUrl(url)) && !isPlaceholderImage(url))) break;
    completed++;
  }
  return completed;
}
/** HTTP statuses that mean "try again later" (rate limit or server outage), not a broken photo. */
export function isTransientImageStatus(status: number) {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}
export type PlaceholderSignatures = { sizes: Set<number>; hosts: Set<string> };
/**
 * Photos are judged by headers first; only a size matching a known placeholder,
 * a host that has served placeholders, or an unknown size forces a full download.
 */
export function needsFullDownload(size: number | null, host: string, sig: PlaceholderSignatures) {
  return size === null || sig.sizes.has(size) || sig.hosts.has(host.toLowerCase());
}
/** Total size from Content-Range ("bytes 0-0/36280") or Content-Length of a full reply. */
export function imageTotalSize(status: number, contentRange: string | null, contentLength: string | null) {
  const total = contentRange?.match(/\/(\d+)\s*$/)?.[1];
  if (total) return Number(total);
  if (status === 200 && contentLength && /^\d+$/.test(contentLength)) return Number(contentLength);
  return null;
}
export function isSupportedImageType(contentType: string | null) {
  return /^image\/(jpeg|jpg|pjpeg|png)\b/i.test(contentType ?? "");
}
/** Wait before retrying a transient response, honouring Retry-After up to 4s. */
export function transientRetryDelayMs(attempt: number, retryAfter: string | null) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 4000);
  return 800 * 2 ** attempt;
}
