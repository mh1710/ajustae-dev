/**
 * Regras puras de "a base do fornecedor pode ser usada pela automação?".
 * - fresh: atualizada agora (ok há menos de 30 min; Evolusom ok/parcial).
 * - usable: o download falhou, mas a última base completa tem até 12 h e
 *   produtos — falha de download não apaga a base anterior, então seguir com
 *   ela não zera estoques.
 * - missing: sem base completa recente; a automação deve parar.
 */
export const SUPPLIER_MAX_AGE_MS = 30 * 60 * 1000;
export const SUPPLIER_FALLBACK_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type SupplierFreshnessRow = {
  codigo: string;
  product_count: number | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_ok_sync_at?: string | null;
};

export type SupplierFreshness = "fresh" | "usable" | "missing";

export function classifySupplier(row: SupplierFreshnessRow | undefined, now = Date.now()): SupplierFreshness {
  if (!row) return "missing";
  if (row.codigo === "evolusom") {
    if (row.last_sync_at && (row.last_sync_status === "ok" || row.last_sync_status === "parcial")) return "fresh";
  } else if (
    row.last_sync_status === "ok" && row.last_sync_at &&
    now - new Date(row.last_sync_at).getTime() < SUPPLIER_MAX_AGE_MS
  ) {
    return "fresh";
  }
  const okAt = row.last_ok_sync_at ? new Date(row.last_ok_sync_at).getTime() : NaN;
  if (Number(row.product_count ?? 0) > 0 && Number.isFinite(okAt) && now - okAt <= SUPPLIER_FALLBACK_MAX_AGE_MS) {
    return "usable";
  }
  return "missing";
}
