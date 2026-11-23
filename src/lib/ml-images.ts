/** Regras de imagens do fornecedor e do catálogo do Mercado Livre por EAN. */
import { isPlaceholderImage } from "./placeholder-images";

/** Only verified photos count; an invalid link always requires cleanup. */
export function currentImageCorrection(current: string[], verified: string[], min: number, max: number) {
  const allowed = new Set(verified);
  const valid = [...new Set(current.filter((url) => allowed.has(url) && !isPlaceholderImage(url)))].slice(0, max);
  const invalid = current.filter((url) => !allowed.has(url) || isPlaceholderImage(url));
  return { valid, invalid, skip: invalid.length === 0 && valid.length >= min, cleanupOnly: invalid.length > 0 && valid.length >= min };
}

export function mergeVerifiedImages(current: string[], suggested: string[], max: number) {
  return [...new Set([...current, ...suggested])].filter((url) => !isPlaceholderImage(url)).slice(0, max);
}

/** Fotos do catálogo do fornecedor podem ser uma URL, lista ou texto separado. */
export function pickSupplierImageUrls(foto: unknown, max: number): string[] {
  const values = Array.isArray(foto) ? foto : typeof foto === "string" ? foto.split(/[|\n\r;,]+/) : [];
  return pickMlImageUrls(values.map((url) => ({ url: typeof url === "string" ? url.trim() : "" })), max);
}

/** Não consulta o ML se as fotos do fornecedor já resolvem o mínimo. */
export async function supplierFirstImages<T>(supplier: string[], min: number, fallback: () => Promise<T>) {
  if (supplier.length >= min) return { source: "fornecedor" as const, imagens: supplier };
  return { source: "mercado_livre" as const, result: await fallback() };
}

/** O anúncio só vale se um dos GTINs publicados for exatamente o EAN do produto. */
export function eanMatches(attributes: unknown, ean: string): boolean {
  const target = ean.replace(/\D/g, "");
  if (target.length < 8 || !Array.isArray(attributes)) return false;
  return attributes
    .filter((a: any) => a?.id === "GTIN")
    .flatMap((a: any) => String(a?.value_name ?? "").split(/[,;\s]+/))
    .map((v) => v.replace(/\D/g, ""))
    .includes(target);
}

/** URLs https JPG/PNG, sem repetição, limitadas ao máximo da auditoria. */
export function pickMlImageUrls(pictures: unknown, max: number): string[] {
  if (!Array.isArray(pictures)) return [];
  const out: string[] = [];
  for (const p of pictures as any[]) {
    const u = String(p?.secure_url || p?.url || "").replace(/^http:\/\//i, "https://");
    if (!/^https:\/\//i.test(u) || !/\.(jpe?g|png)(\?|$)/i.test(u) || out.includes(u) || isPlaceholderImage(u)) continue;
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}
