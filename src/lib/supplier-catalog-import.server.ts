/**
 * Worker da importação "Novos do fornecedor" (server-only).
 * Cron de 10 s chama a rota só com tarefa vencida e sem lease; cada chamada
 * processa lotes por até ~45 s: completa dados (fornecedor → outros fornecedores/
 * Bling pelo EAN → catálogo do Mercado Livre pelo EAN), confere todas as fotos,
 * roda todas as regras ativas da auditoria e só cria no Bling os 100% aprovados.
 * Modo "escanear" faz a mesma preparação e conferência sem cadastrar nada e
 * guarda o resultado por produto (supplier_catalog_scan).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { RULE_REGISTRY } from "./validation-rules/registry";
import type { AuditProduct } from "./validation-rules/types";
import { inspectImage } from "./image-fingerprint.server";
import { lookupMlByEan } from "./ml-ean-lookup.server";
import { validGtin } from "./ml-prospect-gtin";
import { lookupProspectNcm } from "./ml-prospect-fiscal.server";
import { ANATEL_NOT_APPLICABLE } from "./ml-prospect-prepare";
import {
  MAX_PHOTOS, MIN_DESCRIPTION, MIN_PHOTOS, composeDescriptionBody, draftIssues, draftLimitIssue, draftProduct,
  formatNcm, plainText, positive, type SupplierDraft,
} from "./supplier-catalog-draft";

const db = supabaseAdmin as any;
const LEASE_MS = 120_000;
const BUDGET_MS = 45_000;
const BATCH = 5;
const SCAN_BATCH = 8;
const PHOTO = /^https?:\/\/.+\.(jpe?g|png)(\?|$)/i;

type Job = Record<string, any> & { id: string; company_id: string; fornecedor_id: string; prefix: string };
type Item = { id: string; fornecedor_produto_id: string; codigo: string; sku: string; titulo: string | null };
type Quote = { fornecedor_produto_id: string; custo: number | null; preco: number | null; estoque: number | null };
type Prepared = { item: Item; draft?: SupplierDraft; issues: string[]; sources: Record<string, unknown>; quote?: Quote; error?: string };

function checked<T extends { error: any }>(r: T): T {
  if (r.error) throw new Error(r.error.message ?? String(r.error));
  return r;
}

async function validPhotos(urls: string[], blocked: Set<string>, limit: number) {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (let i = 0; i < urls.length && valid.length < limit; i += 6) {
    const slice = urls.slice(i, i + 6);
    const statuses = await Promise.all(slice.map(async u => {
      if (blocked.has(u)) return "placeholder" as const;
      try { return await inspectImage(u); } catch { return "unknown" as const; }
    }));
    slice.forEach((u, k) => (statuses[k] === "valid" ? valid : invalid).push(u));
  }
  return { valid: valid.slice(0, limit), invalid };
}

async function bestNcm(ean: string): Promise<{ ncm: string; source: string } | null> {
  const fromSupplier = await lookupProspectNcm(ean).catch(() => null);
  if (fromSupplier) return { ncm: fromSupplier.ncm, source: "Outro fornecedor com o mesmo EAN" };
  const { data } = await db.from("bling_products").select("ncm").eq("gtin", ean).not("ncm", "is", null).limit(50);
  const codes = [...new Set(((data ?? []) as { ncm: string }[]).map(r => String(r.ncm).replace(/\D/g, "")).filter(n => /^\d{8}$/.test(n)))];
  return codes.length === 1 ? { ncm: codes[0]!, source: "Produto já cadastrado no Bling com o mesmo EAN" } : null;
}

/** Fotos de produtos ativos de outras empresas com o mesmo EAN exato (sem conferir aqui). */
async function blingDonorPhotos(ean: string, companyId: string): Promise<string[]> {
  const { data } = await db.from("bling_products").select("imagem_principal_url,url_imagens_externas")
    .eq("gtin", ean).eq("situacao", "Ativo").neq("company_id", companyId).limit(20);
  const urls = ((data ?? []) as Array<{ imagem_principal_url: string | null; url_imagens_externas: string | null }>)
    .flatMap(r => [r.imagem_principal_url ?? "", ...String(r.url_imagens_externas ?? "").split("|")])
    .map(u => u.trim().replace(/^http:/, "https:")).filter(u => PHOTO.test(u));
  return [...new Set(urls)];
}

