import { AMAZON_BR_MARKETPLACE, pickAmazonProduct, type AmazonProduct } from "./amazon-catalog";

const HOST = "https://sellingpartnerapi-na.amazon.com";
let cached: { token: string; expires: number } | null = null;

export function amazonConfigured(): boolean {
  return !!(process.env["AMAZON_LWA_CLIENT_ID"] && process.env["AMAZON_LWA_CLIENT_SECRET"] && process.env["AMAZON_LWA_REFRESH_TOKEN"]);
}

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env["AMAZON_LWA_REFRESH_TOKEN"] ?? "",
      client_id: process.env["AMAZON_LWA_CLIENT_ID"] ?? "",
      client_secret: process.env["AMAZON_LWA_CLIENT_SECRET"] ?? "",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) throw new Error(`Amazon recusou a autorização (${res.status}).`);
  cached = { token: json.access_token, expires: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
  return cached.token;
}

/** Catalog item for this exact EAN in Amazon Brasil, or null; retries rate limits (2 req/s). */
export async function lookupAmazonByEan(ean: string): Promise<AmazonProduct | null> {
  if (!amazonConfigured() || !/^\d{8,14}$/.test(ean)) return null;
  const params = new URLSearchParams({
    marketplaceIds: AMAZON_BR_MARKETPLACE, identifiers: ean, identifiersType: "EAN",
    includedData: "summaries,attributes,images,identifiers", locale: "pt_BR", pageSize: "10",
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${HOST}/catalog/2022-04-01/items?${params}`, { headers: { "x-amz-access-token": await accessToken(), accept: "application/json" } });
    if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 700 * (attempt + 1) + Math.random() * 400)); continue; }
    if (res.status === 401 || res.status === 403) { cached = null; throw new Error(`Amazon negou a consulta (${res.status}).`); }
    if (!res.ok) throw new Error(`Amazon respondeu ${res.status}.`);
    const json = (await res.json()) as { items?: unknown[] };
    return pickAmazonProduct(ean, json.items ?? []);
  }
  throw new Error("Amazon ocupada (limite de consultas); tente de novo.");
}

async function amazonFetch(path: string, init: RequestInit = {}, attempts = 4, waitMs = 1000): Promise<any> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await fetch(`${HOST}${path}`, { ...init, headers: { "x-amz-access-token": await accessToken(), accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) } });
    if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, waitMs * (attempt + 1) + Math.random() * 300)); continue; }
    if (res.status === 401 || res.status === 403) { cached = null; throw new Error(`Amazon negou a consulta (${res.status}).`); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Amazon respondeu ${res.status}: ${String((json as any)?.errors?.[0]?.message ?? "")}`.trim());
    return json;
  }
  throw new AmazonBusyError();
}

export class AmazonBusyError extends Error {
  constructor() { super("Amazon ocupada (limite de consultas); tentando de novo em seguida."); }
}

/** One page (20 items) of the Amazon Brasil catalog search with everything the garimpo needs. */
export async function searchAmazonCatalog(keyword: string, classificationId: string | null, pageToken: string | null) {
  const params = new URLSearchParams({
    marketplaceIds: AMAZON_BR_MARKETPLACE, keywords: keyword, locale: "pt_BR", pageSize: "20",
    includedData: "summaries,attributes,images,identifiers,classifications,salesRanks",
  });
  if (classificationId) params.set("classificationIds", classificationId);
  if (pageToken) params.set("pageToken", pageToken);
  const json = await amazonFetch(`/catalog/2022-04-01/items?${params}`);
  return { items: (Array.isArray(json?.items) ? json.items : []) as any[], nextToken: (json?.pagination?.nextToken as string | undefined) ?? null };
}

/**
 * Offers of up to 20 ASINs in one call (getItemOffersBatch: about one call every 10 s).
 * Returns the raw offers payload per ASIN; ASINs that failed are absent.
 */
export async function amazonOffersBatch(asins: string[]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  if (!asins.length) return out;
  const json = await amazonFetch("/batches/products/pricing/v0/itemOffers", {
    method: "POST",
    body: JSON.stringify({ requests: asins.slice(0, 20).map(a => ({ uri: `/products/pricing/v0/items/${a}/offers`, method: "GET", MarketplaceId: AMAZON_BR_MARKETPLACE, ItemCondition: "New", CustomerType: "Consumer" })) }),
  }, 3, 10_000);
  for (const r of (Array.isArray(json?.responses) ? json.responses : []) as any[]) {
    const payload = r?.body?.payload;
    const asin = String(payload?.ASIN ?? r?.request?.Asin ?? "");
    if (r?.status?.statusCode === 200 && asin) out.set(asin, payload);
  }
  return out;
}
