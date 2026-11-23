/** Todas as fotos do fornecedor, separadas por "|" (mesmo formato da Oderço). */
export function joinImages(raw: unknown): string | null {
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const seen = new Set<string>();
  for (const it of arr) {
    const s = it == null ? "" : String(it).trim();
    if (s) seen.add(s);
  }
  return seen.size ? [...seen].join("|") : null;
}
