export type RepasseAmounts = { custo_produto: number; quantidade: number; custo_etiqueta: number; custo_boy: number; custo_embalagem: number; repasse: number };
export function calculateRepasse(values: RepasseAmounts) {
  const cents = (value: number) => Math.round(value * 100);
  const qty = Math.max(1, Math.floor(values.quantidade));
  const costs = cents(values.custo_produto) * qty + cents(values.custo_etiqueta) + cents(values.custo_boy) + cents(values.custo_embalagem);
  const result = cents(values.repasse) - costs;
  return { custos: costs / 100, resultado: result / 100, divisao: Math.sign(result) * Math.round(Math.abs(result) / 2) / 100 };
}
