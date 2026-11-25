import { completeMeasures, measureKeys, type ProspectMeasures } from "./ml-prospect-measures";

export type ProspectResearch = {
  brand: string | null;
  title_60: string | null;
  description: string | null;
  identity_note: string | null;
  ncm: { code: string | null; basis: "ean" | "classificacao" | null; source_url: string | null };
  anatel: { status: "codigo" | "nao_se_aplica" | "nao_encontrado"; code: string | null; source_url: string | null };
  measures: ProspectMeasures & { kind: "embalagem" | "produto" | null; source_url: string | null };
};

export const ANATEL_NOT_APPLICABLE = "Não se aplica";

export function normalizeNcm(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{8}$/.test(digits) && !/^0{8}$/.test(digits) ? digits : null;
}

export function normalizeAnatel(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (/^n[ãa]o se aplica$/i.test(text) || /^isent[oa]$/i.test(text)) return ANATEL_NOT_APPLICABLE;
  const m = text.match(/^(\d{5})-?(\d{2})-?(\d{5})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Research answers count only with a cited source; "não se aplica" depends on the product having no radio. */
export function researchAnatel(r: ProspectResearch | null): string | null {
  if (!r) return null;
  if (r.anatel.status === "codigo" && r.anatel.source_url) return normalizeAnatel(r.anatel.code);
  if (r.anatel.status === "nao_se_aplica") return ANATEL_NOT_APPLICABLE;
  return null;
}

export function researchNcm(r: ProspectResearch | null): { ncm: string; source: string } | null {
  const ncm = normalizeNcm(r?.ncm.code);
  if (!r || !ncm || !r.ncm.source_url) return null;
  return { ncm, source: `${r.ncm.basis === "ean" ? "Pesquisa pelo EAN" : "Classificação fiscal do tipo de produto"}: ${r.ncm.source_url}` };
}

/** Fill only missing fields with positive values from a cited source; existing values are never replaced. */
export function fillMeasures(base: ProspectMeasures, r: ProspectResearch | null) {
  const measures = { ...base };
  const sources: Partial<Record<keyof ProspectMeasures, string>> = {};
  if (!r?.measures.source_url) return { measures, sources };
  for (const key of measureKeys) {
    if (Number(base[key]) > 0) continue;
    const value = Number(r.measures[key]);
    if (Number.isFinite(value) && value > 0 && value < 10_000) {
      measures[key] = Math.round(value * 1000) / 1000;
      sources[key] = `Pesquisa (${r.measures.kind ?? "medidas"}): ${r.measures.source_url}`;
    }
  }
  return { measures, sources };
}

/** Garimpo never sends products above 30 kg or with a side above 70 cm, whatever the job asked for. */
export const PROSPECT_MAX_WEIGHT_KG = 30;
export const PROSPECT_MAX_LENGTH_CM = 70;
export function prospectLimits(params: { max_weight_kg?: unknown; max_length_cm?: unknown } | null | undefined) {
  const w = Number(params?.max_weight_kg);
  const l = Number(params?.max_length_cm);
  return {
    maxWeightKg: Math.min(w > 0 ? w : PROSPECT_MAX_WEIGHT_KG, PROSPECT_MAX_WEIGHT_KG),
    maxLengthCm: Math.min(l > 0 ? l : PROSPECT_MAX_LENGTH_CM, PROSPECT_MAX_LENGTH_CM),
  };
}

/**
 * Amazon fills only empty fields. Length/width/height are taken together from one Amazon set,
 * and only when all three are still empty, so a box is never mixed from two sources.
 */
export function fillFromAmazon(base: ProspectMeasures, amazon: { measures: ProspectMeasures }) {
  const measures = { ...base };
  const keys: (keyof ProspectMeasures)[] = [];
  const a = amazon.measures;
  const dims = ["length_cm", "width_cm", "height_cm"] as const;
  if (dims.every(k => !(Number(base[k]) > 0)) && dims.every(k => Number(a[k]) > 0)) {
    for (const k of dims) { measures[k] = Number(a[k]); keys.push(k); }
  }
  if (!(Number(base.weight_kg) > 0) && Number(a.weight_kg) > 0) { measures.weight_kg = Number(a.weight_kg); keys.push("weight_kg"); }
  return { measures, keys };
}

export function measureLimitIssue(m: ProspectMeasures, maxWeightKg: number, maxLengthCm: number): string | null {
  if (!completeMeasures(m)) return null;
  if (Number(m.weight_kg) > maxWeightKg) return `Peso ${m.weight_kg} kg acima do limite de ${maxWeightKg} kg do garimpo.`;
  const largest = Math.max(Number(m.length_cm), Number(m.width_cm), Number(m.height_cm));
  if (largest > maxLengthCm) return `Maior medida ${largest} cm acima do limite de ${maxLengthCm} cm do garimpo.`;
  return null;
}

export function fitTitle(title: string, max = 60): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > 20 ? cut.slice(0, space) : cut).replace(/[\s\-–|,;:]+$/, "").trim();
}

