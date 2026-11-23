export type ImportSupplier = {
  bling_supplier_id: string;
  supplier_codigo: string;
  supplier_name: string | null;
  codigo: string;
  preco_custo: number;
  descricao: string | null;
};

/** The create endpoint uses contato, not fornecedor.id from the links endpoint. */
export function importSupplierPayload(supplier: ImportSupplier) {
  const id = Number(supplier.bling_supplier_id);
  const cost = Number(supplier.preco_custo);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(cost) || cost <= 0 || !supplier.codigo.trim()) {
    throw new Error('Fornecedor de destino ou custo do produto inválido.');
  }
  return {
    contato: { id }, codigo: supplier.codigo.trim(), precoCusto: cost, precoCompra: cost,
    ...(supplier.descricao?.trim() ? { descricao: supplier.descricao.trim().slice(0,120) } : {}),
  };
}