// Planilha "vínculo de produtos multiloja" no layout exportado pelo Bling.
export const MULTISTORE_HEADER = [
  "IdProduto",
  "ID na Loja",
  "Nome",
  "Código",
  "Preco",
  "Preco Promocional",
  "ID do Fornecedor",
  "ID da Marca",
  "Link Externo",
  "Nome Loja (Multilojas)",
] as const;

export const PROMO_DISCOUNT = 0.05;

export type MultistoreRow = {
  bling_product_id: string;
  nome: string | null;
  codigo: string | null;
  preco: number | null;
};

function cell(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

function money(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",");
}

/** Preço promocional = preço com 5% de desconto, arredondado em centavos. */
export function promoPrice(preco: number | null): number | null {
  if (preco == null || !Number.isFinite(preco) || preco <= 0) return null;
  return Math.round(preco * (1 - PROMO_DISCOUNT) * 100) / 100;
}

export function multistoreLines(rows: MultistoreRow[], storeId: string, storeName: string): string[] {
  return rows.map((r) =>
    [
      r.bling_product_id,
      storeId,
      (r.nome ?? "").trim(),
      (r.codigo ?? "").trim(),
      money(r.preco),
      money(promoPrice(r.preco)),
      "0",
      "0",
      "0",
      storeName,
    ].map(cell).join(";"),
  );
}

/** Arquivo completo: BOM UTF-8, separador ";", aspas em tudo e quebra CRLF. */
export function buildMultistoreCsv(lines: string[]): string {
  return "\uFEFF" + [MULTISTORE_HEADER.map(cell).join(";"), ...lines].join("\r\n") + "\r\n";
}
