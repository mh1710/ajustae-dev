/**
 * Garimpo de produtos no Mercado Livre (server-only).
 *
 * Fonte dos candidatos:
 *  - mais vendidos por categoria (endpoint /highlights, inclui as subcategorias);
 *  - palavras-chave (endpoint /products/search do catálogo).
 *
 * Regras de aprovação (todas obrigatórias):
 *  - EAN que a conta ainda não tem em nenhuma empresa;
 *  - preço + frete até Maringá dentro do teto de custo;
 *  - peso e comprimento informados e dentro do limite (descarta quando faltam);
 *  - não ser medicamento;
 *  - oferta com estoque e envio Full OU chegada até amanhã, conforme a busca.
 */

import { prospectDeliveryDate, prospectDeliveryDays, prospectDeliveryLimit, prospectDeliveryMatches, prospectShippingFailureReason, prospectShippingMatches, type ProspectShippingMode } from "./ml-prospect-shipping";
import { excludedProspectType } from "./ml-prospect-scope";
import { catalogSearchGtin } from "./ml-prospect-gtin";
import { completeMeasures, mergeExactMeasures, type MeasureDonor, type ProspectMeasures } from "./ml-prospect-measures";

const ML_API = "https://api.mercadolibre.com";
const SITE = "MLB";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MlProspectAccessError extends Error {
  constructor(readonly path: string) {
    super(`Mercado Livre não autorizou acesso a ${path} (403).`);
    this.name = "MlProspectAccessError";
  }
}

export type ProspectParams = {
  categories: string[];
  keywords: string[];
  max_cost: number;
  max_weight_kg: number;
  max_length_cm: number;
  zip_code: string;
  shipping_mode?: ProspectShippingMode;
  max_delivery_days?: number;
  /** Quando true, exige medidas verificáveis no catálogo ou em doadores por EAN exato. */
  require_measures?: boolean;
  /** Coleta rápida: fotos não barram a busca; são completadas e exigidas antes do cadastro. */
  quick_collect?: boolean;
};

export async function mlGetJson(
  token: string,
  url: string,
  attempt = 0,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 3) throw new Error(`Mercado Livre indisponível (${res.status}); tente novamente.`);
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt;
    await sleep(Math.min(wait, 3000));
    return mlGetJson(token, url, attempt + 1);
  }
  if (res.status === 404) return null;
  if (res.status === 403) throw new MlProspectAccessError(new URL(url).pathname);
  if (!res.ok) throw new Error(`Mercado Livre recusou a consulta (${res.status}).`);
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

export type CategoryOption = { id: string; name: string };

