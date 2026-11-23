/**
 * Sincronização dos fornecedores vinculados a cada produto no Bling
 * (GET /produtos/fornecedores paginado). Server-only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blingApiGet, type BlingIntegrationRow } from "@/lib/bling.server";

const PAGE_SIZE = 100;
const LEASE_MS = 90_000;

type Job = {
  phase: string;
  detail_cursor: string | null;
  details_checked: number;
  id: string;
  company_id: string;
  integration_id: string;
  status: string;
  next_page: number;
  pages_done: number;
  links_found: number;
};

const db = supabaseAdmin as any;

export async function isSupplierSyncStopped(jobId: string) {
  const { data } = await db.from("bling_supplier_sync_jobs").select("status").eq("id", jobId).maybeSingle();
  return !data || data.status !== "executando";
}

async function claim(jobId: string): Promise<Job | null> {
  const now = new Date();
  const { data } = await db
    .from("bling_supplier_sync_jobs")
    .update({ lease_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq("id", jobId)
    .eq("status", "executando")
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .select("id, company_id, integration_id, status, next_page, pages_done, links_found, phase, detail_cursor, details_checked")
    .maybeSingle();
  return (data as Job) ?? null;
}

/**
 * Reconhece o fornecedor pelo nome vindo do Bling, sem exigir nome exato:
 * "HAYAMAX", "Hayamax Distribuidora De Produtos Ltda" → hayamax, etc.
 */
export function guessSupplierCodigo(nome: string | null | undefined): string | null {
  const n = (nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (!n) return null;
  if (n.includes("hayamax")) return "hayamax";
  if (n.includes("evolusom")) return "evolusom";
  if (n.includes("oderco")) return "oderco";
  return null;
}

/**
 * Lê os contatos "Fornecedor" do Bling e guarda os que têm "Código" preenchido:
 * cada empresa usa esse código como prefixo do SKU (EV, E, HA, HX, O, ODS...).
 */
export async function syncSupplierPrefixContacts(integ: BlingIntegrationRow, companyId: string) {
  const tipos = await blingApiGet<any>(integ, "/contatos/tipos");
  if (!tipos.ok) return;
  const tipo = (((tipos.data as any)?.data ?? []) as any[]).find((t) => /fornec/i.test(String(t?.descricao ?? "")));
  if (!tipo) return;
  const rows: { company_id: string; codigo: string; bling_supplier_id: string; nome: string | null; updated_at: string }[] = [];
  for (let page = 1; page <= 50; page++) {
    const r = await blingApiGet<any>(integ, `/contatos?idTipoContato=${tipo.id}&limite=100&pagina=${page}`);
    if (!r.ok) return; // leitura incompleta: mantém os códigos já gravados
    const list = ((r.data as any)?.data ?? []) as any[];
    for (const c of list) {
      const codigo = String(c?.codigo ?? "").trim().toUpperCase();
      if (!codigo || !/^[A-Z]+$/.test(codigo) || String(c?.situacao ?? "A") !== "A" || !c?.id) continue;
      rows.push({ company_id: companyId, codigo, bling_supplier_id: String(c.id), nome: c.nome ?? null, updated_at: new Date().toISOString() });
    }
    if (list.length < 100) break;
  }
  const unique = [...new Map(rows.map((r) => [r.codigo, r])).values()];
  await db.from("bling_supplier_prefix_contacts" as never).delete().eq("company_id", companyId);
  if (unique.length) await db.from("bling_supplier_prefix_contacts" as never).insert(unique as never);
}

export async function resolveSupplierNames(integ: BlingIntegrationRow, companyId: string) {
  try { await syncSupplierPrefixContacts(integ, companyId); } catch { /* nomes seguem mesmo sem os códigos */ }
  const all = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data: ids } = await db
      .from("bling_product_suppliers")
      .select("bling_supplier_id")
      .eq("company_id", companyId)
      .order("id")
      .range(from, from + 999);
    const rows = (ids ?? []) as { bling_supplier_id: string }[];
    for (const r of rows) all.add(r.bling_supplier_id);
    if (rows.length < 1000) break;
  }
  const distinct = [...all];
  const { data: known } = await db
    .from("bling_supplier_map")
    .select("bling_supplier_id, nome")
    .eq("company_id", companyId);
  const knownMap = new Map(((known ?? []) as { bling_supplier_id: string; nome: string | null }[]).map((k) => [k.bling_supplier_id, k.nome]));
  for (const id of distinct) {
    if (knownMap.get(id)) continue;
    let nome: string | null = null;
    const r = await blingApiGet<any>(integ, `/contatos/${encodeURIComponent(id)}`);
    if (r.ok) nome = (r.data as any)?.data?.nome ?? null;
    const finalNome = nome ?? `Fornecedor ${id}`;
    await db.from("bling_supplier_map").upsert(
      {
        company_id: companyId,
        bling_supplier_id: id,
        nome: finalNome,
        supplier_codigo: guessSupplierCodigo(finalNome),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,bling_supplier_id", ignoreDuplicates: knownMap.has(id) && !!knownMap.get(id) },
    );
  }
}

