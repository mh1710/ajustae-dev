import { parseAmazonItem } from "./amazon-catalog";
import { amazonOffersBatch, searchAmazonCatalog, AmazonBusyError } from "./amazon-catalog.server";
import {
  advanceAmazonDiscovery, amazonInitialDiscovery, amazonItemEan, amazonPermalink, pickPrimeOffer,
  AMAZON_STOCK_CAP, type AmazonDiscovery,
} from "./amazon-prospect";
import { excludedProspectType } from "./ml-prospect-scope";

type Db = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };
const PRICING_GAP_MS = 10_500;

export type AmazonTickResult = { status: "continua" | "concluido" | "aguardando"; message?: string };

/**
 * One cycle of the Amazon garimpo: one catalog page (20 products), then one Prime-offer batch for the
 * products that passed the catalog checks. Candidates get a final status in the same cycle.
 */
export async function runAmazonProspectTick(db: Db, job: Record<string, any>): Promise<AmazonTickResult> {
  const params = job.params ?? {};
  const target = Number(job.target ?? 100);
  let found = Number(job.found ?? 0);
  const state: AmazonDiscovery = params.amazon ?? amazonInitialDiscovery(params.keywords ?? [], params.departments ?? []);
  if (found >= target) return { status: "concluido" };
  const search = state.queue[0];
  if (!search) return { status: "concluido", message: `Busca esgotada na Amazon: ${found} de ${target} produtos encontrados.` };

  const wait = Number(params.amazon_pricing_at ?? 0) + PRICING_GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, Math.min(wait, PRICING_GAP_MS)));

  let page: Awaited<ReturnType<typeof searchAmazonCatalog>>;
  try { page = await searchAmazonCatalog(search.keyword, search.classificationId, state.pageToken); }
  catch (e) { if (e instanceof AmazonBusyError) return { status: "aguardando", message: e.message }; throw e; }

  const maxWeight = Math.min(30, Number(params.max_weight_kg ?? 30));
  const maxLength = Math.min(70, Number(params.max_length_cm ?? 70));
  const quick = params.quick_collect === true;
  type Cand = { asin: string; ean: string | null; item: any; parsed: ReturnType<typeof parseAmazonItem>; category: string | null; reason: string | null };
  const cands: Cand[] = page.items.map((item: any) => {
    const parsed = parseAmazonItem(item);
    const ean = amazonItemEan(item);
    const category = (item?.classifications?.[0]?.classifications?.[0]?.displayName as string | undefined) ?? null;
    let reason: string | null = null;
    const m = parsed.measures;
    const largest = Math.max(Number(m.length_cm) || 0, Number(m.width_cm) || 0, Number(m.height_cm) || 0);
    if (!ean) reason = "sem EAN publicado na Amazon";
    else if (excludedProspectType(null, category, parsed.title)) reason = "produto para ingestão ou não é objeto";
    else if (!quick && Number(m.weight_kg) > maxWeight) reason = `peso ${m.weight_kg} kg`;
    else if (!quick && largest > maxLength) reason = `comprimento ${largest} cm`;
    else if (!quick && params.require_measures && !(m.weight_kg && m.length_cm && m.width_cm && m.height_cm)) reason = "peso/medidas não informados pela Amazon";
    else if (!quick && parsed.pictures.length < 3) reason = `apenas ${parsed.pictures.length} foto(s) JPG/PNG`;
    return { asin: parsed.asin, ean, item, parsed, category, reason };
  }).filter((c: Cand) => c.asin);

  // Already in the account (same EAN) or already found in this search.
  const eans = [...new Set(cands.filter(c => !c.reason && c.ean).map(c => c.ean as string))];
  if (eans.length) {
    const [{ data: existing }, { data: staged }] = await Promise.all([
      db.from("bling_products").select("gtin, gtin_embalagem").or(`gtin.in.(${eans.join(",")}),gtin_embalagem.in.(${eans.join(",")})`),
      db.from("ml_prospect_items").select("ean").eq("job_id", job.id).in("ean", eans),
    ]);
    const owned = new Set<string>();
    for (const r of (existing ?? []) as any[]) for (const v of [r.gtin, r.gtin_embalagem]) if (v) owned.add(String(v).replace(/\D/g, ""));
    const dup = new Set(((staged ?? []) as any[]).map(r => String(r.ean)));
    for (const c of cands) if (!c.reason && c.ean) { if (owned.has(c.ean)) c.reason = "já existe na conta"; else if (dup.has(c.ean)) c.reason = "mesmo EAN já encontrado nesta busca"; }
  }
  const seen = new Set<string>();
  for (const c of cands) if (!c.reason && c.ean) { if (seen.has(c.ean)) c.reason = "mesmo EAN já encontrado nesta busca"; seen.add(c.ean); }

  const pending = cands.filter(c => !c.reason);
  let offers = new Map<string, unknown>();
  let pricingAt = params.amazon_pricing_at ?? null;
  if (pending.length) {
    try { offers = await amazonOffersBatch(pending.map(c => c.asin)); pricingAt = Date.now(); }
    catch (e) { if (e instanceof AmazonBusyError) return { status: "aguardando", message: e.message }; throw e; }
  }

  const { lookupProspectNcm, completeProspectPictures } = await import("./ml-prospect-fiscal.server");
  const rows: Record<string, unknown>[] = [];
  for (const c of pending) {
    if (found + rows.length >= target) { c.reason = "meta atingida"; continue; }
    if (!offers.has(c.asin)) { c.reason = "preço não informado pela Amazon"; continue; }
    const offer = pickPrimeOffer(offers.get(c.asin));
    if (!offer) { c.reason = "sem oferta Prime entregue pela Amazon"; continue; }
    if (offer.total > Number(params.max_cost ?? 1000)) { c.reason = `oferta Prime acima do custo (R$ ${offer.total.toFixed(2)})`; continue; }
    const p = c.parsed;
    let ncm = p.ncm; let ncmSource: string | null = p.ncm ? `Amazon (ASIN ${c.asin})` : null;
    try { const hit = await lookupProspectNcm(c.ean); if (hit?.ncm) { ncm = hit.ncm; ncmSource = hit.source; } } catch { /* sem sugestão */ }
    let pictures = p.pictures;
    try { pictures = (await completeProspectPictures(c.ean, p.pictures)).pictures; } catch { /* conferidas no cadastro */ }
    const sources: Record<string, string> = {};
    for (const k of ["weight_kg", "length_cm", "width_cm", "height_cm"] as const) if (p.measures[k]) sources[k] = `Amazon (ASIN ${c.asin}) — ${p.measures.kind ?? "medidas"}`;
    rows.push({
      job_id: job.id, catalog_product_id: c.asin, item_id: c.asin, ean: c.ean, titulo: p.title, marca: p.brand,
      domain_id: null, category_id: search.classificationId, category_path: c.category,
      permalink: amazonPermalink(c.asin), thumbnail: pictures[0] ?? null, pictures: pictures.slice(0, 18), pictures_count: Math.min(18, pictures.length),
      custo: offer.total, garantia: "3 meses", crossdocking: 3, price: offer.price, shipping_cost: offer.shipping, total_price: offer.total,
      available_quantity: AMAZON_STOCK_CAP, is_full: true, arrives_tomorrow: false, delivery_date: null,
      weight_kg: p.measures.weight_kg, length_cm: p.measures.length_cm, width_cm: p.measures.width_cm, height_cm: p.measures.height_cm,
      seller_id: offer.seller_id, ncm, ncm_fonte: ncmSource,
      raw: { source: "amazon", asin: c.asin, search: search.label, offer, amazon: p, measurement_sources: sources, identity: { ean_source: "Amazon (identificadores do produto)" }, description: p.description },
    });
  }
  if (rows.length) {
    const { error } = await db.from("ml_prospect_items").upsert(rows, { onConflict: "job_id,catalog_product_id" });
    if (error) throw new Error(error.message);
    found += rows.length;
  }
  const approved = new Set(rows.map(r => r.catalog_product_id as string));
  if (cands.length) {
    const { error } = await db.from("ml_prospect_candidates").upsert(
      cands.map(c => ({ job_id: job.id, catalog_product_id: c.asin, source: "amazon", source_label: search.label, status: approved.has(c.asin) ? "aprovado" : "descartado", reason: approved.has(c.asin) ? null : c.reason })),
      { onConflict: "job_id,catalog_product_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
  }
  const { count } = await db.from("ml_prospect_candidates").select("id", { count: "exact", head: true }).eq("job_id", job.id);
  const next = advanceAmazonDiscovery(state, page.nextToken);
  const update = {
    params: { ...params, amazon: next, amazon_pricing_at: pricingAt },
    processed: Number(job.processed ?? 0) + cands.length, found, candidates_total: count ?? 0,
    status: "processando", error: null, updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("ml_prospect_jobs").update(update).eq("id", job.id).eq("cancel_requested", false);
  if (error) throw new Error(error.message);
  if (found >= target) return { status: "concluido" };
  if (!next.queue.length) return { status: "concluido", message: `Busca esgotada na Amazon: ${found} de ${target} produtos encontrados.` };
  return { status: "continua" };
}

/** Live recheck before the Bling send: the cheapest Prime offer must still exist within the cost limit. */
export async function freshAmazonOffer(item: Record<string, any>, params: Record<string, any>):
  Promise<{ ok: true; row: Record<string, any> } | { ok: false; reason: string }> {
  const asin = String(item.raw?.asin ?? item.catalog_product_id ?? "");
  let offers: Map<string, unknown>;
  try { offers = await amazonOffersBatch([asin]); }
  catch (e) { throw new Error(`Não foi possível conferir a oferta Prime na Amazon agora (${e instanceof Error ? e.message : String(e)}). O produto continua na lista.`); }
  if (!offers.has(asin)) return { ok: false, reason: "a Amazon não informou o preço agora; tente de novo em instantes" };
  const offer = pickPrimeOffer(offers.get(asin));
  if (!offer) return { ok: false, reason: "sem oferta Prime entregue pela Amazon" };
  if (offer.total > Number(params?.max_cost ?? 1000)) return { ok: false, reason: `oferta Prime acima do custo (R$ ${offer.total.toFixed(2)})` };
  return {
    ok: true,
    row: {
      ean: item.ean, pictures: Array.isArray(item.pictures) ? item.pictures : [], thumbnail: item.thumbnail ?? null, marca: item.marca ?? null,
      price: offer.price, shipping_cost: offer.shipping, total_price: offer.total, custo: offer.total, seller_id: offer.seller_id,
      available_quantity: AMAZON_STOCK_CAP, raw: { ...(item.raw ?? {}), offer, offer_checked_at: new Date().toISOString() },
    },
  };
}
