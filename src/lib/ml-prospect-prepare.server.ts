import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mergeExactMeasures, measureKeys, type MeasureDonor, type ProspectMeasures } from "./ml-prospect-measures";
import {
  ANATEL_NOT_APPLICABLE, buildShortDescription, catalogDescription, cleanResearchText,
  fillFromAmazon, fitTitle, measureLimitIssue, normalizeAnatel, normalizeNcm, prospectLimits,
} from "./ml-prospect-prepare";
import type { MlEanData } from "./ml-ean-lookup.server";
import type { AmazonProduct } from "./amazon-catalog";

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
 * registered in Bling, imported Anatel base), then the Mercado Livre catalog and Amazon Brasil by the
 * same EAN. No credit-consuming AI or web research is used: what these sources lack stays pending.
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

  const { eanVariants } = await import("./ml-prospect-anatel");
  const eans = eanVariants(ean);
  const [suppliers, registered] = await Promise.all([
    db.from("fornecedor_produtos").select("codigo,ncm,marca,peso,altura,largura,comprimento,descricao_tecnica").eq("codigobarras", ean).eq("ativo", true).limit(20),
    db.from("bling_products").select("codigo,ncm,marca,peso_bruto,peso_liquido,largura,altura,profundidade,unidade_medida").eq("gtin", ean).limit(20),
  ]);
  for (const r of [suppliers, registered]) if (r.error) throw new Error("Não foi possível consultar as bases internas pelo EAN.");
  // Anatel base: same EAN (with or without leading zeros) or the SKU of a supplier/Bling product with that EAN.
  const sameEanCodes = [...new Set([...(suppliers.data ?? []), ...(registered.data ?? [])].map((r: any) => String(r.codigo ?? "").trim()).filter(Boolean))].slice(0, 40);
  const [anatelByEan, anatelByCode] = await Promise.all([
    db.from("anatel_products").select("codigo_anatel").in("ean", eans.length ? eans : [ean]).limit(20),
    sameEanCodes.length ? db.from("anatel_products").select("codigo_anatel").in("codigo", sameEanCodes).limit(20) : Promise.resolve({ data: [], error: null }),
  ]);
  if (anatelByEan.error || anatelByCode.error) throw new Error("Não foi possível consultar a base Anatel pelo EAN.");
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
  const product = raw.product ?? null;

  // Mercado Livre catalog products publishing the same exact EAN (free, no AI).
  let ml: MlEanData | null = null;
  let mlError: string | null = null;
  const initialBody = cleanResearchText(catalogDescription(product));
  const needsMl = measureKeys.some(k => !(Number(measures[k]) > 0)) || !marca || initialBody.length < 150 || (Array.isArray(item.pictures) ? item.pictures.length : 0) < 3;
  if (needsMl) {
    try {
      const { getMlAccessToken } = await import("./mercadolivre.server");
      const { lookupMlByEan } = await import("./ml-ean-lookup.server");
      ml = await lookupMlByEan(await getMlAccessToken(), ean, measures);
    } catch (e) { mlError = e instanceof Error ? e.message : "Falha na consulta ao catálogo do Mercado Livre."; }
  }
  if (ml?.found) {
    for (const key of measureKeys) {
      if (!(Number(measures[key]) > 0) && Number(ml.measures[key]) > 0) {
        measures = { ...measures, [key]: ml.measures[key] };
        measureSources[key] = ml.measureSources[key] ?? `Catálogo Mercado Livre (mesmo EAN)`;
      }
    }
    if (!marca && ml.brand) { marca = ml.brand; sources.marca = "Catálogo Mercado Livre (mesmo EAN)"; }
    sources.ml_catalogo = ml.catalogIds.join(", ");
  }

  // Amazon Brasil (same exact EAN) completes what ML and the internal bases left empty.
  let amazon: AmazonProduct | null = null;
  let amazonError: string | null = null;
  try {
    const { lookupAmazonByEan } = await import("./amazon-catalog.server");
    amazon = await lookupAmazonByEan(ean);
  } catch (e) { amazonError = e instanceof Error ? e.message : "Falha na consulta à Amazon."; }
  if (amazon) {
    const label = `Amazon (mesmo EAN, ASIN ${amazon.asin})`;
    const filled = fillFromAmazon(measures, amazon);
    measures = filled.measures;
    for (const key of filled.keys) measureSources[key] = `${label} — ${amazon.measures.kind ?? "medidas"}`;
    if (!ncm && amazon.ncm) { ncm = amazon.ncm; ncmSource = label; }
    if (!marca && amazon.brand) { marca = amazon.brand; sources.marca = label; }
    sources.amazon = label;
  }
  let anatel = confirmed ? normalizeAnatel(review.anatel) : null;
  if (!anatel) {
    const byEan = unique(((anatelByEan.data ?? []) as any[]).map(r => normalizeAnatel(r.codigo_anatel)).filter(c => c && c !== ANATEL_NOT_APPLICABLE));
    const byCode = unique(((anatelByCode.data ?? []) as any[]).map(r => normalizeAnatel(r.codigo_anatel)).filter(c => c && c !== ANATEL_NOT_APPLICABLE));
    if (byEan) { anatel = byEan; sources.anatel = "Base Anatel (mesmo EAN)"; }
    else if (byCode) { anatel = byCode; sources.anatel = "Base Anatel (SKU de fornecedor/Bling com o mesmo EAN)"; }
  }
  // Official Anatel homologations: exact model code from the ML sheet/title, same brand, single number.
  if (!anatel && marca) {
    const { anatelModelTokens, pickOfficialAnatel } = await import("./ml-prospect-anatel");
    const tokens = anatelModelTokens(product?.attributes, item.titulo).slice(0, 30);
    if (tokens.length) {
      const { data: models, error: modelError } = await db.from("anatel_homologacao_modelos").select("numero").in("modelo_norm", tokens).limit(200);
      if (modelError) throw new Error("Não foi possível consultar a base oficial da Anatel.");
      const numbers = [...new Set(((models ?? []) as any[]).map(m => String(m.numero)))].slice(0, 200);
      if (numbers.length) {
        const { data: homologs, error: homologError } = await db.from("anatel_homologacoes").select("numero,fabricante,solicitante,nome_comercial").in("numero", numbers);
        if (homologError) throw new Error("Não foi possível consultar a base oficial da Anatel.");
        const code = pickOfficialAnatel(homologs ?? [], marca);
        if (code) { anatel = code; sources.anatel = "Base oficial Anatel (modelo e marca iguais)"; }
      }
    }
  }
  // Products that clearly cannot transmit (title, category and ML sheet) get "Não se aplica"; others need a sourced code.
  if (!anatel) {
    const { prospectMayHaveRadio } = await import("./ml-prospect-anatel");
    if (!prospectMayHaveRadio({ title: item.titulo, categoryPath: item.category_path, domainId: item.domain_id, attributes: product?.attributes })) {
      anatel = ANATEL_NOT_APPLICABLE;
      sources.anatel = "Produto sem rádio/transmissor (título, categoria e ficha do Mercado Livre)";
    }
  }

  let body = initialBody;
  if (body.length < 150) body = cleanResearchText(unique(supplierRows.map(r => String(r.descricao_tecnica ?? "").trim())) ?? body);
  if (body.length < 150 && ml && ml.description.length > body.length) { body = cleanResearchText(ml.description); sources.descricao = "Catálogo Mercado Livre (mesmo EAN)"; }
  if (body.length < 150 && amazon && amazon.description.length > body.length) { body = cleanResearchText(amazon.description); sources.descricao = `Amazon (ASIN ${amazon.asin})`; }
  let title = String(review.titulo ?? "").trim() || String(item.titulo ?? "").trim();
  title = fitTitle(title);
  const descricao = confirmed && review.descricao_curta ? String(review.descricao_curta) : buildShortDescription(body, anatel);
  const { completeProspectPictures } = await import("./ml-prospect-fiscal.server");
  const photos = await completeProspectPictures(ean, item.pictures);
  let pictures = photos.pictures.slice(0, MAX_PHOTOS);
  if (pictures.length < 3 && ml?.pictures.length) {
    const { mergeProspectPictures } = await import("./ml-prospect-photos");
    pictures = mergeProspectPictures(pictures, ml.pictures).slice(0, MAX_PHOTOS);
    sources.fotos = "Catálogo Mercado Livre (mesmo EAN)";
  }
  if (pictures.length < 3 && amazon?.pictures.length) {
    const { mergeProspectPictures } = await import("./ml-prospect-photos");
    pictures = mergeProspectPictures(pictures, amazon.pictures).slice(0, MAX_PHOTOS);
    sources.fotos = sources.fotos ? `${sources.fotos} + Amazon (ASIN ${amazon.asin})` : `Amazon (ASIN ${amazon.asin})`;
  }

  const nextRaw = {
    ...raw,
    measurement_sources: measureSources,
    review: { ...review, titulo: title, anatel: anatel ?? "", descricao_curta: descricao, ncm_confirmed: confirmed, anatel_confirmed: confirmed },
    prepared: { at: new Date().toISOString(), sources, identity_note: null, research_error: null, ml_error: mlError, amazon_asin: amazon?.asin ?? null, amazon_error: amazonError },
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
  const { maxWeightKg, maxLengthCm } = prospectLimits(params);
  const limit = measureLimitIssue(row as ProspectMeasures, maxWeightKg, maxLengthCm);
  if (limit) blockers.push(limit);
  return [...new Set(blockers)];
}

export { measureKeys };
