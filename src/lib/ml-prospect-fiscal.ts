export function exactSupplierNcm(rows: Array<{ ncm?: string | null; codigo?: string | null }>) {
  const codes = [...new Set(rows.map(r => String(r.ncm ?? "").replace(/\D/g, "")).filter(n => /^\d{8}$/.test(n)))];
  if (codes.length !== 1) return null;
  return { ncm: codes[0], source: "Fornecedor com o mesmo EAN; revisão fiscal obrigatória" };
}