export async function listSiteCategories(token: string): Promise<CategoryOption[]> {
  const res = await fetch(`${ML_API}/sites/${SITE}/categories`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const rows = (await res.json().catch(() => [])) as CategoryOption[];
  return (rows ?? []).filter((c) => c?.id && c?.name);
}

type Highlight = { id?: string; type?: string };

async function categoryChildren(token: string, categoryId: string): Promise<string[]> {
  const json = await mlGetJson(token, `${ML_API}/categories/${categoryId}`);
  const children = (json?.["children_categories"] as Array<{ id?: string }>) ?? [];
  return children.map((c) => c?.id).filter((id): id is string => !!id);
}

async function categoryHighlights(token: string, categoryId: string): Promise<string[]> {
  const json = await mlGetJson(token, `${ML_API}/highlights/${SITE}/category/${categoryId}`);
  const content = (json?.["content"] as Highlight[]) ?? [];
  return content.filter((c) => c?.type === "PRODUCT" && c.id).map((c) => c.id as string);
}

export type DiscoveryState = {
  categories: string[];
  visited: string[];
  keywords: string[];
  keywordOffset: number;
};

export function initialDiscovery(params: ProspectParams): DiscoveryState {
  return { categories: [...new Set(params.categories)], visited: [], keywords: [...new Set(params.keywords)], keywordOffset: 0 };
}

/** One resumable step: traverse every official child, never a fixed first 25. */
export async function discoverNext(token: string, state: DiscoveryState) {
  const next: DiscoveryState = { ...state, categories: [...state.categories], visited: [...state.visited], keywords: [...state.keywords] };
  const candidates: Array<{ catalog_product_id: string; source: string; source_label: string }> = [];
  const category = next.categories.shift();
  if (category) {
    const [ids, children] = await Promise.all([categoryHighlights(token, category), categoryChildren(token, category)]);
    next.visited.push(category);
    const known = new Set([...next.visited, ...next.categories]);
    for (const child of children) if (!known.has(child)) { next.categories.push(child); known.add(child); }
    for (const id of ids) candidates.push({ catalog_product_id: id, source: "categoria", source_label: category });
  } else if (next.keywords.length) {
    const keyword = next.keywords[0];
    const json = await mlGetJson(token, `${ML_API}/products/search?site_id=${SITE}&status=active&q=${encodeURIComponent(keyword ?? "")}&limit=50&offset=${next.keywordOffset}`);
    const rows = (json?.["results"] as Array<{ id?: string }>) ?? [];
    for (const row of rows) if (row.id) candidates.push({ catalog_product_id: row.id, source: "palavra-chave", source_label: keyword ?? "" });
    const total = Number((json?.["paging"] as { total?: number } | undefined)?.total);
    next.keywordOffset += 50;
    // Mercado Livre catalog search exposes at most its first 1,000 results.
    if (rows.length < 50 || next.keywordOffset >= 1000 || (Number.isFinite(total) && next.keywordOffset >= total)) {
      next.keywords.shift(); next.keywordOffset = 0;
    }
  }
  return { candidates, state: next, exhausted: next.categories.length === 0 && next.keywords.length === 0 };
}

/** Full traversal used by callers that do not need persisted chunks. */
export async function collectCandidates(
  token: string,
  params: ProspectParams,
): Promise<Array<{ catalog_product_id: string; source: string; source_label: string }>> {
  const seen = new Set<string>();
  const out: Array<{ catalog_product_id: string; source: string; source_label: string }> = [];
  const push = (id: string, source: string, label: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ catalog_product_id: id, source, source_label: label });
  };

  let state = initialDiscovery(params);
  while (state.categories.length || state.keywords.length) {
    const step = await discoverNext(token, state);
    step.candidates.forEach(c => push(c.catalog_product_id, c.source, c.source_label));
    state = step.state;
  }

  return out;
}

// ---------------------------------------------------------------- avaliação

type Attr = { id?: string; name?: string; value_name?: string | null; values?: Array<{ name?: string | null }> };

function identityEan(attrs: Attr[]): string | null {
  const values = attrs.filter(a => ["GTIN", "EAN", "UNIVERSAL_PRODUCT_CODE"].includes(a.id ?? ""))
    .flatMap(a => [a.value_name, ...(a.values ?? []).map(v => v.name)])
    .filter((v): v is string => typeof v === "string")
    .map(v => v.trim()).filter(v => /^\d{8,14}$/.test(v));
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] ?? null : null;
}

const SEARCH_SOURCE = "Busca de catálogo Mercado Livre";

/** The catalog search publishes GTIN that /products/{id} omits; only the exact catalog ID counts. */
export async function catalogSearchEan(token: string, catalogId: string): Promise<string | null> {
  try {
    const json = await mlGetJson(token, `${ML_API}/products/search?status=active&site_id=${SITE}&q=${encodeURIComponent(catalogId)}&limit=10`);
    return catalogSearchGtin(json?.["results"], catalogId);
  } catch (error) {
    if (error instanceof MlProspectAccessError) return null;
    throw error;
  }
}

