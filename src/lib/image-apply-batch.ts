export const IMAGE_APPLY_PRODUCTS_PER_REQUEST = 1;
export const IMAGE_CHECKS_IN_PARALLEL = 6;
/** Photo search: products per request and requests running at once from the review screen. */
export const IMAGE_SEARCH_PRODUCTS_PER_REQUEST = 6;
export const IMAGE_SEARCHES_IN_PARALLEL = 4;
export function chunks<T>(items: T[], size = IMAGE_APPLY_PRODUCTS_PER_REQUEST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
export async function mapLimited<T, R>(items: T[], fn: (item: T) => Promise<R>, limit = IMAGE_CHECKS_IN_PARALLEL): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}