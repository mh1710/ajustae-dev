import { describe, expect, it } from "vitest";
import { buildMultistoreCsv, multistoreLines, promoPrice } from "./multistore-export";

describe("planilha multiloja", () => {
  it("preço promocional é 5% abaixo do preço", () => {
    expect(promoPrice(100)).toBe(95);
    expect(promoPrice(59.43)).toBe(56.46);
  });

  it("preenche loja, fornecedor, marca e link externo como pedido", () => {
    const [line] = multistoreLines(
      [{ bling_product_id: "16722672155", nome: "Smart Tv Box", codigo: "EV391093\t", preco: 200 }],
      "205304667",
      "Web Continental",
    );
    expect(line).toBe(
      '"16722672155";"205304667";"Smart Tv Box";"EV391093";"200,00";"190,00";"0";"0";"0";"Web Continental"',
    );
  });

  it("mantém o cabeçalho do Bling com BOM e CRLF", () => {
    const csv = buildMultistoreCsv([]);
    expect(csv.startsWith('\uFEFF"IdProduto";"ID na Loja";"Nome";"Código";"Preco";"Preco Promocional";"ID do Fornecedor";"ID da Marca";"Link Externo";"Nome Loja (Multilojas)"\r\n')).toBe(true);
  });
});
