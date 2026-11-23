import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mergeExactMeasures, measureKeys, type MeasureDonor, type ProspectMeasures } from "./ml-prospect-measures";
import {
  ANATEL_NOT_APPLICABLE, buildShortDescription, catalogAttributes, catalogDescription, cleanResearchText, fillMeasures,
  fitTitle, measureLimitIssue, missingProspectData, normalizeAnatel, normalizeNcm, researchAnatel, researchNcm,
  type ProspectResearch,
} from "./ml-prospect-prepare";

const db = supabaseAdmin as any;
const MAX_PHOTOS = 18;

function unique<T>(values: T[]): T | null {
  const set = [...new Set(values.filter(v => v !== null && v !== undefined && v !== ""))];
  return set.length === 1 ? set[0] ?? null : null;
}

function cm(value: unknown, unit: string | null): number | null {
  const n = Number(value);
  if (!(n > 0)) return null;
  if (/^metro/i.test(unit ?? "")) return n * 100;
  if (/^mil[ií]metro/i.test(unit ?? "")) return n / 10;
  return n;
}

/**
 * Gathers every value the audit needs from exact-EAN sources (supplier catalogs, products already
 * registered in Bling, imported Anatel base) and, for what is still missing, web research.
 * Everything is saved as an unconfirmed suggestion: NCM and Anatel keep their per-product confirmation.
 */
