/** Photos may only come from an active, linked and audited product. */
export function isCorrectImageDonor(product: {
  situacao?: string | null; bling_product_id?: unknown; last_audit_at?: string | null;
  last_audit_errors?: number | null; last_audit_warnings?: number | null;
}) {
  return ["A", "Ativo", "ativo", "ATIVO"].includes(product.situacao ?? "")
    && Boolean(product.bling_product_id) && Boolean(product.last_audit_at)
    && product.last_audit_errors === 0 && product.last_audit_warnings === 0;
}

/** A donor with inaccessible/placeholder photos is not a correct photo source. */
export function correctDonorImages(urls: string[], verified: string[], min = 3, max = 18) {
  const unique = [...new Set(urls)];
  const valid = new Set(verified);
  if (unique.length < min || unique.length > max || unique.some(url => !valid.has(url))) return null;
  return unique;
}