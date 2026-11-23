import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as any;

/**
 * Applies the daily garimpo stock rule right away (current catalog offers, cap 10, 40% margin,
 * consider-ML option) and queues the Bling stock send for products already created there.
 * A failed refresh keeps the stock computed at import.
 */
export async function refreshProspectStock(companyId: string, productIds: string[]) {
  if (!productIds.length) return { refreshed: 0, queued: 0 };
  const { getMlAccessToken, refreshCatalogProduct } = await import("@/lib/mercadolivre.server");
  const token = await getMlAccessToken();
  const { data: matches, error } = await db.from("ml_product_matches").select("product_id, catalog_product_id, zip_code").in("product_id", productIds);
  if (error) throw new Error(error.message);
  let refreshed = 0;
  for (const m of (matches ?? []) as { product_id: string; catalog_product_id: string | null; zip_code: string | null }[]) {
    if (!m.catalog_product_id) continue;
    try {
      const { alt_offers: _alt, ...outcome } = await refreshCatalogProduct(token, m.catalog_product_id, m.zip_code);
      await db.from("ml_product_matches").update({ ...outcome, checked_at: new Date().toISOString(), error: null }).eq("product_id", m.product_id);
      refreshed++;
    } catch { continue; }
    await db.rpc("sync_ml_prospect_catalog_stock", { _product_id: m.product_id });
  }
  const { data: queued } = await db.rpc("enqueue_ml_prospect_stock", { _company_id: companyId, _product_ids: productIds });
  return { refreshed, queued: Number(queued ?? 0) };
}
