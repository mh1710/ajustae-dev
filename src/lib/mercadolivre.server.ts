/**
 * Integração com a API do Mercado Livre (server-only).
 * Guarda tokens em public.ml_integration (linha única) e renova automaticamente.
 */

const ML_API = "https://api.mercadolibre.com";
const ML_AUTH = "https://auth.mercadolivre.com.br/authorization";
const SITE = "MLB";

function mlCredentials() {
  return {
    clientId: (process.env.MERCADOLIVRE_CLIENT_ID ?? "").trim(),
    clientSecret: (process.env.MERCADOLIVRE_CLIENT_SECRET ?? "").trim(),
  };
}

export function mlRedirectUri() {
  // O redirect precisa ser EXATAMENTE o cadastrado no painel do Mercado Livre.
  const base = (
    process.env.ML_REDIRECT_BASE_URL || "https://cloud-free-auditor.lovable.app"
  ).replace(/\/$/, "");
  return `${base}/api/public/mercadolivre/callback`;
}

export function mlAuthorizeUrl(state: string) {
  const { clientId } = mlCredentials();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: mlRedirectUri(),
    state,
  });
  return `${ML_AUTH}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  user_id?: number | string;
};

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json["message"] as string) ?? (json["error"] as string) ?? `HTTP ${res.status}`;
    throw new Error(`Mercado Livre: ${msg}`);
  }
  return json as unknown as TokenResponse;
}

export async function exchangeMlCode(code: string) {
  const { clientId, clientSecret } = mlCredentials();
  return postToken({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: mlRedirectUri(),
  });
}

/** Retorna um access token válido, renovando se necessário. */
export async function getMlAccessToken(): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row } = await supabaseAdmin
    .from("ml_integration")
    .select("id, access_token, refresh_token, token_expires_at, status")
    .eq("singleton", true)
    .maybeSingle();

  if (!row?.access_token) throw new Error("Mercado Livre não conectado.");

  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return row.access_token;

  if (!row.refresh_token) throw new Error("Mercado Livre: sessão expirada, reconecte.");

  try {
    const { clientId, clientSecret } = mlCredentials();
    const token = await postToken({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
    });
    await supabaseAdmin
      .from("ml_integration")
      .update({
        access_token: token.access_token,
        refresh_token: token.refresh_token ?? row.refresh_token,
        token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
        status: "conectada",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return token.access_token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseAdmin
      .from("ml_integration")
      .update({ status: "erro", last_error: msg, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    throw e;
  }
}

export const DEFAULT_ZIP = "87050160"; // Maringá/PR (87000000 não é um CEP válido para o ML)

/** CEPs "genéricos" (terminados em 000000) não existem no ML: usa o CEP válido da cidade. */
export function normalizeZip(input?: string | null): string {
  const digits = (input ?? "").replace(/\D/g, "");
  if (digits.length !== 8) return DEFAULT_ZIP;
  if (/0{6}$/.test(digits)) return DEFAULT_ZIP;
  return digits;
}

export type MlOffer = {
  item_id: string;
  price: number;
  shipping_cost: number;
  total_price: number;
  permalink: string | null;
  available_quantity: number;
  is_full: boolean;
};

export type MlSearchOutcome = {
  found: boolean;
  has_full: boolean;
  full_offers: number;
  total_offers: number;
  min_price: number | null;
  min_full_price: number | null;
  permalink: string | null;
  best_item_id: string | null;
  best_price: number | null;
  best_shipping_cost: number | null;
  best_total_price: number | null;
  best_is_full: boolean;
  available_quantity: number | null;
  has_stock: boolean;
  /** Atende às 2 regras: envio Full entregando no CEP de destino e com estoque. */
  qualifies: boolean;
  /** Até 3 ofertas qualificadas, da mais barata (preço + frete) para a mais cara. */
  top_offers: MlOffer[];
  /** Ofertas sem Full (só preenchido quando não existe nenhuma oferta Full). */
  alt_offers: MlOffer[];
  /** Produto de catálogo do ML que casou (permite recotar preço com 1 requisição). */
  catalog_product_id: string | null;
};



type MlItem = {
  id: string;
  price?: number;
  permalink?: string;
  status?: string;
  available_quantity?: number;
  shipping?: { logistic_type?: string; free_shipping?: boolean; cost?: number };
  inventory_id?: string | null;
};

type MlCatalogResult = { id?: string; catalog_product_id?: string; name?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET no ML com retry/backoff em 429 e 5xx (limite oficial: ~1.500 req/min por app). */
async function mlGet(token: string, url: string, attempt = 0): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 3) throw new Error(res.status === 429 ? "rate_limit" : `HTTP ${res.status}`);
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt;
    await sleep(Math.min(wait, 3000));
    return mlGet(token, url, attempt + 1);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Busca ML falhou (HTTP ${res.status})`);
  return (await res.json()) as Record<string, unknown>;
}

