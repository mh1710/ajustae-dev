/**
 * Regras puras da importação "Novos do fornecedor" (sem acesso a banco ou rede).
 * Os mesmos limites estão em supplier_catalog_candidates (SQL).
 */
import { buildShortDescription, fitTitle, normalizeNcm } from "./ml-prospect-prepare";
import { descriptionPlainText } from "./description-text";

export const SUPPLIER_IMPORT_LIMITS = {
  minCost: 10,
  maxCost: 1000,
  maxWeightKg: 30,
  maxLengthCm: 70,
} as const;
export const MIN_PHOTOS = 3;
export const MAX_PHOTOS = 18;
export const MIN_DESCRIPTION = 150;

/** Custo do fornecedor: PR → base → dropshipping → crossdocking (zero não conta). */
export function supplierCost(precos: Record<string, unknown> | null | undefined): number | null {
  for (const key of ["PR", "base", "dropshipping", "crossdocking"]) {
    const n = Number(precos?.[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export type Measures = {
  peso: number | null;
  altura: number | null;
  largura: number | null;
  comprimento: number | null;
};

/** Motivo de fora do limite; medidas ainda desconhecidas não reprovam (são completadas e reconferidas). */
export function eligibilityReason(cost: number | null, m: Measures): string | null {
  const L = SUPPLIER_IMPORT_LIMITS;
  if (cost == null || !(cost > L.minCost) || !(cost < L.maxCost))
    return `Custo fora da faixa (maior que R$ ${L.minCost} e menor que R$ ${L.maxCost}).`;
  if (Number(m.peso) >= L.maxWeightKg)
    return `Peso ${m.peso} kg: precisa ser menor que ${L.maxWeightKg} kg.`;
  const largest = Math.max(
    Number(m.altura) || 0,
    Number(m.largura) || 0,
    Number(m.comprimento) || 0,
  );
  if (largest > L.maxLengthCm) return `Maior medida ${largest} cm: máximo ${L.maxLengthCm} cm.`;
  return null;
}

export function positive(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Texto limpo (sem HTML) para medir e compor a descrição. */
export function plainText(html: string | null | undefined): string {
  return descriptionPlainText(html);
}

/** Fornecedor primeiro; o texto do catálogo do ML pelo mesmo EAN completa o que faltar. */
export function composeDescriptionBody(
  supplierText: string,
  mlText: string,
  mlAttributes: string[],
): string {
  const parts: string[] = [];
  const supplier = plainText(supplierText);
  if (supplier) parts.push(supplier);
  const ml = plainText(mlText);
  if (ml && !supplier.includes(ml.slice(0, 40))) parts.push(ml);
  if (parts.join(" ").length < MIN_DESCRIPTION && mlAttributes.length)
    parts.push(`Características: ${mlAttributes.slice(0, 15).join("; ")}.`);
  return parts.join(" ").slice(0, 3000).trim();
}

export function formatNcm(value: unknown): string | null {
  const n = normalizeNcm(value);
  return n ? `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6)}` : null;
}

export type SupplierDraft = {
  sku: string;
  nome: string;
  marca: string;
  ncm: string | null;
  gtin: string | null;
  peso: number | null;
  altura: number | null;
  largura: number | null;
  profundidade: number | null;
  fotos: string[];
  corpo: string;
  anatel: string;
  origem_fiscal: string | null;
};

/** O que ainda impede o produto de ficar 100% completo; vazio = pode ir para a auditoria. */
export function draftIssues(d: SupplierDraft): string[] {
  const out: string[] = [];
  if (!/^\d{8,14}$/.test(d.gtin ?? "")) out.push("EAN");
  if (!d.ncm) out.push("NCM");
  if (!d.marca.trim()) out.push("marca");
  if (!d.nome.trim()) out.push("título");
  const missing = [
    ["peso", d.peso],
    ["altura", d.altura],
    ["largura", d.largura],
    ["comprimento", d.profundidade],
  ]
    .filter(([, v]) => !(Number(v) > 0))
    .map(([k]) => String(k));
  out.push(...missing);
  if (d.fotos.length < MIN_PHOTOS) out.push(`${MIN_PHOTOS} fotos válidas (tem ${d.fotos.length})`);
  if (plainText(d.corpo).length < MIN_DESCRIPTION)
    out.push(`descrição com ${MIN_DESCRIPTION} caracteres`);
  return out;
}

export function draftLimitIssue(d: SupplierDraft): string | null {
  return eligibilityReason(1 + SUPPLIER_IMPORT_LIMITS.minCost, {
    peso: d.peso,
    altura: d.altura,
    largura: d.largura,
    comprimento: d.profundidade,
  });
}

export function draftProduct(d: SupplierDraft) {
  return {
    nome: fitTitle(d.nome, 60),
    marca: d.marca.trim(),
    ncm: d.ncm,
    gtin: d.gtin,
    peso: d.peso,
    altura: d.altura,
    largura: d.largura,
    profundidade: d.profundidade,
    imagem_principal_url: d.fotos[0] ?? null,
    url_imagens_externas: d.fotos.slice(0, MAX_PHOTOS).join("|"),
    descricao_curta: buildShortDescription(d.corpo, d.anatel),
    origem_fiscal: d.origem_fiscal,
  };
}