export async function resolveProspectIdentity(
  token: string,
  catalogId: string,
  itemId: string | null,
  product: Record<string, unknown>,
  searchEan: () => Promise<string | null> = () => catalogSearchEan(token, catalogId),
) {
  const catalogEan = identityEan((product["attributes"] as Attr[]) ?? []);
  if (!itemId) {
    const searched = catalogEan ? null : await searchEan();
    return { ean: catalogEan ?? searched, source: catalogEan ? "Catálogo Mercado Livre" : searched ? SEARCH_SOURCE : null, item: null };
  }
  let item: Record<string, unknown> | null;
  try {
    item = await mlGetJson(token, `${ML_API}/items/${itemId}`);
  } catch (error) {
    if (!(error instanceof MlProspectAccessError)) throw error;
    // Catalog identity belongs to the selected catalog; denied item details cannot invalidate it.
    const searched = catalogEan ? null : await searchEan();
    return { ean: catalogEan ?? searched, source: catalogEan ? "Catálogo Mercado Livre" : searched ? SEARCH_SOURCE : null, item: null, accessDenied: true };
  }
  const variations = (item?.["variations"] as Array<Record<string, unknown>>) ?? [];
  const exact = variations.filter(v => v["catalog_product_id"] === catalogId);
  const scopes = exact.length ? exact : item?.["catalog_product_id"] === catalogId && variations.length === 0 ? [item] : [];
  const eans = [...new Set(scopes.map(v => identityEan((v["attributes"] as Attr[]) ?? [])).filter((e): e is string => !!e))];
  const offerEan = eans.length === 1 ? eans[0] ?? null : null;
  if (catalogEan && offerEan && catalogEan !== offerEan) return { ean: null, source: "EAN divergente entre catálogo e anúncio", item };
  if (!catalogEan && !offerEan) {
    const searched = await searchEan();
    return { ean: searched, source: searched ? SEARCH_SOURCE : null, item };
  }
  return { ean: catalogEan ?? offerEan, source: catalogEan ? "Catálogo Mercado Livre" : offerEan ? `Anúncio ${itemId}${exact.length ? " · variação exata" : ""}` : null, item };
}

function attrValue(attrs: Attr[], ids: string[]): string | null {
  for (const id of ids) {
    const found = attrs.find((a) => a?.id === id && (a.value_name ?? "").trim());
    if (found) return (found.value_name ?? "").trim();
  }
  return null;
}

/** Converte "190 g", "2.5 kg", "1,2 Kg" para kg. */
export function parseWeightKg(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.replace(",", ".").match(/([\d.]+)\s*(kg|kgs|g|gr|gramas?|mg|lb)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "kg").toLowerCase();
  if (unit.startsWith("kg")) return n;
  if (unit === "mg") return n / 1_000_000;
  if (unit === "lb") return n * 0.4536;
  return n / 1000; // g
}