/** Busca no catálogo do ML (a API pública /sites/MLB/search foi bloqueada: 403). */
async function searchCatalog(token: string, query: string): Promise<MlCatalogResult[]> {
  const url = `${ML_API}/products/search?site_id=${SITE}&status=active&q=${encodeURIComponent(query)}`;
  const json = await mlGet(token, url);
  return ((json?.["results"] as MlCatalogResult[]) ?? []).filter((r) => r?.id);
}

/**
 * Ofertas ativas de um produto de catálogo.
 * O próprio endpoint já devolve preço e envio de cada anúncio — não dá para usar
 * /items?ids=..., porque o ML responde 403 (access_denied) para anúncios de terceiros.
 */
async function catalogOffers(token: string, productId: string): Promise<MlItem[]> {
  const json = await mlGet(token, `${ML_API}/products/${productId}/items?limit=20`);
  type Row = {
    id?: string;
    item_id?: string;
    price?: number;
    permalink?: string;
    shipping?: { logistic_type?: string; free_shipping?: boolean; cost?: number };
    inventory_id?: string | null;
  };
  const rows = (json?.["results"] as Row[]) ?? [];
  return rows
    .filter((r) => (r.item_id ?? r.id) && typeof r.price === "number")
    .map((r) => ({
      id: (r.item_id ?? r.id) as string,
      price: r.price,
      permalink: r.permalink ?? `https://www.mercadolivre.com.br/p/${productId}`,
      status: "active",
      // O catálogo só lista anúncios compráveis, então há estoque disponível.
      available_quantity: 1,
      shipping: r.shipping,
      inventory_id: r.inventory_id ?? null,
    }));
}

/** Frete real da oferta para um CEP. Retorna null quando o ML não informa. */
async function shippingCost(token: string, itemId: string, zip: string): Promise<number | null> {
  try {
    const json = await mlGet(
      token,
      `${ML_API}/items/${itemId}/shipping_options?zip_code=${encodeURIComponent(zip)}`,
    );
    const options = (json?.["options"] as { cost?: number; list_cost?: number }[]) ?? [];
    const costs = options
      .map((o) => (typeof o.cost === "number" ? o.cost : o.list_cost))
      .filter((c): c is number => typeof c === "number");
    return costs.length ? Math.min(...costs) : null;
  } catch {
    return null;
  }
}

/** Full = envio por fulfillment (estoque no galpão do ML). */
function isFull(o: MlItem) {
  return o.shipping?.logistic_type === "fulfillment";
}

const EMPTY: MlSearchOutcome = {
  found: false,
  has_full: false,
  full_offers: 0,
  total_offers: 0,
  min_price: null,
  min_full_price: null,
  permalink: null,
  best_item_id: null,
  best_price: null,
  best_shipping_cost: null,
  best_total_price: null,
  best_is_full: false,
  available_quantity: null,
  has_stock: false,
  qualifies: false,
  top_offers: [],
  alt_offers: [],
  catalog_product_id: null,

};

/**
 * Considera SOMENTE ofertas que atendem às duas regras:
 *  1. envio Full (fulfillment) que entrega no CEP de destino;
 *  2. com estoque disponível.
 * Entre as qualificadas, ordena por preço + frete e devolve as 3 mais baratas.
 */
