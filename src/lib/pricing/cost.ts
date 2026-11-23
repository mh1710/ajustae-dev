// Serviço central de composição de custo.
// Toda a lógica fica aqui para evitar duplicação — a UI apenas monta as entradas
// e exibe os resultados. Preparado para receber novos componentes futuramente
// (ex.: seguro, armazenagem, publicidade, logística reversa, etc.) sem alterar
// os consumidores existentes.

export type CostInputs = {
  valor_compra: number;
  embalagem: number;
  transporte: number;
  // Configuração da taxa operacional
  taxa_operacional_valor: number;
  taxa_operacional_min_custo: number; // se valor_compra < min, não aplica
  // Percentuais (0-100)
  frete_medio_percent: number;
  custo_fixo_percent: number;
  devolucao_percent: number;
  // Extensibilidade futura: campos opcionais adicionais somam ao custo completo
  extras?: Array<{ label: string; valor: number }>;
};

export type CostBreakdown = {
  valor_compra: number;
  embalagem: number;
  transporte: number;
  taxa_operacional: number;
  taxa_operacional_aplicada: boolean;
  cmv: number;
  frete: number;
  cmv_total: number;
  custo_fixo: number;
  devolucao: number;
  extras_total: number;
  custo_completo: number;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeCostBreakdown(input: CostInputs): CostBreakdown {
  const valor_compra = num(input.valor_compra);
  const embalagem = num(input.embalagem);
  const transporte = num(input.transporte);

  const taxa_op_valor = num(input.taxa_operacional_valor);
  const taxa_op_min = num(input.taxa_operacional_min_custo);
  const taxa_operacional_aplicada = valor_compra >= taxa_op_min && taxa_op_valor > 0;
  const taxa_operacional = taxa_operacional_aplicada ? taxa_op_valor : 0;

  const cmv = valor_compra + embalagem + transporte + taxa_operacional;
  const frete = cmv * (num(input.frete_medio_percent) / 100);
  const cmv_total = cmv + frete;
  const custo_fixo = cmv_total * (num(input.custo_fixo_percent) / 100);
  const devolucao = cmv_total * (num(input.devolucao_percent) / 100);
  const extras_total = (input.extras ?? []).reduce((s, e) => s + num(e.valor), 0);
  const custo_completo = cmv_total + custo_fixo + devolucao + extras_total;

  return {
    valor_compra: round2(valor_compra),
    embalagem: round2(embalagem),
    transporte: round2(transporte),
    taxa_operacional: round2(taxa_operacional),
    taxa_operacional_aplicada,
    cmv: round2(cmv),
    frete: round2(frete),
    cmv_total: round2(cmv_total),
    custo_fixo: round2(custo_fixo),
    devolucao: round2(devolucao),
    extras_total: round2(extras_total),
    custo_completo: round2(custo_completo),
  };
}

export function fmtBRL(n: number): string {
  return num(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