/** Converte "16.44 cm", "7.5 mm", "1.2 m" para cm. */
export function parseLengthCm(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.replace(",", ".").match(/([\d.]+)\s*(cm|mm|m|")?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "cm").toLowerCase();
  if (unit === "mm") return n / 10;
  if (unit === "m") return n * 100;
  if (unit === '"') return n * 2.54;
  return n;
}

async function categoryPathText(token: string, categoryId: string | null): Promise<string | null> {
  if (!categoryId) return null;
  const json = await mlGetJson(token, `${ML_API}/categories/${categoryId}`);
  const path = (json?.["path_from_root"] as Array<{ name?: string }>) ?? [];
  const names = path.map((p) => p?.name).filter(Boolean);
  return names.length ? names.join(" > ") : ((json?.["name"] as string) ?? null);
}

function readMeasures(attrs: Attr[]): ProspectMeasures {
  const positive = (value: number | null) => value !== null && value > 0 ? value : null;
  return {
    weight_kg: positive(parseWeightKg(attrValue(attrs, ["PACKAGE_WEIGHT", "WEIGHT", "NET_WEIGHT", "GROSS_WEIGHT"]))),
    length_cm: positive(parseLengthCm(attrValue(attrs, ["PACKAGE_LENGTH", "LENGTH", "DEPTH"]))),
    height_cm: positive(parseLengthCm(attrValue(attrs, ["PACKAGE_HEIGHT", "HEIGHT"]))),
    width_cm: positive(parseLengthCm(attrValue(attrs, ["PACKAGE_WIDTH", "WIDTH"]))),
  };
}

/** Donors supply measurements only, regardless of their price or delivery eligibility. */
async function recoverMeasures(token: string, ean: string, base: ProspectMeasures, item: Record<string, unknown> | null, itemIds: string[]) {
  const donors: MeasureDonor[] = [];
  const addItem = (row: Record<string, unknown> | null, source: string) => {
    if (!row) return;
    const variations = (row["variations"] as Array<Record<string, unknown>>) ?? [];
    // Never borrow item-level package data from a listing containing different variants.
    for (const scope of variations.length ? variations : [row]) {
      const attrs = (scope["attributes"] as Attr[]) ?? [];
      if (identityEan(attrs) === ean) donors.push({ ean, source, measures: readMeasures(attrs) });
    }
  };
  addItem(item, `Anúncio ${String(item?.["id"] ?? "selecionado")}`);
  if (completeMeasures(mergeExactMeasures(base, ean, donors).measures)) return mergeExactMeasures(base, ean, donors);
  const rows = await Promise.all([...new Set(itemIds)].slice(0, 6).map(async id => {
    try { return { id, row: await mlGetJson(token, `${ML_API}/items/${id}`) }; }
    catch { return { id, row: null }; }
  }));
  rows.forEach(({ id, row }) => addItem(row, `Anúncio ${id}`));
  let merged = mergeExactMeasures(base, ean, donors);
  if (completeMeasures(merged.measures)) return merged;
  // Search is merely discovery: every returned product must itself publish the exact EAN.
  try {
    const search = await mlGetJson(token, `${ML_API}/products/search?site_id=${SITE}&status=active&q=${encodeURIComponent(ean)}&limit=5`);
    const hits = (search?.["results"] as Array<{ id?: string }>) ?? [];
    await Promise.all(hits.slice(0, 5).map(async hit => {
      if (!hit.id) return;
      try {
        const product = await mlGetJson(token, `${ML_API}/products/${hit.id}`);
        const attrs = (product?.["attributes"] as Attr[]) ?? [];
        if (identityEan(attrs) === ean) donors.push({ ean, source: `Catálogo ${hit.id}`, measures: readMeasures(attrs) });
      } catch { /* Unavailable sources never authorize measurements. */ }
    }));
  } catch { /* Keep missing fields unresolved. */ }
  merged = mergeExactMeasures(base, ean, donors);
  return merged;
}

type Offer = {
  item_id: string;
  price: number;
  logistic_type: string | null;
  free_shipping: boolean;
  shipping_cost_hint: number | null;
  seller_id: string | null;
  category_id: string | null;
  available_quantity: number;
  raw: Record<string, unknown>;
};

function readOffers(json: Record<string, unknown> | null): Offer[] {
  const rows = (json?.["results"] as Array<Record<string, unknown>>) ?? [];
  const out: Offer[] = [];
  for (const r of rows) {
    const shipping = (r["shipping"] ?? {}) as Record<string, unknown>;
    const id = (r["item_id"] ?? r["id"]) as string | undefined;
    const price = r["price"] as number | undefined;
    if (!id || typeof price !== "number") continue;
    out.push({
      item_id: id,
      price,
      logistic_type: (shipping["logistic_type"] as string) ?? null,
      free_shipping: shipping["free_shipping"] === true,
      shipping_cost_hint: typeof shipping["cost"] === "number" ? (shipping["cost"] as number) : null,
      seller_id: r["seller_id"] ? String(r["seller_id"]) : null,
      category_id: (r["category_id"] as string) ?? null,
      available_quantity:
        typeof r["available_quantity"] === "number" ? (r["available_quantity"] as number) : 1,
      raw: r,
    });
  }
  return out.sort((a, b) => a.price - b.price);
}

export type ProspectRow = {
  catalog_product_id: string;
  item_id: string | null;
  ean: string | null;
  titulo: string | null;
  marca: string | null;
  domain_id: string | null;
  category_id: string | null;
  category_path: string | null;
  permalink: string | null;
  thumbnail: string | null;
  pictures: string[];
  pictures_count: number;
  custo: number | null;
  garantia: string;
  crossdocking: number;
  price: number | null;
  shipping_cost: number | null;
  total_price: number | null;
  available_quantity: number | null;
  is_full: boolean;
  arrives_tomorrow: boolean;
  delivery_date: string | null;
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  seller_id: string | null;
  raw: Record<string, unknown>;
};

export type EvaluateResult =
  | { ok: true; row: ProspectRow; ean: string | null }
  | { ok: false; reason: string; ean?: string | null };

export async function evaluateCandidate(
  token: string,
  catalogProductId: string,
  params: ProspectParams,
): Promise<EvaluateResult> {
  const product = await mlGetJson(token, `${ML_API}/products/${catalogProductId}`);
  if (!product) return { ok: false, reason: "produto não encontrado" };

  const attrs = (product["attributes"] as Attr[]) ?? [];
  const title = (product["name"] as string) ?? null;
  const domainId = (product["domain_id"] as string) ?? null;
  if (excludedProspectType(domainId, null, title))
    return { ok: false, reason: "produto para ingestão ou não é objeto" };

  // O catálogo do ML raramente publica GTIN; quando vier, usamos para deduplicar.
  const eanOk = identityEan(attrs);

  // Fotos: só .jpg/.jpeg/.png e no mínimo 3 por produto.
  const pictures = (((product["pictures"] as Array<{ url?: string; secure_url?: string }>) ?? [])
    .map((p) => p.secure_url || p.url || "")
    .filter((u) => /\.(jpe?g|png)(\?|$)/i.test(u)));
  if (!params.quick_collect && pictures.length < 3)
    return { ok: false, reason: `apenas ${pictures.length} foto(s) JPG/PNG`, ean: eanOk };

  const baseMeasures = readMeasures(attrs);
  const weightKg = baseMeasures.weight_kg;
  if (weightKg !== null && weightKg > params.max_weight_kg)
    return { ok: false, reason: `peso ${weightKg} kg`, ean: eanOk };

  const dims = [
    parseLengthCm(attrValue(attrs, ["PACKAGE_LENGTH", "LENGTH", "DEPTH"])),
    parseLengthCm(attrValue(attrs, ["PACKAGE_HEIGHT", "HEIGHT"])),
    parseLengthCm(attrValue(attrs, ["PACKAGE_WIDTH", "WIDTH"])),
  ];
  const known = dims.filter((d): d is number => d !== null);
  const largestCm = known.length ? Math.max(...known) : null;
  if (largestCm !== null && largestCm > params.max_length_cm)
    return { ok: false, reason: `comprimento ${largestCm} cm`, ean: eanOk };

  const offersJson = await mlGetJson(token, `${ML_API}/products/${catalogProductId}/items?limit=20`);
  // A lista de ofertas do catálogo não traz quantidade; a oferta Full ativa já indica estoque.
  const anyShipping = params.shipping_mode === "tomorrow" || params.shipping_mode === "deadline";
  const offers = readOffers(offersJson).filter((o) => (anyShipping || o.logistic_type === "fulfillment") && o.available_quantity > 0 && (!o.raw["condition"] || o.raw["condition"] === "new"));
  if (offers.length === 0) return { ok: false, reason: anyShipping ? "sem oferta com estoque" : "sem oferta Full", ean: eanOk };

  const categoryPath = await categoryPathText(token, offers[0]?.category_id ?? null);
  if (excludedProspectType(domainId, categoryPath, title))
    return { ok: false, reason: "produto para ingestão ou não é objeto", ean: eanOk };

  const limit = prospectDeliveryLimit(1);
  // One catalog search per product, shared by every offer tried below.
  let searchedEan: Promise<string | null> | null = null;
  const searchEan = () => (searchedEan ??= catalogSearchEan(token, catalogProductId));
  let missingEan = false;
  let deniedIdentity = false;
  let measuresFailure: string | null = null;
  const shippingFailure = { cheapestOverCost: offers[0].price > params.max_cost, matchedOverCost: false, fastestDays: null as number | null };
  for (const offer of offers.slice(0, 4)) {
    if (offer.price > params.max_cost) break; // já está ordenado por preço
    const shippingJson = await mlGetJson(
      token,
      `${ML_API}/items/${offer.item_id}/shipping_options?zip_code=${encodeURIComponent(params.zip_code)}`,
    );
    const options = (shippingJson?.["options"] as Array<Record<string, unknown>>) ?? [];
    let best: { cost: number; date: string | null } | null = null;
    for (const opt of options) {
      const cost = typeof opt["cost"] === "number" ? (opt["cost"] as number) : null;
      if (cost === null) continue;
      const date = prospectDeliveryDate(opt);
      const days = prospectDeliveryDays(date);
      if (days !== null && offer.price + cost <= params.max_cost && (shippingFailure.fastestDays === null || days < shippingFailure.fastestDays)) shippingFailure.fastestDays = days;
      const arrivesTomorrow = !!date && Number.isFinite(new Date(date).getTime()) && new Date(date).getTime() <= limit;
      if (!prospectShippingMatches(params.shipping_mode, offer.logistic_type === "fulfillment", arrivesTomorrow, prospectDeliveryMatches(date, params.max_delivery_days))) continue;
      if (!best || cost < best.cost) best = { cost, date };
    }
    if (!best) continue;
    const total = offer.price + best.cost;
    if (total > params.max_cost) { shippingFailure.matchedOverCost = true; continue; }

    const identity = await resolveProspectIdentity(token, catalogProductId, offer.item_id, product, searchEan);
    if (!identity.ean) { missingEan = true; deniedIdentity ||= identity.accessDenied === true; continue; }

    const recovered = completeMeasures(baseMeasures)
      ? { measures: baseMeasures, sources: {} }
      : await recoverMeasures(token, identity.ean, baseMeasures, identity.item, readOffers(offersJson).map(o => o.item_id).filter(id => id !== offer.item_id));
    const measures = recovered.measures;
    if (params.require_measures && !completeMeasures(measures)) {
      measuresFailure = "peso/medidas ausentes ou conflitantes nas fontes com EAN exato";
      continue;
    }
    if (Number(measures.weight_kg) > params.max_weight_kg || Math.max(Number(measures.length_cm), Number(measures.width_cm), Number(measures.height_cm)) > params.max_length_cm) {
      measuresFailure = "peso ou medidas acima dos limites após consulta por EAN";
      continue;
    }

    return {
      ok: true,
      ean: identity.ean,
      row: {
        catalog_product_id: catalogProductId,
        item_id: offer.item_id,
        ean: identity.ean,
        titulo: title,
        marca: attrValue(attrs, ["BRAND"]),
        domain_id: domainId,
        category_id: offer.category_id,
        category_path: categoryPath,
        permalink:
          ((product["permalink"] as string) || "") ||
          `https://www.mercadolivre.com.br/p/${catalogProductId}`,
        thumbnail: pictures[0] ?? null,
        pictures,
        pictures_count: pictures.length,
        // Custo = exatamente o preço de venda do Mercado Livre.
        custo: offer.price,
        garantia: "3 meses",
        crossdocking: 3,
        price: offer.price,
        shipping_cost: best.cost,
        total_price: total,
        available_quantity: offer.available_quantity,
        is_full: offer.logistic_type === "fulfillment",
        arrives_tomorrow: !!best.date && Number.isFinite(new Date(best.date).getTime()) && new Date(best.date).getTime() <= limit,
        delivery_date: best.date,
        ...measures,
        seller_id: offer.seller_id,
        raw: {
          shipping_mode: params.shipping_mode ?? "full_tomorrow",
          zip_code: params.zip_code,
          max_delivery_days: params.max_delivery_days ?? null,
          product,
          identity: { ean_source: identity.source },
          item_access_denied: identity.accessDenied === true,
          measurement_sources: recovered.sources,
          item: identity.item,
          offer: offer.raw,
          shipping_options: shippingJson,
          offers_full: offers.length,
        },
      },
    };
  }

  return { ok: false, reason: measuresFailure ?? (deniedIdentity ? "EAN não verificável: catálogo e busca de catálogo sem EAN e acesso ao anúncio negado pelo Mercado Livre (403)" : missingEan ? "EAN não publicado no catálogo, na busca de catálogo nem no anúncio/variação exata" : prospectShippingFailureReason(params.shipping_mode, params.max_delivery_days, params.max_cost, shippingFailure)), ean: eanOk };
}