async function summarize(
  token: string,
  productId: string,
  items: MlItem[],
  zip: string,
): Promise<MlSearchOutcome> {
  const active = items.filter((i) => (i.status ?? "active") === "active");
  const withStock = active.filter((i) => (i.available_quantity ?? 0) > 0);
  const eligible = withStock.filter((i) => isFull(i) && typeof i.price === "number");

  const prices = withStock.map((o) => o.price).filter((p): p is number => typeof p === "number");
  const fullPrices = eligible.map((o) => o.price).filter((p): p is number => typeof p === "number");

  // Frete: usa primeiro o que o próprio catálogo já informou (sem custo de requisição)
  // e só consulta o endpoint de frete das 3 mais baratas que não trouxeram essa informação.
  const priceOffers = async (list: MlItem[], allowLookup: boolean) => {
    const candidates = [...list].sort((a, b) => (a.price ?? 0) - (b.price ?? 0)).slice(0, 6);
    let lookups = 0;
    const priced = await Promise.all(
      candidates.map(async (item) => {
        let ship: number | null = null;
        if (item.shipping?.free_shipping) ship = 0;
        else if (typeof item.shipping?.cost === "number") ship = item.shipping.cost;
        if (ship === null && allowLookup && lookups < 3) {
          lookups += 1;
          ship = await shippingCost(token, item.id, zip);
        }
        // Continua sem frete = o ML não entrega esse item no CEP de destino -> descartado
        if (ship === null) return null;
        return {
          item_id: item.id,
          price: item.price ?? 0,
          shipping_cost: ship,
          total_price: (item.price ?? 0) + ship,
          permalink: item.permalink ?? null,
          available_quantity: item.available_quantity ?? 0,
          is_full: isFull(item),
        } satisfies MlOffer;
      }),
    );
    return priced
      .filter((o): o is MlOffer => o !== null)
      .sort((a, b) => a.total_price - b.total_price)
      .slice(0, 3);
  };

  const topOffers = await priceOffers(eligible, true);
  // Sem nenhuma oferta Full: guarda as mais baratas, sem gastar requisições extras.
  const altOffers =
    topOffers.length > 0
      ? []
      : await priceOffers(withStock.filter((i) => typeof i.price === "number"), false);

  const best = topOffers[0] ?? null;
  const totalStock = withStock.reduce((sum, o) => sum + (o.available_quantity ?? 0), 0);

  return {
    found: true,
    has_full: eligible.length > 0,
    full_offers: eligible.length,
    total_offers: withStock.length,
    min_price: prices.length ? Math.min(...prices) : null,
    min_full_price: fullPrices.length ? Math.min(...fullPrices) : null,
    permalink: best?.permalink ?? `https://www.mercadolivre.com.br/p/${productId}`,
    best_item_id: best?.item_id ?? null,
    best_price: best?.price ?? null,
    best_shipping_cost: best?.shipping_cost ?? null,
    best_total_price: best?.total_price ?? null,
    best_is_full: !!best,
    available_quantity: totalStock,
    has_stock: totalStock > 0,
    qualifies: !!best,
    top_offers: topOffers,
    alt_offers: altOffers,
    catalog_product_id: productId,
  };
}

/**
 * Recotação rápida: já sabemos em qual produto de catálogo o SKU casou,
 * então basta 1 requisição (ofertas do catálogo) para atualizar preços.
 */
export async function refreshCatalogProduct(
  token: string,
  catalogProductId: string,
  zip?: string | null,
): Promise<MlSearchOutcome & { match_by: string | null }> {
  const items = await catalogOffers(token, catalogProductId);
  if (items.length === 0) return { ...EMPTY, match_by: null, catalog_product_id: catalogProductId };
  return {
    ...(await summarize(token, catalogProductId, items, normalizeZip(zip))),
    match_by: "catalogo",
  };
}



/** Busca por EAN e, se não achar, por título. */
export async function mapProductOnMl(
  token: string,
  input: { ean?: string | null; nome?: string | null; zip?: string | null },
): Promise<MlSearchOutcome & { match_by: string | null }> {
  const zip = normalizeZip(input.zip);

  const resolve = async (productId: string, matchBy: string) => {
    const items = await catalogOffers(token, productId);
    return { ...(await summarize(token, productId, items, zip)), match_by: matchBy };
  };

  let fallback: (MlSearchOutcome & { match_by: string | null }) | null = null;

  const ean = (input.ean ?? "").replace(/\D/g, "");
  if (ean.length >= 8) {
    const byEan = await searchCatalog(token, ean);
    const id = byEan[0]?.id;
    if (id) {
      const r = await resolve(id, "ean");
      if (r.qualifies) return r;
      fallback = r;
    }
  }

  // O EAN já achou o produto certo no catálogo: buscar de novo pelo título só
  // gastaria requisições sem mudar o resultado.
  if (fallback) return fallback;

  const nome = (input.nome ?? "").trim();

  if (nome.length >= 4) {
    const query = nome.split(/\s+/).slice(0, 10).join(" ");
    const byName = await searchCatalog(token, query);
    const id = byName[0]?.id;
    if (id) {
      const r = await resolve(id, "titulo");
      if (r.qualifies || !fallback) return r.qualifies ? r : (fallback ?? r);
    }
  }

  if (fallback) return fallback;


  return { ...EMPTY, match_by: null };
}

