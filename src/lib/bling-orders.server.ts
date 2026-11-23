// Worker helpers to sync Bling sales orders (pedidos de venda) incrementally.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blingApiGet, type BlingIntegrationRow } from "./bling.server";

const PAGE_LIMIT = 100;
// Detail requests dominate the API budget; cap the work done per tick.
const MAX_DETAIL_REQUESTS_PER_TICK = 25;
const MAX_LIST_PAGES_PER_TICK = 3;

type TickResult = {
  done: boolean;
  status: string;
  next_page?: number | null;
  orders_new?: number;
  orders_updated?: number;
  orders_skipped?: number;
};

function num(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
/** Datas do Bling podem vir como "0000-00-00" ou vazias; normaliza para null. */
function dateStr(v: unknown): string | null {
  const s = v == null ? null : String(v).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  if (iso.startsWith("0000") || iso.endsWith("-00-00") || iso.includes("-00-")) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : iso;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

async function loadIntegration(companyId: string): Promise<BlingIntegrationRow | null> {
  const { data } = await supabaseAdmin
    .from("bling_integrations")
    .select("id, company_id, access_token, refresh_token, token_expires_at, status")
    .eq("company_id", companyId)
    .maybeSingle();
  return (data as BlingIntegrationRow) ?? null;
}

/** Map loja_id -> taxa percentual do marketplace vinculado; fallback = marketplace padrão. */
async function loadFeeMap(companyId: string): Promise<{ byStore: Map<string, number>; names: Map<string, string>; fallback: number }> {
  const byStore = new Map<string, number>();
  const names = new Map<string, string>();
  const { data: fees, error: feeError } = await (supabaseAdmin as any).from("company_marketplace_fees")
    .select("marketplace_id, taxa_percent").eq("company_id", companyId);
  if (feeError) throw new Error(feeError.message);
  const feeMap = new Map<string, number>((fees ?? []).map((f: any) => [f.marketplace_id, Number(f.taxa_percent)]));
  const { data: stores } = await supabaseAdmin
    .from("bling_stores")
    .select("bling_store_id, descricao, marketplace_id, marketplaces(taxa_percent, nome)")
    .eq("company_id", companyId);
  for (const s of (stores ?? []) as any[]) {
    const id = String(s.bling_store_id);
    if (s.descricao) names.set(id, s.descricao);
    const taxa = feeMap.get(s.marketplace_id) ?? s.marketplaces?.taxa_percent;
    if (taxa != null) byStore.set(id, Number(taxa));
  }
  let fallback = 0;
  const { data: ps } = await supabaseAdmin
    .from("pricing_settings")
    .select("default_marketplace_id, marketplaces:default_marketplace_id(taxa_percent)")
    .eq("company_id", companyId)
    .maybeSingle();
  const t = feeMap.get((ps as any)?.default_marketplace_id) ?? (ps as any)?.marketplaces?.taxa_percent;
  if (t != null) fallback = Number(t);
  return { byStore, names, fallback };
}

async function loadCostMap(companyId: string, codigos: string[]): Promise<Map<string, { id: string; custo: number }>> {
  const map = new Map<string, { id: string; custo: number }>();
  const unique = Array.from(new Set(codigos.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 200) {
    const slice = unique.slice(i, i + 200);
    const { data } = await supabaseAdmin
      .from("bling_products")
      .select("id, codigo, preco_custo, preco_compra")
      .eq("company_id", companyId)
      .in("codigo", slice);
    for (const p of (data ?? []) as any[]) {
      if (!p.codigo) continue;
      map.set(String(p.codigo), {
        id: p.id as string,
        custo: num(p.preco_custo) || num(p.preco_compra),
      });
    }
  }
  return map;
}

/** Cache por execução: CNPJ -> razão social (consulta BrasilAPI). */
const cnpjCache = new Map<string, string | null>();

function onlyDigits(v: unknown): string | null {
  const s = String(v ?? "").replace(/\D/g, "");
  return s.length === 14 ? s : null;
}

/** Busca a razão social do intermediador pelo CNPJ (API pública, sem chave). */
async function lookupCnpjName(cnpj: string): Promise<string | null> {
  if (cnpjCache.has(cnpj)) return cnpjCache.get(cnpj) ?? null;
  let name: string | null = null;
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const j = (await res.json()) as any;
      name = str(j?.razao_social ?? j?.nome_fantasia);
    }
  } catch {
    name = null;
  }
  cnpjCache.set(cnpj, name);
  return name;
}

function formatBlingDateTime(iso: string): string {
  // Bling espera "YYYY-MM-DD HH:MM:SS"
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export async function processOrdersSyncTick(jobId: string): Promise<TickResult> {
  const { data: jobRow } = await supabaseAdmin
    .from("bling_orders_sync_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  const job = jobRow as any;
  if (!job) return { done: true, status: "not_found" };
  if (job.cancel_requested) {
    await supabaseAdmin
      .from("bling_orders_sync_jobs")
      .update({ status: "cancelada", finished_at: new Date().toISOString() })
      .eq("id", jobId);
    return { done: true, status: "cancelada" };
  }
  if (["concluida", "erro", "cancelada"].includes(job.status)) {
    return { done: true, status: job.status };
  }

  const integration = await loadIntegration(job.company_id);
  if (!integration || !integration.access_token) {
    await supabaseAdmin
      .from("bling_orders_sync_jobs")
      .update({ status: "erro", last_error: "Integração Bling não conectada.", finished_at: new Date().toISOString() })
      .eq("id", jobId);
    return { done: true, status: "erro" };
  }

  await supabaseAdmin
    .from("bling_orders_sync_jobs")
    .update({ status: "executando", started_at: job.started_at ?? new Date().toISOString(), claimed_at: new Date().toISOString() })
    .eq("id", jobId);

  const fees = await loadFeeMap(job.company_id);

  let page: number = job.current_page ?? 1;
  let pagesThisTick = 0;
  let detailRequests = 0;
  let found = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let itemsSaved = 0;
  let errors = 0;
  let lastError: string | null = null;
  let finished = false;
  let maxOrderDate: string | null = null;

  while (pagesThisTick < MAX_LIST_PAGES_PER_TICK && detailRequests < MAX_DETAIL_REQUESTS_PER_TICK) {
    const params = new URLSearchParams({ pagina: String(page), limite: String(PAGE_LIMIT) });
    if (job.changed_since) params.set("dataAlteracaoInicial", formatBlingDateTime(job.changed_since));
    else if (job.date_from) params.set("dataInicial", String(job.date_from));

    const res = await blingApiGet<{ data?: any[] }>(integration, `/pedidos/vendas?${params.toString()}`);
    pagesThisTick++;
    if (!res.ok) {
      errors++;
      lastError = res.errorMessage ?? `HTTP ${res.status}`;
      break;
    }
    const list = (res.data?.data ?? []) as any[];
    found += list.length;
    if (list.length === 0) {
      finished = true;
      break;
    }

    // Existing rows for this page (1 DB query, 0 API calls) => skip untouched orders.
    const ids = list.map((o) => String(o.id));
    const { data: existingRows } = await supabaseAdmin
      .from("bling_orders")
      .select("id, bling_order_id, total, situacao_id, items_synced")
      .eq("company_id", job.company_id)
      .in("bling_order_id", ids);
    const existing = new Map<string, any>();
    for (const r of (existingRows ?? []) as any[]) existing.set(String(r.bling_order_id), r);

    for (const summary of list) {
      if (detailRequests >= MAX_DETAIL_REQUESTS_PER_TICK) break;
      const blingOrderId = String(summary.id);
      const prev = existing.get(blingOrderId);
      const sitId = str(summary.situacao?.id ?? summary.situacao);
      const totalSummary = num(summary.total);
      if (prev && prev.items_synced && Number(prev.total) === totalSummary && String(prev.situacao_id ?? "") === String(sitId ?? "")) {
        skipped++;
        continue;
      }

      const det = await blingApiGet<{ data?: any }>(integration, `/pedidos/vendas/${blingOrderId}`);
      detailRequests++;
      if (!det.ok) {
        errors++;
        lastError = det.errorMessage ?? `HTTP ${det.status}`;
        continue;
      }
      const d = det.data?.data ?? {};
      const itens = (d.itens ?? []) as any[];
      const codigos = itens.map((i) => String(i.codigo ?? "")).filter(Boolean);
      const costs = await loadCostMap(job.company_id, codigos);

      let custoTotal = 0;
      let totalProdutos = 0;
      const itemRows = itens.map((i) => {
        const codigo = str(i.codigo);
        const qtd = num(i.quantidade);
        const valor = num(i.valor);
        const desconto = num(i.desconto);
        const totalItem = qtd * valor - desconto;
        const match = codigo ? costs.get(codigo) : undefined;
        const custoUnit = match?.custo ?? 0;
        custoTotal += custoUnit * qtd;
        totalProdutos += totalItem;
        return {
          company_id: job.company_id,
          product_id: match?.id ?? null,
          bling_product_id: str(i.produto?.id),
          codigo,
          descricao: str(i.descricao),
          quantidade: qtd,
          valor_unitario: valor,
          desconto,
          total: totalItem,
          custo_unitario: custoUnit,
          custo_total: custoUnit * qtd,
        };
      });

      const lojaId = str(d.loja?.id ?? summary.loja?.id);
      const taxa = lojaId ? fees.byStore.get(lojaId) ?? fees.fallback : fees.fallback;
      const dataPedido = dateStr(d.data ?? summary.data);
      if (dataPedido && (!maxOrderDate || dataPedido > maxOrderDate)) maxOrderDate = dataPedido;

      const interCnpj = onlyDigits(d.intermediador?.cnpj);
      const interRazao = interCnpj ? await lookupCnpjName(interCnpj) : null;

      const orderPayload = {
        company_id: job.company_id,
        integration_id: integration.id,
        bling_order_id: blingOrderId,
        numero: str(d.numero ?? summary.numero),
        numero_loja: str(d.numeroLoja ?? summary.numeroLoja),
        data: dataPedido,
        data_saida: dateStr(d.dataSaida),
        situacao_id: str(d.situacao?.id ?? sitId),
        situacao_nome: str(d.situacao?.valor ?? summary.situacao?.valor),
        loja_id: lojaId,
        loja_nome: lojaId ? fees.names.get(lojaId) ?? null : null,
        contato_nome: str(d.contato?.nome ?? summary.contato?.nome),
        contato_documento: str(d.contato?.numeroDocumento ?? summary.contato?.numeroDocumento),
        contato_id: str(d.contato?.id ?? summary.contato?.id),
        uf: str(d.transporte?.etiqueta?.uf),
        cidade: str(d.transporte?.etiqueta?.municipio),
        intermediador_nome: str(d.intermediador?.nomeUsuario),
        intermediador_cnpj: interCnpj,
        intermediador_razao_social: interRazao,

        total: num(d.total ?? summary.total),
        total_produtos: totalProdutos,
        desconto: num(d.desconto?.valor ?? d.desconto),
        frete: num(d.transporte?.frete ?? d.transporte?.valor ?? 0),
        outras_despesas: num(d.outrasDespesas),
        custo_total: custoTotal,
        taxa_percent: taxa,
        items_count: itemRows.length,
        items_synced: true,
        bling_updated_at: new Date().toISOString(),
        raw_json: d,
      };

      const { data: upserted, error: upErr } = await supabaseAdmin
        .from("bling_orders")
        .upsert(orderPayload as any, { onConflict: "company_id,bling_order_id" })
        .select("id")
        .maybeSingle();
      if (upErr || !upserted) {
        errors++;
        lastError = upErr?.message ?? "Falha ao salvar pedido.";
        continue;
      }
      const orderId = (upserted as any).id as string;
      await supabaseAdmin.from("bling_order_items").delete().eq("order_id", orderId);
      if (itemRows.length) {
        const { error: itErr } = await supabaseAdmin
          .from("bling_order_items")
          .insert(itemRows.map((r) => ({ ...r, order_id: orderId })) as any);
        if (itErr) {
          errors++;
          lastError = itErr.message;
        } else {
          itemsSaved += itemRows.length;
        }
      }
      if (prev) updated++;
      else created++;
    }

    if (list.length < PAGE_LIMIT) {
      finished = true;
      break;
    }
    page++;
  }

  const patch: Record<string, unknown> = {
    current_page: finished ? page : page,
    pages_processed: (job.pages_processed ?? 0) + pagesThisTick,
    orders_found: (job.orders_found ?? 0) + found,
    orders_new: (job.orders_new ?? 0) + created,
    orders_updated: (job.orders_updated ?? 0) + updated,
    orders_skipped: (job.orders_skipped ?? 0) + skipped,
    items_saved: (job.items_saved ?? 0) + itemsSaved,
    requests_made: (job.requests_made ?? 0) + pagesThisTick + detailRequests,
    errors: (job.errors ?? 0) + errors,
    last_error: lastError ?? job.last_error,
  };

  if (finished) {
    patch.status = "concluida";
    patch.finished_at = new Date().toISOString();
    // Marca o ponto de corte para a próxima sincronização incremental.
    const { count } = await supabaseAdmin
      .from("bling_orders")
      .select("id", { count: "exact", head: true })
      .eq("company_id", job.company_id);
    await supabaseAdmin.from("bling_orders_sync_state").upsert(
      {
        company_id: job.company_id,
        last_synced_at: job.run_started_at ?? new Date().toISOString(),
        last_order_date: maxOrderDate,
        total_orders: count ?? 0,
      } as any,
      { onConflict: "company_id" },
    );
  }

  await supabaseAdmin.from("bling_orders_sync_jobs").update(patch as any).eq("id", jobId);

  return {
    done: finished,
    status: finished ? "concluida" : "executando",
    next_page: finished ? null : page,
    orders_new: created,
    orders_updated: updated,
    orders_skipped: skipped,
  };
}