export async function prepareItem(job: Job, item: Item, fp: Record<string, any> | undefined, quote: Quote | undefined, mlToken: string | null, blocked: Set<string>): Promise<Prepared> {
  const sources: Record<string, unknown> = {};
  if (!fp) return { item, issues: ["Produto não está mais ativo no fornecedor."], sources };
  const ean = String(fp.codigobarras ?? "").replace(/\D/g, "");
  const draft: SupplierDraft = {
    sku: item.sku,
    nome: String(fp.titulo ?? fp.nome_nota ?? "").trim(),
    marca: String(fp.marca ?? "").trim(),
    ncm: formatNcm(fp.ncm),
    gtin: validGtin(ean) ? ean : null,
    peso: positive(fp.peso), altura: positive(fp.altura), largura: positive(fp.largura), profundidade: positive(fp.comprimento),
    fotos: [], corpo: String(fp.descricao_tecnica ?? ""), anatel: ANATEL_NOT_APPLICABLE,
    origem_fiscal: /^\d$/.test(String(fp.origem ?? "").trim()) ? String(fp.origem).trim() : "0",
  };
  if (!draft.gtin) return { item, draft, issues: [/^\d{8,14}$/.test(ean)
    ? `EAN do fornecedor (${ean}) tem dígito verificador inválido; o Bling recusa o cadastro.`
    : "Sem EAN válido no fornecedor; não dá para buscar no Mercado Livre."], sources };

  if (!draft.ncm) {
    const found = await bestNcm(draft.gtin);
    if (found) { draft.ncm = formatNcm(found.ncm); sources.ncm = found.source; }
  }

  // Fotos: do fornecedor primeiro; o Mercado Livre pelo EAN completa o mínimo.
  const supplierPhotos = [...new Set(String(fp.foto ?? "").split("|").map(u => u.trim()).filter(u => PHOTO.test(u)))];
  const sp = await validPhotos(supplierPhotos, blocked, MAX_PHOTOS);
  draft.fotos = sp.valid;
  if (sp.invalid.length) sources.fotos_invalidas = sp.invalid.length;

  const needsMl = !draft.marca || draft.fotos.length < MIN_PHOTOS || plainText(draft.corpo).length < MIN_DESCRIPTION
    || !(draft.peso && draft.altura && draft.largura && draft.profundidade);
  if (needsMl && mlToken) {
    try {
      const ml = await lookupMlByEan(mlToken, draft.gtin, { weight_kg: draft.peso, length_cm: draft.profundidade, width_cm: draft.largura, height_cm: draft.altura });
      sources.ml_catalogo = ml.catalogIds;
      if (ml.found) {
        const before = { peso: draft.peso, altura: draft.altura, largura: draft.largura, profundidade: draft.profundidade };
        draft.peso = draft.peso ?? positive(ml.measures.weight_kg);
        draft.altura = draft.altura ?? positive(ml.measures.height_cm);
        draft.largura = draft.largura ?? positive(ml.measures.width_cm);
        draft.profundidade = draft.profundidade ?? positive(ml.measures.length_cm);
        if (JSON.stringify(before) !== JSON.stringify({ peso: draft.peso, altura: draft.altura, largura: draft.largura, profundidade: draft.profundidade })) sources.medidas = "Mercado Livre (mesmo EAN)";
        if (!draft.marca && ml.brand) { draft.marca = ml.brand; sources.marca = "Mercado Livre (mesmo EAN)"; }
        if (plainText(draft.corpo).length < MIN_DESCRIPTION) {
          const body = composeDescriptionBody(draft.corpo, ml.description, ml.attributes);
          if (body !== plainText(draft.corpo)) { draft.corpo = body; sources.descricao = "Fornecedor + catálogo Mercado Livre (mesmo EAN)"; }
        }
        if (draft.fotos.length < MIN_PHOTOS) {
          const extra = ml.pictures.filter(u => !draft.fotos.includes(u));
          const mp = await validPhotos(extra, blocked, MAX_PHOTOS - draft.fotos.length);
          if (mp.valid.length) { draft.fotos = [...draft.fotos, ...mp.valid]; sources.fotos_ml = mp.valid.length; }
        }
      } else sources.ml = "Nenhum produto de catálogo com o mesmo EAN";
    } catch (e) {
      sources.ml_erro = e instanceof Error ? e.message : String(e);
    }
  }

  // Ainda sem 3 fotos: produtos ativos de outras empresas com o mesmo EAN exato (cada foto é conferida).
  if (draft.fotos.length < MIN_PHOTOS) {
    const extra = await blingDonorPhotos(draft.gtin, job.company_id);
    const mp = await validPhotos(extra.filter(u => !draft.fotos.includes(u)), blocked, MAX_PHOTOS - draft.fotos.length);
    if (mp.valid.length) { draft.fotos = [...draft.fotos, ...mp.valid]; sources.fotos_bling = mp.valid.length; }
  }

  const { data: anatel } = await db.rpc("anatel_code_for", { _codigo: draft.sku, _gtin: draft.gtin });
  if (anatel && /\d{5}/.test(String(anatel))) { draft.anatel = String(anatel).trim(); sources.anatel = "Base Anatel"; }

  const issues: string[] = [];
  const missing = draftIssues(draft);
  if (missing.length) issues.push(`Falta: ${missing.join(", ")}`);
  const limit = draftLimitIssue(draft);
  if (limit) issues.push(limit);
  if (!quote || !(Number(quote.preco) > 0)) issues.push("Preço não calculável pela política de preço e marketplace padrão da empresa.");
  if (!issues.length) {
    const { data: supplier, error } = await db.rpc("resolve_import_product_supplier", { _company_id: job.company_id, _sku: draft.sku, _fallback_cost: quote?.custo ?? null, _fallback_name: draft.nome });
    if (error) throw new Error(error.message);
    if (!supplier) issues.push("Fornecedor deste prefixo não encontrado no Bling da empresa. Atualize os fornecedores no Bling.");
  }
  return { item, draft, issues, sources, quote };
}

