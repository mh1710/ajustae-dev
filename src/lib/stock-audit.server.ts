// Auditoria de sincronização de estoque: compara o estoque da base com o saldo atual no Bling.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blingApiGet, type BlingIntegrationRow } from "./bling.server";

// Tabelas novas ainda não estão nos tipos gerados do Supabase.
const db = supabaseAdmin as any;

const CHUNK = 50;

interface AuditItem {
  id: string;
  bling_product_id: string | null;
  estoque_local: number | null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function runStockAuditBatchServer(runId: string, batchSize: number) {
  const { data: run } = await db
    .from("stock_audit_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (!run) throw new Error("Auditoria não encontrada");
  const r = run as any;

  if (r.status === "cancelada" || r.status === "concluida") {
    return {
      done: true,
      cancelled: r.status === "cancelada",
      checked: r.checked_products ?? 0,
      total: r.total_products ?? 0,
      ok: r.ok_count ?? 0,
      divergent: r.divergent_count ?? 0,
      missing: r.missing_count ?? 0,
      errors: r.error_count ?? 0,
    };
  }

  const { data: integRow } = await db
    .from("bling_integrations")
    .select("id, company_id, access_token, refresh_token, token_expires_at, status")
    .eq("company_id", r.company_id)
    .maybeSingle();
  const integ = integRow as BlingIntegrationRow | null;
  if (!integ) throw new Error("Integração do Bling não encontrada para esta empresa.");

  const { data: pending } = await db
    .from("stock_audit_items")
    .select("id, bling_product_id, estoque_local")
    .eq("run_id", runId)
    .eq("status", "pendente")
    .limit(batchSize);

  const items = (pending ?? []) as unknown as AuditItem[];

  if (items.length === 0) {
    await db
      .from("stock_audit_runs")
      .update({ status: "concluida", finished_at: new Date().toISOString() })
      .eq("id", runId);
    return {
      done: true,
      cancelled: false,
      checked: r.checked_products ?? 0,
      total: r.total_products ?? 0,
      ok: r.ok_count ?? 0,
      divergent: r.divergent_count ?? 0,
      missing: r.missing_count ?? 0,
      errors: r.error_count ?? 0,
    };
  }

  let ok = 0;
  let divergent = 0;
  let missing = 0;
  let errors = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const ids = chunk.map((it) => it.bling_product_id).filter(Boolean) as string[];
    const params = ids.map((id) => `idsProdutos[]=${encodeURIComponent(id)}`).join("&");
    const res = await blingApiGet<{ data?: Array<any> }>(integ, `/estoques/saldos?${params}`);

    const saldos = new Map<string, number>();
    if (res.ok) {
      const rows = Array.isArray((res.data as any)?.data) ? ((res.data as any).data as any[]) : [];
      for (const row of rows) {
        const pid = String(row?.produto?.id ?? row?.idProduto ?? "");
        const saldo = toNum(row?.saldoFisicoTotal ?? row?.saldoVirtualTotal ?? row?.saldoFisico);
        if (pid) saldos.set(pid, saldo ?? 0);
      }
    }

    for (const it of chunk) {
      let status = "ok";
      let detalhe: string | null = null;
      let estoqueBling: number | null = null;
      let diff: number | null = null;

      if (!res.ok) {
        status = "erro";
        detalhe = res.errorMessage ?? `Falha na consulta ao Bling (HTTP ${res.status}).`;
        errors++;
      } else if (!it.bling_product_id || !saldos.has(String(it.bling_product_id))) {
        status = "nao_encontrado";
        detalhe = "Produto não retornado pelo Bling.";
        missing++;
      } else {
        estoqueBling = saldos.get(String(it.bling_product_id)) ?? 0;
        const local = it.estoque_local ?? 0;
        diff = Number((estoqueBling - local).toFixed(4));
        if (Math.abs(diff) > 0.001) {
          status = "divergente";
          divergent++;
        } else {
          ok++;
        }
      }

      await db
        .from("stock_audit_items")
        .update({
          status,
          detalhe,
          estoque_bling: estoqueBling,
          diferenca: diff,
          checked_at: now,
        })
        .eq("id", it.id);
    }
  }

  const checked = (r.checked_products ?? 0) + items.length;
  const totals = {
    checked_products: checked,
    ok_count: (r.ok_count ?? 0) + ok,
    divergent_count: (r.divergent_count ?? 0) + divergent,
    missing_count: (r.missing_count ?? 0) + missing,
    error_count: (r.error_count ?? 0) + errors,
  };
  const done = checked >= (r.total_products ?? 0);

  await db
    .from("stock_audit_runs")
    .update({
      ...totals,
      status: done ? "concluida" : "processando",
      finished_at: done ? new Date().toISOString() : null,
    })
    .eq("id", runId);

  return {
    done,
    cancelled: false,
    checked,
    total: r.total_products ?? 0,
    ok: totals.ok_count,
    divergent: totals.divergent_count,
    missing: totals.missing_count,
    errors: totals.error_count,
  };
}
