/**
 * Pure rules for the Amazon Brasil garimpo: departments, discovery queue, Prime offer choice and SKU.
 * Only Prime offers fulfilled by Amazon count; cost = listing + shipping of the cheapest such offer.
 */
import { amazonEans } from "./amazon-catalog";
import { validGtin } from "./ml-prospect-gtin";

export type AmazonDepartment = { id: string; name: string };

/** Amazon.com.br root departments for objects (books, health/supplements and food are left out). */
export const AMAZON_DEPARTMENTS: AmazonDepartment[] = [
  { id: "16957183011", name: "Ferramentas e Materiais de Construção" },
  { id: "16209063011", name: "Eletrônicos e Tecnologia" },
  { id: "16339927011", name: "Computadores e Informática" },
  { id: "16191001011", name: "Casa" },
  { id: "16957126011", name: "Cozinha" },
  { id: "18914210011", name: "Automotivo" },
  { id: "18991022011", name: "Jardim e Piscina" },
  { id: "17349397011", name: "Esporte, Aventura e Lazer" },
  { id: "16194300011", name: "Brinquedos e Jogos" },
  { id: "16957240011", name: "Papelaria e Escritório" },
  { id: "18991196011", name: "Indústria e Comércio" },
  { id: "17242604011", name: "Bebês" },
  { id: "17365812011", name: "Moda" },
  { id: "16194415011", name: "Beleza" },
];

/** Amazon search requires keywords: department-only searches use these broad terms. */
export const AMAZON_SEED_KEYWORDS = ["kit", "jogo", "conjunto", "suporte", "organizador", "portátil", "elétrico", "profissional", "digital", "acessório"];

export type AmazonSearch = { keyword: string; classificationId: string | null; label: string };
export type AmazonDiscovery = { queue: AmazonSearch[]; pageToken: string | null; pages: number };

/** Every keyword × department pair (or keywords alone / seeds per department). */
export function amazonInitialDiscovery(keywords: string[], departmentIds: string[]): AmazonDiscovery {
  const departments = departmentIds.length ? AMAZON_DEPARTMENTS.filter(d => departmentIds.includes(d.id)) : [];
  const words = keywords.map(k => k.trim()).filter(Boolean);
  const queue: AmazonSearch[] = [];
  if (words.length && !departments.length) for (const k of words) queue.push({ keyword: k, classificationId: null, label: k });
  else {
    const list = departments.length ? departments : AMAZON_DEPARTMENTS;
    const terms = words.length ? words : AMAZON_SEED_KEYWORDS;
    for (const k of terms) for (const d of list) queue.push({ keyword: k, classificationId: d.id, label: `${d.name} · ${k}` });
  }
  return { queue, pageToken: null, pages: 0 };
}

/** Amazon caps each search at about 1000 results (50 pages of 20). */
export const AMAZON_MAX_PAGES = 50;

export function advanceAmazonDiscovery(state: AmazonDiscovery, nextToken: string | null): AmazonDiscovery {
  const pages = state.pages + 1;
  if (nextToken && pages < AMAZON_MAX_PAGES) return { ...state, pageToken: nextToken, pages };
  return { queue: state.queue.slice(1), pageToken: null, pages: 0 };
}

/** First check-digit-valid EAN (8–14 digits) published by the item. */
export function amazonItemEan(item: unknown): string | null {
  for (const raw of amazonEans(item)) {
    const digits = String(raw ?? "").replace(/\D/g, "");
    const ean = digits.length === 14 && digits.startsWith("0") ? digits.slice(1) : digits;
    if (/^\d{8,14}$/.test(ean) && validGtin(ean)) return ean;
  }
  return null;
}

export type AmazonPrimeOffer = { price: number; shipping: number; total: number; seller_id: string | null; prime_offers: number };

/** Cheapest new Prime offer fulfilled by Amazon; null when none exists. */
export function pickPrimeOffer(payload: unknown): AmazonPrimeOffer | null {
  const offers = Array.isArray((payload as any)?.Offers) ? (payload as any).Offers : [];
  const prime = offers.filter((o: any) =>
    o?.IsFulfilledByAmazon === true && o?.PrimeInformation?.IsPrime === true &&
    (!o?.SubCondition || String(o.SubCondition).toLowerCase() === "new") &&
    Number(o?.ListingPrice?.Amount) > 0 &&
    (!o?.ShippingTime?.availabilityType || o.ShippingTime.availabilityType === "NOW"));
  let best: AmazonPrimeOffer | null = null;
  for (const o of prime) {
    const price = Number(o.ListingPrice.Amount);
    const shipping = Number(o?.Shipping?.Amount) > 0 ? Number(o.Shipping.Amount) : 0;
    const total = Math.round((price + shipping) * 100) / 100;
    if (!best || total < best.total) best = { price, shipping, total, seller_id: o?.SellerId ? String(o.SellerId) : null, prime_offers: prime.length };
  }
  return best;
}

/** Amazon does not publish quantity: an available Prime offer counts as the stock cap. */
export const AMAZON_STOCK_CAP = 10;

export function amazonSku(ean: string): string {
  return `AMZ${String(ean).replace(/\D/g, "")}`;
}

export function amazonPermalink(asin: string): string {
  return `https://www.amazon.com.br/dp/${asin}`;
}

export function isAmazonProspect(row: { raw?: any } | null | undefined): boolean {
  return row?.raw?.source === "amazon";
}

/** SKU the prospect gets in Bling: AMZ + EAN for Amazon, ML + catalog number for Mercado Livre. */
export function prospectSku(row: { raw?: any; ean?: unknown; catalog_product_id?: unknown }): string {
  return isAmazonProspect(row) ? amazonSku(String(row.ean ?? "")) : `ML${String(row.catalog_product_id ?? "").replace(/^MLB/i, "")}`;
}
