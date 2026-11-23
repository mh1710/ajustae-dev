/** Cliente mínimo (SupabaseClient ou o admin-like do motor de auditoria). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = { from: (table: string) => any };

/**
 * Mapa central de prefixos de SKU → código do fornecedor.
 * Fonte única: tabela public.supplier_prefix_map (usada também pelas funções SQL
 * de precificação, auditoria, automações e envios ao Bling via map_supplier_prefix()).
 */

// Fallback estático (mesmos valores semeados na tabela) caso a leitura falhe.
export const FALLBACK_PREFIX_MAP: Record<string, string> = {
  ODS: "oderco",
  ODR: "oderco",
  O: "oderco",
  HX: "hayamax",
  HAY: "hayamax",
  HA: "hayamax",
  EVS: "evolusom",
  EV: "evolusom",
  E: "evolusom",
};

let cache: { map: Record<string, string>; at: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Carrega o mapa da tabela (cache de 5 min). Em caso de erro, usa o fallback. */
export async function loadSupplierPrefixMap(client: DbLike): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.map;
  try {
    const { data, error } = await client
      .from("supplier_prefix_map" as never)
      .select("prefix, supplier_codigo");
    if (error) throw error;
    const map: Record<string, string> = { ...FALLBACK_PREFIX_MAP };
    for (const row of (data ?? []) as unknown as { prefix: string; supplier_codigo: string }[]) {
      if (row?.prefix && row?.supplier_codigo) {
        map[String(row.prefix).toUpperCase()] = String(row.supplier_codigo);
      }
    }
    cache = { map, at: Date.now() };
    return map;
  } catch {
    return cache?.map ?? FALLBACK_PREFIX_MAP;
  }
}

export function parseSkuPrefix(sku: string): { prefix: string; numeric: string } | null {
  const m = (sku ?? "").trim().match(/^([A-Za-z]+)(.*)$/);
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), numeric: (m[2] ?? "").trim() };
}

export function supplierFromSku(sku: string, map: Record<string, string>): string | null {
  const parsed = parseSkuPrefix(sku);
  if (!parsed) return null;
  return map[parsed.prefix] ?? null;
}
