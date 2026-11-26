import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { RULE_REGISTRY } from "./validation-rules/registry";
import { prospectIssues, prospectRequiredIssues, prospectProfitOk, type ProspectIssue } from "./ml-prospect-approval";
import { computeCostBreakdown } from "./pricing/cost";
import { applyPriceAnchor, pickPricingBand } from "./pricing/margin";
import { inspectImage } from "./image-fingerprint.server";
import { isAmazonProspect, prospectSku } from "./amazon-prospect";
import type { AuditProduct, RuleResult } from "./validation-rules/types";

const db = supabaseAdmin as any;

/** Review stays in staging; rejected products never enter bling_products. */
export async function reviewProspect(companyId: string, row: Record<string, any>, checkPhotos = false) {
  const issues: ProspectIssue[] = prospectRequiredIssues(row);
  const sku = prospectSku(row);
  const amazon = isAmazonProspect(row);
  const [{ data: rules, error: rulesError }, { data: settings, error: settingsError }, { data: supplier, error: supplierError }] = await Promise.all([
    db.from("validation_rules").select("slug,config").eq("active", true).or(`company_id.is.null,company_id.eq.${companyId}`),
    db.from("pricing_settings").select("*").eq("company_id", companyId).maybeSingle(),
    db.rpc("resolve_import_product_supplier", { _company_id: companyId, _sku: sku, _fallback_cost: row.custo, _fallback_name: row.titulo }),
  ]);
  if (rulesError || settingsError || supplierError) throw new Error((rulesError || settingsError || supplierError).message);
  if (!supplier) issues.push({ rule: "fornecedor-vinculado", message: amazon ? "Fornecedor do prefixo AMZ não encontrado no Bling desta empresa. Atualize os fornecedores no Bling." : "Fornecedor do prefixo ML não encontrado no Bling desta empresa. Atualize os fornecedores no Bling." });
  let fee: number | null = null;
  const { data: store, error: storeError } = await db.from("bling_stores").select("marketplace_id").eq("company_id", companyId).eq("is_default", true).limit(1).maybeSingle();
  if (storeError) throw new Error(storeError.message);
  const marketplace = store?.marketplace_id ?? settings?.default_marketplace_id;
  if (marketplace) {
    const { data, error } = await db.rpc("company_marketplace_fee", { _company_id: companyId, _marketplace_id: marketplace });
    if (error) throw new Error(error.message);
    fee = data == null ? null : Number(data);
  }
  let price: number | null = null;
  if (settings && fee !== null) {
    const cost = computeCostBreakdown({ ...settings, valor_compra: Number(row.custo), embalagem: settings.embalagem_default, transporte: settings.transporte_default });
    const simulation = pickPricingBand(settings.profit_bands ?? [], { custo_completo: cost.custo_completo, comissao_percent: fee, devolucao_percent: 0, taxa_promocao_percent: 0 });
    price = applyPriceAnchor(simulation?.preco_venda ?? null, settings.price_anchors);
  }
  if (!(Number(price) > 0)) issues.push({ rule: "precificacao", message: "Política de preço e marketplace padrão precisam estar configurados." });
  if (!prospectProfitOk(Number(price), Number(row.total_price))) issues.push({ rule: "lucro-ml", message: `Preço calculado não atende o mínimo de 40% sobre a compra com frete ${amazon ? "na Amazon" : "no Mercado Livre"}.` });
  const review = row.raw?.review ?? {};
  const product = {
    id: row.id, codigo: sku, nome: review.titulo ?? row.titulo, marca: row.marca, ncm: row.ncm,
    preco: price, preco_custo: row.custo, estoque: 0, gtin: row.ean, situacao: "Ativo",
    peso_liquido: row.weight_kg, peso_bruto: row.weight_kg, largura: row.width_cm, altura: row.height_cm, profundidade: row.length_cm,
    unidade_medida: "Centímetros", condicao_produto: "Novo", tipo_producao: "Terceiros", cross_docking: "3",
    descricao_curta: review.descricao_curta ?? "", descricao_complementar: review.titulo ?? row.titulo,
    url_imagens_externas: (row.pictures ?? []).join("|"), imagem_principal_url: row.thumbnail,
  };
  const results: Array<{ rule: string; result: RuleResult }> = [];
  for (const rule of rules ?? []) {
    // Creation verifies the destination contact; no Bling product link exists yet.
    if (rule.slug === "fornecedor-vinculado") continue;
    // Staged source is the exact ML catalog ID and will be inserted atomically on import.
    if (rule.slug === "produto-em-fornecedor") continue;
    if (rule.slug === "imagem-placeholder") {
      if (!checkPhotos) { issues.push({ rule: rule.slug, message: "Fotos serão conferidas novamente antes do cadastro." }); continue; }
      const photos: string[] = row.pictures ?? [];
      for (let i = 0; i < photos.length; i += 6) {
        const statuses = await Promise.all(photos.slice(i, i + 6).map(async url => ({ url, status: await inspectImage(url) })));
        for (const photo of statuses) if (photo.status !== "valid") issues.push({ rule: rule.slug, message: `Foto inválida: ${photo.url}` });
      }
      continue;
    }
    const mod = RULE_REGISTRY[rule.slug];
    if (!mod) { issues.push({ rule: rule.slug, message: "Regra indisponível; cadastro bloqueado até ser conferida." }); continue; }
    try {
      const prepared = mod.prepare ? await mod.prepare({ companyId, supabaseAdmin, products: [product as AuditProduct] }, rule.config ?? {}) : undefined;
      results.push({ rule: rule.slug, result: await mod.evaluate(product as AuditProduct, rule.config ?? {}, prepared) });
    } catch (e) { issues.push({ rule: rule.slug, message: e instanceof Error ? e.message : "Falha na conferência." }); }
  }
  issues.push(...prospectIssues(results));
  return { issues, product, supplier, price };
}