/**
 * Pure parsing of Amazon SP-API Catalog Items (2022-04-01) results for the Brazilian marketplace.
 * Only items carrying the exact same EAN are used; values are converted to kg/cm.
 */
export const AMAZON_BR_MARKETPLACE = "A2Q3Y263D00KWC";

export type AmazonProduct = {
  asin: string;
  title: string | null;
  brand: string | null;
  ncm: string | null;
  description: string;
  pictures: string[];
  measures: { weight_kg: number | null; length_cm: number | null; width_cm: number | null; height_cm: number | null; kind: "embalagem" | "produto" | null };
};

type Measure = { unit?: string; value?: number } | undefined;

const PHOTO = /^https:\/\/.+\.(jpe?g|png)(\?|$)/i;

export function sameEan(a: unknown, b: unknown): boolean {
  const x = String(a ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const y = String(b ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return x.length >= 7 && x === y;
}

export function toCm(m: Measure): number | null {
  const v = Number(m?.value);
  if (!(v > 0)) return null;
  const unit = String(m?.unit ?? "").toLowerCase();
  const cm = /^milli/.test(unit) ? v / 10 : /^meter|^metre/.test(unit) ? v * 100 : /^inch/.test(unit) ? v * 2.54 : /^centi/.test(unit) ? v : null;
  return cm === null ? null : Math.round(cm * 100) / 100;
}

export function toKg(m: Measure): number | null {
  const v = Number(m?.value);
  if (!(v > 0)) return null;
  const unit = String(m?.unit ?? "").toLowerCase();
  const kg = /^kilo/.test(unit) ? v : /^gram/.test(unit) ? v / 1000 : /^pound/.test(unit) ? v * 0.45359237 : /^ounce/.test(unit) ? v * 0.028349523 : /^milligram/.test(unit) ? v / 1e6 : null;
  return kg === null ? null : Math.round(kg * 1000) / 1000;
}

function attr(item: any, key: string): any[] {
  const list = item?.attributes?.[key];
  return Array.isArray(list) ? list.filter(a => !a?.marketplace_id || a.marketplace_id === AMAZON_BR_MARKETPLACE) : [];
}

function text(item: any, key: string): string | null {
  const v = String(attr(item, key)[0]?.value ?? "").trim();
  return v || null;
}

/** Every EAN/GTIN/UPC the Amazon item publishes (identifiers and attributes). */
export function amazonEans(item: any): string[] {
  const fromIdentifiers = (Array.isArray(item?.identifiers) ? item.identifiers : [])
    .flatMap((g: any) => (Array.isArray(g?.identifiers) ? g.identifiers : []))
    .filter((i: any) => /^(ean|gtin|upc)$/i.test(String(i?.identifierType ?? "")))
    .map((i: any) => String(i.identifier ?? ""));
  const fromAttributes = attr(item, "externally_assigned_product_identifier")
    .filter(a => /^(ean|gtin|upc)$/i.test(String(a?.type ?? "")))
    .map(a => String(a.value ?? ""));
  return [...fromIdentifiers, ...fromAttributes];
}

/** Package measures first (what ships); product measures only as a complete fallback set. */
function measures(item: any): AmazonProduct["measures"] {
  const pkgDims = attr(item, "item_package_dimensions")[0];
  const pkgWeight = toKg(attr(item, "item_package_weight")[0]);
  const dims = (d: any) => ({ length_cm: toCm(d?.length), width_cm: toCm(d?.width), height_cm: toCm(d?.height) });
  const pkg = dims(pkgDims);
  const prod = dims(attr(item, "item_dimensions")[0]);
  const prodWeight = toKg(attr(item, "item_weight")[0]);
  const full = (d: { length_cm: number | null; width_cm: number | null; height_cm: number | null }) => !!(d.length_cm && d.width_cm && d.height_cm);
  if (full(pkg)) return { ...pkg, weight_kg: pkgWeight ?? prodWeight, kind: "embalagem" };
  if (full(prod)) return { ...prod, weight_kg: pkgWeight ?? prodWeight, kind: "produto" };
  return { length_cm: null, width_cm: null, height_cm: null, weight_kg: pkgWeight ?? prodWeight, kind: pkgWeight ? "embalagem" : prodWeight ? "produto" : null };
}

/** Largest variant of each image slot, MAIN first. */
function pictures(item: any): string[] {
  const images = (Array.isArray(item?.images) ? item.images : [])
    .filter((g: any) => !g?.marketplaceId || g.marketplaceId === AMAZON_BR_MARKETPLACE)
    .flatMap((g: any) => (Array.isArray(g?.images) ? g.images : []));
  const best = new Map<string, { link: string; size: number }>();
  for (const img of images) {
    const link = String(img?.link ?? "");
    if (!PHOTO.test(link)) continue;
    const variant = String(img?.variant ?? "OTHER");
    const size = Number(img?.width ?? 0) * Number(img?.height ?? 0);
    const cur = best.get(variant);
    if (!cur || size > cur.size) best.set(variant, { link, size });
  }
  const order = (v: string) => (v === "MAIN" ? -1 : Number(v.replace(/\D/g, "")) || 99);
  return [...best.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([, v]) => v.link);
}

function description(item: any): string {
  const parts = [
    ...attr(item, "product_description").map(a => String(a?.value ?? "")),
    ...attr(item, "bullet_point").map(a => String(a?.value ?? "")),
  ].map(s => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(s => s && !/^origem:/i.test(s));
  return [...new Set(parts)].map(s => (/[.!?]$/.test(s) ? s : `${s}.`)).join(" ").slice(0, 2000);
}

function ncm(item: any): string | null {
  const digits = String(attr(item, "ncm_code")[0]?.value ?? "").replace(/\D/g, "");
  return /^\d{8}$/.test(digits) && !/^0{8}$/.test(digits) ? digits : null;
}

/** Amazon pack listings (item_package_quantity > 1) describe several units: their weight/size are not the unit's. */
function packQuantity(item: any): number {
  const q = Number(attr(item, "item_package_quantity")[0]?.value ?? 1);
  return q > 0 ? q : 1;
}

export function parseAmazonItem(item: any): AmazonProduct {
  const summary = (Array.isArray(item?.summaries) ? item.summaries : []).find((s: any) => !s?.marketplaceId || s.marketplaceId === AMAZON_BR_MARKETPLACE) ?? {};
  return {
    asin: String(item?.asin ?? ""),
    title: String(summary.itemName ?? text(item, "item_name") ?? "").trim() || null,
    brand: String(summary.brand ?? text(item, "brand") ?? "").trim() || null,
    ncm: ncm(item),
    description: description(item),
    pictures: pictures(item),
    measures: packQuantity(item) > 1 ? { weight_kg: null, length_cm: null, width_cm: null, height_cm: null, kind: null } : measures(item),
  };
}

function score(p: AmazonProduct): number {
  const m = p.measures;
  return (m.length_cm ? 4 : 0) + (m.weight_kg ? 4 : 0) + (p.ncm ? 2 : 0) + (p.brand ? 1 : 0) + Math.min(p.pictures.length, 6) + (p.description.length >= 150 ? 2 : 0);
}

/** The most complete Amazon item whose identifiers contain exactly this EAN (null when none). */
export function pickAmazonProduct(ean: string, items: unknown): AmazonProduct | null {
  const list = (Array.isArray(items) ? items : []).filter((i: any) => amazonEans(i).some(e => sameEan(e, ean)));
  const parsed = list.map(parseAmazonItem).filter(p => p.asin);
  parsed.sort((a, b) => score(b) - score(a));
  return parsed[0] ?? null;
}
