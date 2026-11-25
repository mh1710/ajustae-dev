/** GTIN-8/12/13/14 check digit. */
export function validGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop() as number;
  const sum = digits.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

type SearchAttr = { id?: string; value_name?: string | null; values?: Array<{ name?: string | null }> };

/** EAN published by the ML catalog search for this exact catalog ID; other results never count. */
export function catalogSearchGtin(results: unknown, catalogId: string): string | null {
  if (!Array.isArray(results)) return null;
  const hit = results.find(r => (r as { id?: unknown })?.id === catalogId) as { attributes?: SearchAttr[] } | undefined;
  if (!hit) return null;
  const codes = (hit.attributes ?? [])
    .filter(a => ["GTIN", "EAN", "UNIVERSAL_PRODUCT_CODE"].includes(a?.id ?? ""))
    .flatMap(a => [a.value_name, ...(a.values ?? []).map(v => v.name)])
    .flatMap(v => String(v ?? "").split(/\D+/))
    .map(v => (v.length === 14 && v.startsWith("0") ? v.slice(1) : v))
    .filter(validGtin);
  return codes[0] ?? null;
}

const gtinKey = (code: string) => code.replace(/^0+/, "");

/** True when the ML catalog search lists this EAN for this exact catalog ID (leading zeros ignored). */
export function catalogSearchHasGtin(results: unknown, catalogId: string, ean: string): boolean {
  if (!Array.isArray(results) || !/^\d{8,14}$/.test(ean)) return false;
  const hit = results.find(r => (r as { id?: unknown })?.id === catalogId) as { attributes?: SearchAttr[] } | undefined;
  if (!hit) return false;
  return (hit.attributes ?? [])
    .filter(a => ["GTIN", "EAN", "UNIVERSAL_PRODUCT_CODE"].includes(a?.id ?? ""))
    .flatMap(a => [a.value_name, ...(a.values ?? []).map(v => v.name)])
    .flatMap(v => String(v ?? "").split(/\D+/))
    .some(v => v.length >= 8 && gtinKey(v) === gtinKey(ean));
}
