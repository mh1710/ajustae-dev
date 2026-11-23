/** Confirmed placeholder image references, not patterns for an entire supplier. */
export const PLACEHOLDER_IMAGE_URLS = [
  "https://oderco.com.br/media/catalog/product/4/-/4-17691023004367003.jpeg",
];

export function normalizeImageUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    return `${url.hostname.toLowerCase()}${url.pathname}`;
  } catch { return value.trim(); }
}

export function isPlaceholderImage(url: string, known: string[] = PLACEHOLDER_IMAGE_URLS): boolean {
  return known.some((reference) => normalizeImageUrl(reference) === normalizeImageUrl(url));
}