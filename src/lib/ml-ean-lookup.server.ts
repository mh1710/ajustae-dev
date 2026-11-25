/**
 * Dados do catálogo do Mercado Livre pelo EAN exato (server-only): só entram
 * produtos de catálogo que publicam o mesmo EAN; medidas conflitantes ficam vazias.
 */
import { mlGetJson, readMeasures, type Attr } from "./ml-prospect.server";
import { mergeExactMeasures, type MeasureDonor, type ProspectMeasures } from "./ml-prospect-measures";
import { catalogAttributes, catalogDescription } from "./ml-prospect-prepare";
import { catalogSearchHasGtin } from "./ml-prospect-gtin";
import { MlTransientError } from "./ml-http.server";

const ML_API = "https://api.mercadolibre.com";
const PHOTO = /^https?:\/\/.+\.(jpe?g|png)(\?|$)/i;

export type MlEanData = {
  found: number;
  measures: ProspectMeasures;
  measureSources: Partial<Record<keyof ProspectMeasures, string[]>>;
  brand: string | null;
  pictures: string[];
  description: string;
  attributes: string[];
  catalogIds: string[];
};

function brandOf(attrs: Attr[]): string | null {
  const b = attrs.find(a => a.id === "BRAND" && (a.value_name ?? "").trim());
  return b ? String(b.value_name).trim() : null;
}

export async function lookupMlByEan(token: string, ean: string, base: ProspectMeasures): Promise<MlEanData> {
  const empty: MlEanData = { found: 0, measures: base, measureSources: {}, brand: null, pictures: [], description: "", attributes: [], catalogIds: [] };
  if (!/^\d{8,14}$/.test(ean)) return empty;
  const search = await mlGetJson(token, `${ML_API}/products/search?site_id=MLB&status=active&q=${encodeURIComponent(ean)}&limit=5`);
  // /products/{id} omite o GTIN; a identidade vem da própria busca, só para o mesmo ID de catálogo.
  const results = (search?.["results"] as Array<Record<string, any>>) ?? [];
  const hits = results.filter(h => typeof h["id"] === "string" && catalogSearchHasGtin(results, h["id"], ean)).slice(0, 3);
  const products = await Promise.all(hits.map(async hit => {
    let detail: Record<string, any> | null = null;
    try { detail = await mlGetJson(token, `${ML_API}/products/${hit["id"]}`); } catch (e) { if (e instanceof MlTransientError) throw e; detail = null; }
    const product = { ...hit, ...(detail ?? {}) };
    if (!Array.isArray(detail?.["attributes"])) product["attributes"] = hit["attributes"] ?? [];
    return { id: String(hit["id"]), product };
  }));
  if (!products.length) return empty;
  const donors: MeasureDonor[] = products.map(r => ({ ean, source: `Catálogo Mercado Livre ${r.id}`, measures: readMeasures((r.product["attributes"] as Attr[]) ?? []) }));
  const merged = mergeExactMeasures(base, ean, donors);
  const brands = [...new Set(products.map(r => brandOf(r.product["attributes"] ?? [])).filter((b): b is string => !!b))];
  const pictures = [...new Set(products.flatMap(r => ((r.product["pictures"] as Array<{ url?: string; secure_url?: string }>) ?? [])
    .map(p => String(p.secure_url ?? p.url ?? "").replace(/^http:/, "https:"))))].filter(u => PHOTO.test(u));
  const main = products[0]!.product;
  return {
    found: products.length,
    measures: merged.measures,
    measureSources: merged.sources,
    brand: brands.length === 1 ? brands[0]! : null,
    pictures,
    description: catalogDescription(main),
    attributes: catalogAttributes(main).filter(a => !/^(GTIN|EAN|SKU|Código universal)/i.test(a)),
    catalogIds: products.map(r => r.id),
  };
}