/** Todas as regras ativas, exceto as que só existem depois do cadastro (vínculo no Bling) ou já conferidas acima (fotos). */
export async function auditDrafts(companyId: string, rules: Array<{ slug: string; config: any }>, ready: Prepared[]) {
  const products = ready.map(p => {
    const d = draftProduct(p.draft!);
    return {
      id: p.item.fornecedor_produto_id, codigo: p.item.sku, nome: d.nome, marca: d.marca, ncm: d.ncm,
      preco: Number(p.quote!.preco), preco_custo: Number(p.quote!.custo), estoque: Number(p.quote!.estoque ?? 0),
      gtin: d.gtin, situacao: "Ativo", peso_liquido: d.peso, peso_bruto: d.peso, largura: d.largura, altura: d.altura, profundidade: d.profundidade,
      unidade_medida: "Centímetros", condicao_produto: "Novo", tipo_producao: "Terceiros", cross_docking: "3",
      descricao_curta: d.descricao_curta, descricao_complementar: d.nome,
      url_imagens_externas: d.url_imagens_externas, imagem_principal_url: d.imagem_principal_url,
    };
  });
  for (const rule of rules) {
    if (rule.slug === "fornecedor-vinculado" || rule.slug === "imagem-placeholder") continue;
    const mod = RULE_REGISTRY[rule.slug];
    if (!mod) { ready.forEach(p => p.issues.push(`Regra ${rule.slug} indisponível.`)); continue; }
    try {
      const prepared = mod.prepare ? await mod.prepare({ companyId, supabaseAdmin, products: products as unknown as AuditProduct[] }, rule.config ?? {}) : undefined;
      for (let i = 0; i < ready.length; i++) {
        const r = await mod.evaluate(products[i] as unknown as AuditProduct, rule.config ?? {}, prepared);
        if (r.status !== "pass") ready[i]!.issues.push(`${mod.name}: ${r.message ?? "não passou"}`);
      }
    } catch (e) {
      ready.forEach(p => p.issues.push(`${mod.name}: ${e instanceof Error ? e.message : "falha na conferência"}`));
    }
  }
}

export async function processSupplierCatalogTick(origin: string) {
  const nowIso = new Date().toISOString();
  const { data: candidate } = checked(await db.from("supplier_catalog_import_jobs").select("id")
    .eq("status", "executando").lte("next_tick_at", nowIso).or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .order("next_tick_at").limit(1).maybeSingle());
  if (!candidate) return { ok: true, idle: true };
  const token = crypto.randomUUID();
  const { data: job } = checked(await db.from("supplier_catalog_import_jobs")
    .update({ lease_token: token, lease_until: new Date(Date.now() + LEASE_MS).toISOString() })
    .eq("id", candidate.id).eq("status", "executando").or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .select("*").maybeSingle());
  if (!job) return { ok: true, busy: true };
  try {
    return await runJob(job as Job, token, origin);
  } catch (e) {
    await db.from("supplier_catalog_import_jobs").update({ last_error: e instanceof Error ? e.message : String(e), next_tick_at: new Date(Date.now() + 30_000).toISOString() }).eq("id", job.id).eq("lease_token", token);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await db.from("supplier_catalog_import_jobs").update({ lease_token: null, lease_until: null }).eq("id", job.id).eq("lease_token", token);
  }
}