/** Salva uma página de vínculos (também usado após criar um vínculo). */
export async function saveSupplierLinks(companyId: string, rows: any[], jobId: string | null) {
  const valid = rows.filter((x) => x?.id && x?.produto?.id && x?.fornecedor?.id && Number(x.fornecedor.id) > 0);
  if (valid.length === 0) return 0;
  const blingIds = [...new Set(valid.map((x) => String(x.produto.id)))];
  const { data: prods } = await db
    .from("bling_products")
    .select("id, bling_product_id")
    .eq("company_id", companyId)
    .in("bling_product_id", blingIds);
  const byBling = new Map(((prods ?? []) as { id: string; bling_product_id: string }[]).map((p) => [String(p.bling_product_id), p.id]));
  const payload = valid.map((x) => ({
    company_id: companyId,
    product_id: byBling.get(String(x.produto.id)) ?? null,
    bling_product_id: String(x.produto.id),
    bling_link_id: String(x.id),
    bling_supplier_id: String(x.fornecedor.id),
    codigo: x.codigo ?? null,
    preco_custo: x.precoCusto ?? null,
    padrao: !!x.padrao,
    synced_job_id: jobId,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await db.from("bling_product_suppliers").upsert(payload, { onConflict: "company_id,bling_link_id" });
  if (error) throw new Error(error.message);
  return payload.length;
}

/** Lê o fornecedor pela ficha do produto (a listagem do Bling ignora inativos). */
export async function supplierFromDetail(integ: BlingIntegrationRow, blingProductId: string) {
  const r = await blingApiGet<any>(integ, `/produtos/${encodeURIComponent(blingProductId)}`);
  if (!r.ok) return { ok: false as const, status: r.status, row: null, linkId: null, purchasePrice: null };
  const f = (r.data as any)?.data?.fornecedor;
  const linkId = Number(f?.id) > 0 ? String(f.id) : null;
  const purchasePrice = f?.precoCompra != null && Number.isFinite(Number(f.precoCompra)) ? Number(f.precoCompra) : null;
  if (!linkId || !f?.contato?.id || Number(f.contato.id) <= 0) return { ok: true as const, status: 200, row: null, linkId, purchasePrice };
  return {
    ok: true as const, status: 200, linkId, purchasePrice,
    row: { id: f.id, produto: { id: blingProductId }, fornecedor: { id: f.contato.id }, codigo: f.codigo || null, precoCusto: f.precoCusto ?? null, padrao: true },
  };
}

async function runDetailPhase(job: Job, integ: BlingIntegrationRow, deadline: number) {
  let cursor = job.detail_cursor;
  let checked = job.details_checked;
  let found = job.links_found;
  while (Date.now() < deadline) {
    if (await isSupplierSyncStopped(job.id)) return { finished: false };
    let q = db.from("bling_products").select("id, bling_product_id")
      .eq("company_id", job.company_id).not("bling_product_id", "is", null).order("id").limit(50);
    if (cursor) q = q.gt("id", cursor);
    const { data: prods } = await q;
    const list = (prods ?? []) as { id: string; bling_product_id: string }[];
    if (list.length === 0) return { finished: true, checked, found };
    const { data: have } = await db.from("bling_product_suppliers").select("product_id")
      .eq("company_id", job.company_id).in("product_id", list.map((p) => p.id));
    const linked = new Set(((have ?? []) as { product_id: string }[]).map((h) => h.product_id));
    const missing = list.filter((p) => !linked.has(p.id));
    // 3 leituras simultâneas (limite do Bling: 3 requisições por segundo).
    let complete = true;
    for (let i = 0; i < missing.length; i += 3) {
      if (Date.now() >= deadline) { complete = false; break; }
      const chunk = missing.slice(i, i + 3);
      const res = await Promise.all(chunk.map((p) => supplierFromDetail(integ, p.bling_product_id)));
      for (const d of res) {
        if (!d.ok && (d.status === 401 || d.status === 403)) throw new Error(`HTTP ${d.status} ao ler produto`);
      }
      const rows = res.map((d) => d.row).filter(Boolean);
      if (rows.length) found += await saveSupplierLinks(job.company_id, rows, job.id);
      checked += chunk.length;
      cursor = chunk[chunk.length - 1].id;
    }
    if (complete) cursor = list[list.length - 1].id;
    await db.from("bling_supplier_sync_jobs").update({ detail_cursor: cursor, details_checked: checked, links_found: found }).eq("id", job.id);
  }
  return { finished: false, checked, found };
}

export async function processSupplierSyncTick(jobId: string, budgetMs = 35_000) {
  const job = await claim(jobId);
  if (!job) return { done: false, busy: true, stopped: await isSupplierSyncStopped(jobId) };
  const { data: integ } = await db.from("bling_integrations").select("*").eq("id", job.integration_id).maybeSingle();
  if (!integ) {
    await db.from("bling_supplier_sync_jobs").update({ status: "erro", last_error: "Integração não encontrada", lease_until: null }).eq("id", jobId);
    return { done: true, stopped: true };
  }
  const deadline = Date.now() + budgetMs;
  if (job.phase === "detalhes") {
    try {
      const r = await runDetailPhase(job, integ, deadline);
      if (r.finished) {
        await resolveSupplierNames(integ, job.company_id);
        await db.from("bling_supplier_sync_jobs").update({
          status: "concluido", finished_at: new Date().toISOString(), lease_until: null, last_error: null,
          details_checked: r.checked, links_found: r.found,
        }).eq("id", jobId);
        return { done: true };
      }
    } catch (e) {
      await db.from("bling_supplier_sync_jobs").update({ status: "erro", last_error: e instanceof Error ? e.message : String(e), lease_until: null }).eq("id", jobId);
      return { done: true, stopped: true };
    }
    await db.from("bling_supplier_sync_jobs").update({ lease_until: null }).eq("id", jobId);
    return { done: false, stopped: await isSupplierSyncStopped(jobId) };
  }
  let page = job.next_page;
  let pagesDone = job.pages_done;
  let found = job.links_found;
  let finished = false;

  while (Date.now() < deadline) {
    if (await isSupplierSyncStopped(jobId)) break;
    const r = await blingApiGet<any>(integ, `/produtos/fornecedores?pagina=${page}&limite=${PAGE_SIZE}`);
    if (!r.ok) {
      const fatal = r.status === 401 || r.status === 403;
      await db.from("bling_supplier_sync_jobs").update({
        status: fatal ? "erro" : "executando",
        last_error: `Página ${page}: HTTP ${r.status} ${r.errorMessage ?? ""}`.trim(),
        next_page: page, pages_done: pagesDone, links_found: found, lease_until: null,
      }).eq("id", jobId);
      return { done: fatal, stopped: fatal, error: true };
    }
    const rows = ((r.data as any)?.data ?? []) as any[];
    found += await saveSupplierLinks(job.company_id, rows, jobId);
    pagesDone++;
    if (rows.length < PAGE_SIZE) { finished = true; break; }
    page++;
    await db.from("bling_supplier_sync_jobs").update({ next_page: page, pages_done: pagesDone, links_found: found }).eq("id", jobId);
  }

  if (finished) {
    // Remove vínculos que não existem mais no Bling.
    await db.from("bling_product_suppliers").delete().eq("company_id", job.company_id).neq("synced_job_id", jobId);
    await db.from("bling_product_suppliers").delete().eq("company_id", job.company_id).is("synced_job_id", null);
    // Fase 2: a listagem só traz produtos ativos; confere os demais pela ficha.
    const { count } = await db.from("bling_products").select("id", { count: "exact", head: true })
      .eq("company_id", job.company_id).not("bling_product_id", "is", null);
    await db.from("bling_supplier_sync_jobs").update({
      phase: "detalhes", next_page: page, pages_done: pagesDone, links_found: found,
      details_total: Math.max(0, (count ?? 0) - found), lease_until: null,
    }).eq("id", jobId);
    return { done: false };
  }
  await db.from("bling_supplier_sync_jobs").update({ next_page: page, pages_done: pagesDone, links_found: found, lease_until: null }).eq("id", jobId);
  return { done: false, stopped: await isSupplierSyncStopped(jobId) };
}

export async function enqueueSupplierTick(jobId: string, origin?: string) {
  const base = (process.env.APP_PUBLIC_URL ?? origin ?? "").replace(/\/$/, "");
  const secret = process.env.BLING_WORKER_SECRET ?? "";
  if (!base || !secret) return false;
  await db.rpc("enqueue_http_job", {
    _url: `${base}/api/public/bling/suppliers-tick`,
    _secret: secret,
    _body: { job_id: jobId },
  });
  return true;
}
