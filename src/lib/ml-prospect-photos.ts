const PHOTO = /^https?:\/\/.+\.(jpe?g|png)(\?|$)/i;

/** ML photos first, then supplier photos (stored joined by "|") found by the exact same EAN. */
export function mergeProspectPictures(ml: unknown, supplierFotos: Array<string | null | undefined>): string[] {
  const base = Array.isArray(ml) ? ml.filter((u): u is string => typeof u === "string") : [];
  const extra = supplierFotos.flatMap(f => String(f ?? "").split("|")).map(u => u.trim());
  return [...new Set([...base, ...extra].filter(u => PHOTO.test(u)))];
}
