/** An unassigned default supplier still has a link ID and must be updated, not recreated. */
export function supplierLinkWrite(linkId: string | null, body: Record<string, unknown>, purchasePrice?: number | null) {
  return {
    method: linkId ? 'PUT' as const : 'POST' as const,
    path: linkId ? `/produtos/fornecedores/${encodeURIComponent(linkId)}` : '/produtos/fornecedores',
    body: { ...body, ...(purchasePrice != null ? { precoCompra: purchasePrice } : {}) },
  };
}