async function runJob(job: Job, token: string, origin: string) {
  const startedAt = Date.now();
  const scan = job.modo === "escanear";
  const { getActiveSync } = await import("./sync-lock.server");
  const active = scan ? null : await getActiveSync(job.company_id);
  if (active && active.kind !== "envio") {
    checked(await db.from("supplier_catalog_import_jobs").update({ waiting_reason: `Aguardando: ${active.label}`, next_tick_at: new Date(Date.now() + 60_000).toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id).eq("lease_token", token));
    return { ok: true, waiting: active.label };
  }
  const [{ data: rules }, { data: placeholderRule }] = await Promise.all([
    db.from("validation_rules").select("slug,config").eq("active", true).or(`company_id.is.null,company_id.eq.${job.company_id}`),
    db.from("validation_rules").select("config").eq("slug", "imagem-placeholder").eq("active", true).limit(1).maybeSingle(),
  ]);
  const blocked = new Set<string>(((placeholderRule?.config?.urls ?? []) as string[]).map(u => String(u).trim()));
  let mlToken: string | null = null;
  try { const { getMlAccessToken } = await import("./mercadolivre.server"); mlToken = await getMlAccessToken(); } catch { mlToken = null; }
  checked(await db.from("supplier_catalog_import_jobs").update({ waiting_reason: mlToken ? null : "Mercado Livre desconectado: dados faltantes não serão buscados lá.", last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id).eq("lease_token", token));

  let imported = 0;
  while (Date.now() - startedAt < BUDGET_MS) {
    const { data: fresh } = checked(await db.from("supplier_catalog_import_jobs").select("status,lease_token").eq("id", job.id).single());
    if (fresh.status !== "executando" || fresh.lease_token !== token) return { ok: true, stopped: fresh.status };
    const { data: items } = checked(await db.from("supplier_catalog_import_items").select("id,fornecedor_produto_id,codigo,sku,titulo")
      .eq("job_id", job.id).eq("status", "pendente").order("codigo").limit(scan ? SCAN_BATCH : BATCH));
    if (!items?.length) {
      checked(await db.rpc("recount_supplier_catalog_job", { _job_id: job.id }));
      checked(await db.from("supplier_catalog_import_jobs").update({ status: "concluido", finished_at: new Date().toISOString(), waiting_reason: null }).eq("id", job.id).eq("lease_token", token));
      break;
    }
    const ids = (items as Item[]).map(i => i.fornecedor_produto_id);
    const [{ data: fps }, { data: quotes }] = await Promise.all([
      db.from("fornecedor_produtos").select("*").in("id", ids).eq("ativo", true),
      db.rpc("supplier_catalog_quote", { _company_id: job.company_id, _fp_ids: ids }),
    ]);
    const fpMap = new Map<string, any>(((fps ?? []) as any[]).map(r => [r.id, r]));
    const qMap = new Map<string, Quote>(((quotes ?? []) as Quote[]).map(q => [q.fornecedor_produto_id, q]));
    const prepared = await Promise.all((items as Item[]).map(async it => {
      try { return await prepareItem(job, it, fpMap.get(it.fornecedor_produto_id), qMap.get(it.fornecedor_produto_id), mlToken, blocked); }
      catch (e) { return { item: it, issues: [], sources: {}, error: e instanceof Error ? e.message : String(e) } as Prepared; }
    }));
    const ready = prepared.filter(p => !p.error && !p.issues.length && p.draft);
    if (ready.length) await auditDrafts(job.company_id, rules ?? [], ready);
    for (const p of prepared) {
      const ok = !p.error && !p.issues.length && p.draft;
      if (scan) {
        const { error } = await db.rpc("complete_supplier_catalog_scan_item", {
          _job_id: job.id, _token: token, _item_id: p.item.id,
          _status: p.error ? "erro" : ok ? "pronto" : "pendencia",
          _issues: p.error ? [p.error] : p.issues, _sources: p.sources,
        });
        if (error) return { ok: true, stopped: error.message };
        continue;
      }
      const { data: status, error } = await db.rpc("complete_supplier_catalog_item", {
        _job_id: job.id, _token: token, _item_id: p.item.id,
        _status: p.error ? "erro" : ok ? "importado" : "pendencia",
        _issues: p.error ? [p.error] : p.issues, _sources: p.sources,
        _product: ok ? draftProduct(p.draft!) : null,
      });
      if (error) return { ok: true, stopped: error.message };
      if (status === "importado") imported++;
    }
    checked(await db.from("supplier_catalog_import_jobs").update({ lease_until: new Date(Date.now() + LEASE_MS).toISOString() }).eq("id", job.id).eq("lease_token", token));
  }
  await db.from("supplier_catalog_import_jobs").update({ next_tick_at: new Date(Date.now() + 1000).toISOString() }).eq("id", job.id).eq("lease_token", token).eq("status", "executando");
  if (imported > 0) {
    const secret = (process.env.BLING_WORKER_SECRET ?? "").trim();
    if (secret) await db.rpc("enqueue_http_job", { _url: `${origin}/api/public/bling/push-dispatch`, _secret: secret, _body: {} });
  }
  return { ok: true, imported, elapsed_ms: Date.now() - startedAt };
}