const WARRANTY = /garantia/i;

/** Removes markdown links, bare URLs and citation brackets returned by web research. */
export function cleanResearchText(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Body without any warranty mention, followed by the single standard footer the audit rules expect. */
export function buildShortDescription(body: string, anatel: string | null): string {
  // Linhas (<br>, parágrafos, itens) e frases são filtradas separadamente: uma linha
  // "Garantia: 365 dias" sai sozinha, sem levar junto um texto inteiro sem pontuação.
  const lines = body.replace(/<br\s*\/?>|<\/(?:p|li|div|h\d)>|\r?\n/gi, "\n").replace(/<[^>]+>/g, " ").split("\n")
    .map(line => line.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(s => s && !WARRANTY.test(s)).join(" ").trim())
    .filter(Boolean);
  const text = lines.join("<br>");
  const code = anatel ?? "a verificar";
  return `${text}${text ? "<br><br>" : ""}Garantia: 3 meses | Código Anatel: ${code} | Anvisa: Isento`;
}

/** Catalog text published by Mercado Livre for the same catalog product. */
export function catalogDescription(product: Record<string, any> | null | undefined): string {
  const short = String(product?.short_description?.content ?? "").trim();
  const features = Array.isArray(product?.main_features) ? product.main_features.map((f: any) => String(f?.text ?? "").trim()).filter(Boolean) : [];
  return [short, ...features].filter(Boolean).join(" ").slice(0, 2000);
}

export function catalogAttributes(product: Record<string, any> | null | undefined): string[] {
  const attrs = Array.isArray(product?.attributes) ? product.attributes : [];
  return attrs.filter((a: any) => a?.value_name).map((a: any) => `${a.name ?? a.id}: ${a.value_name}`);
}

/** What still needs data before the product can pass the audit. */
export function missingProspectData(row: { ean?: unknown; ncm?: unknown; marca?: unknown; pictures?: unknown } & Partial<ProspectMeasures>, anatel: string | null, description: string): string[] {
  const missing: string[] = [];
  if (!normalizeNcm(row.ncm)) missing.push("NCM");
  if (!anatel) missing.push("Anatel");
  if (!String(row.marca ?? "").trim()) missing.push("marca");
  for (const key of measureKeys) if (!(Number(row[key]) > 0)) missing.push(key);
  if (description.replace(/<[^>]+>/g, "").trim().length < 150) missing.push("descrição");
  return missing;
}

/** Live ML measures win; fields ML still omits keep the values gathered in preparation or review. */
export function keepPreparedMeasures(fresh: Partial<ProspectMeasures>, stored: Partial<ProspectMeasures>) {
  const measures = {} as ProspectMeasures;
  for (const key of measureKeys) {
    const live = Number(fresh[key]);
    const saved = Number(stored[key]);
    measures[key] = live > 0 ? live : saved > 0 ? saved : null;
  }
  return { measures, complete: completeMeasures(measures) };
}
