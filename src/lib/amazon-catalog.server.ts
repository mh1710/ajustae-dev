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
