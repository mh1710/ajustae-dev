// Serviço central da Política de Precificação — determina a margem correta
// segundo a faixa em que o preço de venda simulado se enquadra.
//
// Fórmula do preço de venda (markup por percentuais somados):
//   preco_venda = custo_completo / (1 - (margem + comissao + devolucao + taxa_promocao) / 100)
// Todos em %. Se a soma ≥ 100%, é matematicamente impossível — devolve null.

export type ProfitBand = {
  min: number;         // R$ inclusive
  max: number | null;  // R$ inclusive; null = sem teto (faixa mais alta)
  margin_percent: number;
};

export type PriceInputs = {
  custo_completo: number;
  comissao_percent: number;      // marketplace
  devolucao_percent: number;     // fornecedor
  taxa_promocao_percent: number; // fornecedor
};

export type PriceSimulation = {
  band: ProfitBand;
  margin_percent: number;
  preco_venda: number;
  lucro_liquido: number;
  matched: boolean;              // true se preço caiu dentro da faixa
  fallback_reason?: string;
};

const EPS = 0.005;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sortBands(bands: ProfitBand[]): ProfitBand[] {
  return [...bands].sort((a, b) => num(a.min) - num(b.min));
}

export function computePriceForMargin(
  inputs: PriceInputs,
  margin_percent: number,
): number | null {
  const custo = num(inputs.custo_completo);
  const somaPct =
    num(margin_percent) +
    num(inputs.comissao_percent) +
    num(inputs.devolucao_percent) +
    num(inputs.taxa_promocao_percent);
  if (somaPct >= 100 || custo <= 0) return null;
  return custo / (1 - somaPct / 100);
}

function priceFitsBand(preco: number, band: ProfitBand): boolean {
  const min = num(band.min);
  const max = band.max == null ? Infinity : num(band.max);
  return preco >= min - EPS && preco <= max + EPS;
}

/**
 * Percorre as faixas em ordem crescente e encontra a primeira em que o preço
 * simulado (com a margem daquela faixa) se enquadra na própria faixa.
 *
 * Estratégia:
 *  1. Ordena por `min` asc.
 *  2. Para cada faixa: calcula preco_venda com a margem daquela faixa.
 *  3. Se preco_venda ≤ max da faixa → é a faixa oficial.
 *  4. Se ultrapassa o teto, testa a próxima.
 *  5. Se nenhuma casar (caso raro de configuração inconsistente), usa a
 *     última faixa como fallback e sinaliza.
 */
export function pickPricingBand(
  bands: ProfitBand[],
  inputs: PriceInputs,
): PriceSimulation | null {
  const ordered = sortBands(bands);
  if (ordered.length === 0) return null;

  for (const band of ordered) {
    const preco = computePriceForMargin(inputs, band.margin_percent);
    if (preco == null) continue;
    if (priceFitsBand(preco, band)) {
      return {
        band,
        margin_percent: num(band.margin_percent),
        preco_venda: round2(preco),
        lucro_liquido: round2(preco * (num(band.margin_percent) / 100)),
        matched: true,
      };
    }
  }

  // Fallback: última faixa (maior teto). Se o preço estourou todas, mantém a
  // margem da última faixa; se ficou abaixo de todas, usa a primeira.
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const firstPrice = computePriceForMargin(inputs, first.margin_percent);
  const fallback = firstPrice != null && firstPrice < num(first.min) ? first : last;
  const preco = computePriceForMargin(inputs, fallback.margin_percent);
  if (preco == null) return null;
  return {
    band: fallback,
    margin_percent: num(fallback.margin_percent),
    preco_venda: round2(preco),
    lucro_liquido: round2(preco * (num(fallback.margin_percent) / 100)),
    matched: false,
    fallback_reason:
      fallback === last
        ? "Preço simulado ultrapassou todas as faixas — usando margem da faixa mais alta."
        : "Preço simulado ficou abaixo de todas as faixas — usando margem da faixa mais baixa.",
  };
}

export function fmtBandLabel(band: ProfitBand): string {
  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (band.max == null) return `Acima de ${brl(num(band.min))}`;
  return `De ${brl(num(band.min))} até ${brl(num(band.max))}`;
}

export type PriceAnchor = { min: number; max: number; price: number };

/**
 * Se o preço calculado cair dentro de [min, max] de qualquer âncora,
 * substitui pelo `price` daquela âncora. Caso contrário devolve o preço original.
 */
export function applyPriceAnchor(preco: number | null, anchors: PriceAnchor[] | null | undefined): number | null {
  if (preco == null) return null;
  if (!Array.isArray(anchors) || anchors.length === 0) return preco;
  for (const a of anchors) {
    const min = num(a.min);
    const max = num(a.max);
    const price = num(a.price);
    if (preco >= min - 0.005 && preco <= max + 0.005 && price > 0) {
      return Math.round(price * 100) / 100;
    }
  }
  return preco;
}