export async function prepareProspect(companyId: string, itemId: string) {
  const { data: item, error } = await db.from("ml_prospect_items").select("*").eq("id", itemId).single();
  if (error || !item) throw new Error("Produto garimpado não encontrado.");
  const { data: job } = await db.from("ml_prospect_jobs").select("params").eq("id", item.job_id).single();
  const params = job?.params ?? {};
  const ean: string | null = /^\d{8,14}$/.test(String(item.ean ?? "")) ? String(item.ean) : null;
  if (!ean) throw new Error("Produto sem EAN do Mercado Livre; não é possível buscar os dados com segurança.");
  const raw = item.raw ?? {};
  const review = raw.review ?? {};
  const confirmed = review.ncm_confirmed === true && review.anatel_confirmed === true;
  const sources: Record<string, string> = {};

  const [suppliers, registered, anatelBase] = await Promise.all([
    db.from("fornecedor_produtos").select("ncm,marca,peso,altura,largura,comprimento,descricao_tecnica").eq("codigobarras", ean).eq("ativo", true).limit(20),
    db.from("bling_products").select("ncm,marca,peso_bruto,peso_liquido,largura,altura,profundidade,unidade_medida").eq("gtin", ean).limit(20),
    db.from("anatel_products").select("codigo_anatel").eq("ean", ean).limit(5),
  ]);
  for (const r of [suppliers, registered, anatelBase]) if (r.error) throw new Error("Não foi possível consultar as bases internas pelo EAN.");
  const supplierRows = (suppliers.data ?? []) as any[];
  const registeredRows = (registered.data ?? []) as any[];

  // NCM: confirmed value stays; otherwise exact-EAN supplier, then products already registered with the same EAN.
  let ncm = normalizeNcm(item.ncm);
  let ncmSource: string | null = item.ncm_fonte ?? null;
  if (!confirmed || !ncm) {
    const fromSupplier = unique(supplierRows.map(r => normalizeNcm(r.ncm)));
    const fromRegistered = unique(registeredRows.map(r => normalizeNcm(r.ncm)));
    if (!ncm && fromSupplier) { ncm = fromSupplier; ncmSource = "Fornecedor com o mesmo EAN"; }
    else if (!ncm && fromRegistered) { ncm = fromRegistered; ncmSource = "Produto já cadastrado no Bling com o mesmo EAN"; }
  }

  // Measures: keep ML values; complete from exact-EAN donors whose values agree.
  const base: ProspectMeasures = { weight_kg: item.weight_kg, length_cm: item.length_cm, width_cm: item.width_cm, height_cm: item.height_cm };
  const donors: MeasureDonor[] = [
    ...supplierRows.map(r => ({ ean, source: "Fornecedor com o mesmo EAN", measures: { weight_kg: Number(r.peso) > 0 ? Number(r.peso) : null, length_cm: cm(r.comprimento, null), width_cm: cm(r.largura, null), height_cm: cm(r.altura, null) } })),
    ...registeredRows.map(r => ({ ean, source: "Produto já cadastrado no Bling com o mesmo EAN", measures: { weight_kg: Number(r.peso_bruto) > 0 ? Number(r.peso_bruto) : Number(r.peso_liquido) > 0 ? Number(r.peso_liquido) : null, length_cm: cm(r.profundidade, r.unidade_medida), width_cm: cm(r.largura, r.unidade_medida), height_cm: cm(r.altura, r.unidade_medida) } })),
  ];
  const merged = mergeExactMeasures(base, ean, donors);
  let measures = merged.measures;
  const measureSources: Record<string, string | string[]> = { ...(raw.measurement_sources ?? {}), ...merged.sources };

  let marca: string | null = String(item.marca ?? "").trim() || unique(supplierRows.map(r => String(r.marca ?? "").trim())) || null;
  let anatel = confirmed ? normalizeAnatel(review.anatel) : null;
  if (!anatel) {
    const code = unique(((anatelBase.data ?? []) as any[]).map(r => normalizeAnatel(r.codigo_anatel)).filter(c => c && c !== ANATEL_NOT_APPLICABLE));
    if (code) { anatel = code; sources.anatel = "Base Anatel importada (mesmo EAN)"; }
  }

  const product = raw.product ?? null;
  let body = cleanResearchText(catalogDescription(product));
  if (body.length < 150) body = cleanResearchText(unique(supplierRows.map(r => String(r.descricao_tecnica ?? "").trim())) ?? body);
  let title = String(review.titulo ?? "").trim() || String(item.titulo ?? "").trim();

  const preliminary = buildShortDescription(body, anatel);
  const missing = missingProspectData({ ...item, ncm, marca, ...measures }, anatel, preliminary);
  if (title.length > 60) missing.push("título");
  let research: ProspectResearch | null = null;
  let researchError: string | null = null;
  if (missing.length) {
    try {
      const { researchProspect } = await import("./ml-prospect-research.server");
      research = await researchProspect({ ean, title: String(item.titulo ?? ""), brand: marca, attributes: catalogAttributes(product), missing });
    } catch (e) { researchError = e instanceof Error ? e.message : "Falha na pesquisa na internet."; }
  }
  if (research) {
    const foundNcm = researchNcm(research);
    if (!ncm && foundNcm) { ncm = foundNcm.ncm; ncmSource = foundNcm.source; }
    const filled = fillMeasures(measures, research);
    measures = filled.measures;
    Object.assign(measureSources, filled.sources);
    if (!marca && research.brand?.trim()) { marca = research.brand.trim(); sources.marca = "Pesquisa na internet"; }
    if (!anatel) {
      anatel = researchAnatel(research);
      if (anatel) sources.anatel = anatel === ANATEL_NOT_APPLICABLE ? "Produto sem rádio/transmissor (pesquisa)" : `Pesquisa: ${research.anatel.source_url}`;
    }
    // A second, measures-only search when the general one left package data missing.
    const stillMissing = measureKeys.filter(k => !(Number(measures[k]) > 0));
    if (stillMissing.length) {
      try {
        const { researchProspect } = await import("./ml-prospect-research.server");
        const focused = await researchProspect({ ean, title: String(item.titulo ?? ""), brand: marca, attributes: catalogAttributes(product), missing: stillMissing, focus: "medidas" });
        const more = fillMeasures(measures, focused);
        measures = more.measures;
        Object.assign(measureSources, more.sources);
      } catch { /* missing measures stay editable in the confirmation */ }
    }
    const researched = cleanResearchText(research.description);
    if (body.length < 150 && researched.length > body.length) { body = researched; sources.descricao = "Pesquisa na internet"; }
    if (title.length > 60 && research.title_60) title = research.title_60;
  }
  title = fitTitle(title);
  const descricao = confirmed && review.descricao_curta ? String(review.descricao_curta) : buildShortDescription(body, anatel);
  const { completeProspectPictures } = await import("./ml-prospect-fiscal.server");
  const photos = await completeProspectPictures(ean, item.pictures);
  const pictures = photos.pictures.slice(0, MAX_PHOTOS);

  const nextRaw = {
    ...raw,
    measurement_sources: measureSources,
    review: { ...review, titulo: title, anatel: anatel ?? "", descricao_curta: descricao, ncm_confirmed: confirmed, anatel_confirmed: confirmed },
    prepared: { at: new Date().toISOString(), sources, identity_note: research?.identity_note ?? null, research_error: researchError },
  };
  const update = {
    ncm, ncm_fonte: ncmSource, marca, ...measures, pictures, pictures_count: pictures.length,
    thumbnail: item.thumbnail ?? pictures[0] ?? null, raw: nextRaw,
  };
  const { error: saveError } = await db.from("ml_prospect_items").update(update).eq("id", item.id);
  if (saveError) throw new Error(saveError.message);
  const row = { ...item, ...update };
  let supplierNote: string | null = null;
  try {
    const { ensureMlSupplier } = await import("./ml-prospect-supplier.server");
    const supplier = await ensureMlSupplier(companyId, { create: false });
    if (supplier.status === "ausente") supplierNote = "O fornecedor Mercado Livre (Código ML) será cadastrado no Bling desta empresa ao importar.";
  } catch (e) { supplierNote = e instanceof Error ? e.message : "Não foi possível conferir o fornecedor Mercado Livre no Bling."; }
  const blockers = await prospectBlockers(companyId, row, params);
  return { row, blockers: supplierNote ? [supplierNote, ...blockers.filter(b => !/Fornecedor do prefixo ML/.test(b))] : blockers, notes: supplierNote ? [supplierNote] : [] };
}

/** Fields the confirmation screen edits are reported there, so they are not repeated as blockers. */
const EDITABLE_RULES = new Set(["dimensoes-peso-obrigatorios", "anatel", "ncm-obrigatorio", "imagem-placeholder", "titulo-maximo", "marca-obrigatoria", "descricao-curta-minima"]);

/** Issues left if the user confirms NCM and Anatel as shown; photos are rechecked at import. */
export async function prospectBlockers(companyId: string, row: Record<string, any>, params: Record<string, any>) {
  const { reviewProspect } = await import("./ml-prospect-review.server");
  const review = row.raw?.review ?? {};
  const simulated = { ...row, raw: { ...row.raw, review: { ...review, ncm_confirmed: true, anatel_confirmed: true } } };
  const { issues } = await reviewProspect(companyId, simulated, false);
  const blockers = issues.filter(i => !EDITABLE_RULES.has(i.rule)).map(i => i.message);
  const limit = measureLimitIssue(row as ProspectMeasures, Number(params.max_weight_kg ?? 30), Number(params.max_length_cm ?? 70));
  if (limit) blockers.push(limit);
  return [...new Set(blockers)];
}

export { measureKeys };
