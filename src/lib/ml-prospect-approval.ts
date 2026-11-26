import type { RuleResult } from "./validation-rules/types";
import { prospectDeliveryMatches, prospectShippingMatches } from "./ml-prospect-shipping";

export type ProspectIssue = { rule: string; message: string };

/** Fail closed: warnings, unavailable rules and incomplete checks all block creation. */
export function prospectIssues(results: Array<{ rule: string; result: RuleResult }>): ProspectIssue[] {
  return results.filter(({ result }) => result.status !== "pass")
    .map(({ rule, result }) => ({ rule, message: result.message ?? "Verificação pendente." }));
}

export function prospectStock(qualifies: boolean, quantity: unknown, cap = 10): number {
  const n = Number(quantity);
  if (!qualifies || !Number.isFinite(n) || n <= 0) return 0;
  return Math.min(10, Math.max(0, cap), Math.floor(n));
}

export function prospectProfitOk(price: number, totalCost: number): boolean {
  return totalCost > 0 && price >= totalCost * 1.4;
}

export function prospectRequiredIssues(row: Record<string, any>): ProspectIssue[] {
  const issues: ProspectIssue[] = [];
  if (!String(row.ean ?? "").match(/^\d{8,14}$/)) issues.push({ rule: "ean-obrigatorio", message: "EAN não informado pelo Mercado Livre; precisa ser conferido." });
  if (!String(row.ncm ?? "").replace(/\D/g, "").match(/^\d{8}$/) || !row.raw?.review?.ncm_confirmed)
    issues.push({ rule: "ncm-obrigatorio", message: "NCM precisa de revisão individual; sugestões por semelhança não são aprovação." });
  if ((Array.isArray(row.pictures) ? row.pictures.length : 0) < 3)
    issues.push({ rule: "fotos-minimas", message: "Menos de 3 fotos JPG/PNG no Mercado Livre e no fornecedor com o mesmo EAN." });
  for (const key of ["weight_kg", "length_cm", "width_cm", "height_cm"]) {
    if (!(Number(row[key]) > 0)) issues.push({ rule: "dimensoes-peso-obrigatorios", message: `Peso/medida pendente: ${key}.` });
  }
  // Amazon: the rule is the Prime offer delivered by Amazon itself (no arrival date is published).
  const amazonOk = row.raw?.source === "amazon" && !!row.raw?.offer && Number(row.available_quantity) > 0;
  if (row.raw?.source === "amazon" ? !amazonOk : !prospectShippingMatches(row.raw?.shipping_mode, row.is_full === true, row.arrives_tomorrow === true, prospectDeliveryMatches(row.delivery_date, row.raw?.max_delivery_days)) || !(Number(row.available_quantity) > 0))
    issues.push({ rule: "oferta-ml", message: "Oferta com estoque não atende ao envio escolhido no garimpo." });
  const anatel = String(row.raw?.review?.anatel ?? "").trim();
  if (!row.raw?.review?.anatel_confirmed || !(/^(\d{5}-\d{2}-\d{5}|Não se aplica)$/i.test(anatel)))
    issues.push({ rule: "anatel", message: "Homologação Anatel ou Não se aplica precisa de revisão individual." });
  return issues;
}