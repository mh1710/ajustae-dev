import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { classifySupplier, type SupplierFreshnessRow } from "@/lib/supplier-freshness";

export type ScheduledAutomationOptions = {
  include_stores?: boolean;
  apply_status?: boolean;
  only_changed?: boolean;
  consider_ml_stock?: boolean;
};

type Step = {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "error" | "skipped";
  detail?: string;
  ms?: number;
};

const STEP_DEFS: { key: string; label: string }[] = [
  { key: "fornecedores", label: "Atualizar base dos fornecedores" },
  { key: "precos", label: "Atualizar estoque na base" },
  { key: "status", label: "Ativar/inativar conforme fornecedor" },
  { key: "sync", label: "Enfileirar sincronização com o Bling" },
];


/**
 * A base dos fornecedores é global (compartilhada por todas as empresas).
 * Atualiza no máximo uma vez a cada 30 min e nunca em paralelo, senão cada
 * empresa baixaria todos os XMLs de novo e a execução estoura o tempo limite.
 */
let supplierRefresh: Promise<{ total: number; ok: number; failed: number; skipped: boolean }> | null = null;

type SupplierRow = SupplierFreshnessRow;

async function loadSupplierRows(codes: string[]): Promise<SupplierRow[]> {
  const { data } = await supabaseAdmin
    .from("fornecedores")
    .select("codigo, product_count, last_sync_at, last_sync_status, last_ok_sync_at" as "codigo")
    .in("codigo", codes);
  return (data ?? []) as unknown as SupplierRow[];
}

function isFresh(rows: SupplierRow[], codigo: string) {
  return classifySupplier(rows.find((x) => x.codigo === codigo)) === "fresh";
}

function okTime(rows: SupplierRow[], codigo: string) {
  const at = rows.find((x) => x.codigo === codigo)?.last_ok_sync_at;
  if (!at) return codigo;
  const d = new Date(at);
  const hhmm = d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `${codigo} de ${hhmm}`;
}

export async function refreshSuppliersShared(waitIfBusy = true) {
  // Se outra empresa já está baixando a base, não espera: a base é compartilhada
  // e esperar faria todas as execuções estourarem o tempo limite juntas.
  if (supplierRefresh) {
    if (!waitIfBusy) return { total: 0, ok: 0, failed: 0, skipped: true };
    return supplierRefresh;
  }
  supplierRefresh = (async () => {
    const { SUPPLIERS, refreshSupplier } = await import("@/lib/suppliers-sync.server");

    const codes = Object.keys(SUPPLIERS);
    const list = await loadSupplierRows(codes);
    const stale = codes.filter((c) => !isFresh(list, c));
    let ok = 0;
    let failed = 0;
    // Um fornecedor por vez: termina um download antes de começar o próximo,
    // senão os XMLs simultâneos estouram o tempo limite do servidor.
    for (const c of stale) {
      try {
        await refreshSupplier(c);
        ok++;
      } catch {
        failed++;
      }
    }

    const { data: after } = await supabaseAdmin
      .from("fornecedores")
      .select("product_count")
      .in("codigo", codes);
    const total = ((after ?? []) as Array<{ product_count: number | null }>)
      .reduce((a, r) => a + Number(r.product_count ?? 0), 0);
    return { total, ok, failed, skipped: stale.length === 0 };
  })();
  try {
    return await supplierRefresh;
  } finally {
    supplierRefresh = null;
  }
}

/**
 * Garante que as bases de fornecedores estejam prontas antes de calcular
 * estoque. Só um processo baixa por vez (trava no banco); os demais esperam.
 * Se o site de um fornecedor falhar (fora do ar/lento), a base anterior
 * continua intacta: usa a última base completa de até 12 h e avisa. Só para a
 * automação quando não há base completa recente (evita zerar estoques).
 * Uma falha recente não é baixada de novo por cada empresa — senão 11
 * execuções repetem o mesmo download lento e todas estouram o tempo limite.
 */
const RECENT_FAILURE_MS = 10 * 60 * 1000;

export async function ensureSuppliersFresh(
  heartbeat?: () => Promise<void>,
): Promise<{ total: number; refreshed: string[]; waited: boolean; fallback: string[] }> {
  const { SUPPLIERS } = await import("@/lib/suppliers-sync.server");
  const codes = Object.keys(SUPPLIERS);
  const deadline = Date.now() + 8 * 60 * 1000;
  const refreshed: string[] = [];
  let waited = false;

  const recentlyFailed = (rows: SupplierRow[], c: string) => {
    const r = rows.find((x) => x.codigo === c);
    return !!r && r.last_sync_status === "erro" && !!r.last_sync_at &&
      Date.now() - new Date(r.last_sync_at).getTime() < RECENT_FAILURE_MS;
  };
  const finish = (rows: SupplierRow[]) => {
    const notFresh = codes.filter((c) => !isFresh(rows, c));
    const missing = notFresh.filter((c) => classifySupplier(rows.find((x) => x.codigo === c)) === "missing");
    if (missing.length) {
      throw new Error(
        `Base dos fornecedores incompleta (${missing.join(", ")}): o site do fornecedor não respondeu e não há base completa das últimas 12 horas. A automação foi interrompida para não zerar estoques.`,
      );
    }
    const total = rows.reduce((a, r) => a + Number(r.product_count ?? 0), 0);
    return { total, refreshed, waited, fallback: notFresh.map((c) => okTime(rows, c)) };
  };

  while (Date.now() < deadline) {
    await heartbeat?.();
    const rows = await loadSupplierRows(codes);
    const toDownload = codes.filter((c) => !isFresh(rows, c) && !recentlyFailed(rows, c));
    if (toDownload.length === 0) return finish(rows);

    const holder = `suppliers:${Math.random().toString(36).slice(2)}`;
    const { data: got } = await supabaseAdmin.rpc("acquire_worker_lease", {
      _pool: "suppliers-refresh",
      _key: "suppliers-refresh",
      _holder: holder,
      _ttl_seconds: 600,
      _max_concurrent: 1,
    } as never);

    if (got !== true) {
      // Outro processo está baixando a base: espera ela ficar pronta.
      waited = true;
      await new Promise((r) => setTimeout(r, 5_000));
      continue;
    }

    try {
      const { refreshSupplier } = await import("@/lib/suppliers-sync.server");
      // relê sob a trava: outro processo pode ter acabado de baixar
      const current = await loadSupplierRows(codes);
      for (const c of codes.filter((x) => !isFresh(current, x) && !recentlyFailed(current, x))) {
        await heartbeat?.();
        try {
          await refreshSupplier(c); // já tenta o download duas vezes
          refreshed.push(c);
        } catch { /* fica registrado como erro; usa a base anterior se for recente */ }
      }
    } finally {
      await supabaseAdmin.rpc("release_worker_lease", {
        _key: "suppliers-refresh",
        _holder: holder,
      } as never);
    }

    return finish(await loadSupplierRows(codes));
  }

  return finish(await loadSupplierRows(codes));
}


async function callAdminRpc(functionName: string, args: Record<string, unknown>) {
  return (supabaseAdmin.rpc as unknown as (
    name: string,
    parameters: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(functionName, args);
}

async function acquireAutomationLease(runId: string, companyId: string) {
  const holder = `automation:${runId}`;
  const key = `automation-prepare:${companyId}`;
  const deadline = Date.now() + 3 * 60 * 1000;

  while (Date.now() < deadline) {
    const { data, error } = await supabaseAdmin.rpc("acquire_worker_lease", {
      _pool: "automation-prepare",
      _key: key,
      _holder: holder,
      _ttl_seconds: 180,
      _max_concurrent: 2,
    } as never);
    if (error) throw new Error(error.message);
    if (data === true) return { key, holder };
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error("A preparação do estoque aguardou outras empresas por muito tempo. A execução poderá ser tentada novamente.");
}

async function releaseAutomationLease(lease: { key: string; holder: string } | null) {
  if (!lease) return;
  await supabaseAdmin.rpc("release_worker_lease", {
    _key: lease.key,
    _holder: lease.holder,
  } as never);
}

/**
 * Runs the supplier → price/stock → Bling chain entirely on the server.
 * Used by the scheduler (cron) so no browser tab needs to stay open.
 */
type ScheduledRunResult = { run_id: string | null; status: "success" | "error" | "skipped"; result: Record<string, number | string | boolean | null> };

export async function runScheduledAutomation(
  companyId: string,
  slug: string,
  options: ScheduledAutomationOptions,
  scheduleId?: string | null,
): Promise<ScheduledRunResult> {
  // Uma execução por agendamento: retomada automática e disparo do horário
  // podem chegar juntos; o segundo não cria uma execução duplicada.
  if (!scheduleId) return runScheduledAutomationInner(companyId, slug, options, scheduleId);
  const key = `automation-schedule:${scheduleId}`;
  const holder = `run:${Math.random().toString(36).slice(2)}`;
  const { data: got } = await supabaseAdmin.rpc("acquire_worker_lease", {
    // pool próprio por agendamento: só impede duplicar o MESMO agendamento.
    // Expira antes da recuperação automática (5 min) para nunca bloquear a retomada.
    _pool: key,
    _key: key,
    _holder: holder,
    _ttl_seconds: 240,
    _max_concurrent: 1,
  } as never);
  if (got !== true) return { run_id: null, status: "skipped", result: { motivo: "execução já em andamento" } };
  try {
    return await runScheduledAutomationInner(companyId, slug, options, scheduleId);
  } finally {
    await supabaseAdmin.rpc("release_worker_lease", { _key: key, _holder: holder } as never);
  }
}

async function runScheduledAutomationInner(
  companyId: string,
  slug: string,
  options: ScheduledAutomationOptions,
  scheduleId?: string | null,
): Promise<ScheduledRunResult> {
  // Estoque é apenas o do Bling (multilojas não possuem estoque próprio),
  // então a automação nunca inclui lojas.
  const includeStores = false;
   const considerMlStock = options.consider_ml_stock !== false;
  const applyStatus = options.apply_status !== false;
  const onlyChanged = options.only_changed !== false;
  const steps: Step[] = STEP_DEFS.map((s) => ({ ...s, status: "pending" }));
   const result: Record<string, number | string | boolean | null> = { agendada: true, consider_ml_stock: considerMlStock };

  const owner = await supabaseAdmin
    .from("companies")
    .select("owner_user_id")
    .eq("id", companyId)
    .maybeSingle();
  const ownerId = owner.data?.owner_user_id;
  if (!ownerId) throw new Error("Empresa não encontrada para execução agendada.");

  const { data: runRow } = await supabaseAdmin
    .from("automation_runs")
    .insert({
      company_id: companyId,
      // scheduled runs have no interactive user; reuse the company owner
      user_id: ownerId,
      slug,
      status: "running",
      steps,
      result,
    })

    .select("id")
    .single();
  const runId = (runRow?.id as string | undefined) ?? null;

  // Vincula a execução ao agendamento desde o início, para que a tela mostre o
  // progresso desta programação e nunca o de execuções antigas/excluídas.
  if (scheduleId && runId) {
    await supabaseAdmin
      .from("automation_schedules")
      .update({ last_status: "running", last_run_id: runId } as never)
      .eq("id", scheduleId);
  }

  const save = async (current: string | null) => {
    if (!runId) return;
    await supabaseAdmin
      .from("automation_runs")
      .update({ steps, result, current_step: current })
      .eq("id", runId);
  };
  const mark = async (key: string, patch: Partial<Step>) => {
    const idx = steps.findIndex((s) => s.key === key);
    if (idx >= 0) steps[idx] = { ...steps[idx], ...patch };
    await save(key);
  };

  try {
    // 1) Fornecedores — a automação SÓ continua com as três bases atualizadas.
    // Se outra execução estiver baixando, espera; se alguma base falhar, a
    // execução para aqui em vez de calcular estoque com dados velhos.
    const t0 = Date.now();
    await mark("fornecedores", { status: "running", detail: "garantindo bases atualizadas" });
    // Mantém a execução "viva" enquanto espera o download dos fornecedores,
    // senão a recuperação automática a considera travada após 5 minutos.
    let lastBeat = Date.now();
    const heartbeat = async () => {
      if (Date.now() - lastBeat < 30_000) return;
      lastBeat = Date.now();
      await save("fornecedores");
    };
    const sup = await ensureSuppliersFresh(heartbeat);
    result.fornecedores_produtos = sup.total;
    if (sup.fallback.length) result.fornecedores_base_anterior = sup.fallback.join(", ");
    await mark("fornecedores", {
      status: "done",
      detail: `${sup.total} produtos${sup.refreshed.length ? ` · atualizado(s): ${sup.refreshed.join(", ")}` : sup.fallback.length ? "" : " · base já atualizada"}${sup.fallback.length ? ` · fornecedor fora do ar, usando a última base completa: ${sup.fallback.join(", ")}` : ""}${sup.waited ? " · aguardou outra execução" : ""}`,
      ms: Date.now() - t0,
    });


    // Recotação do Mercado Livre junto com a base dos fornecedores.
    // Roda em segundo plano (fila HTTP) para não atrasar a automação.
    if (considerMlStock) try {
      const base = (process.env.APP_PUBLIC_URL ?? "https://cloud-free-auditor.lovable.app").replace(/\/$/, "");
      await supabaseAdmin.rpc("enqueue_http_job", {
        _url: `${base}/api/public/mercadolivre/refresh-tick`,
        _secret: (process.env.BLING_WORKER_SECRET ?? "").trim(),
        _body: {} as never,
      } as never);
    } catch {
      // Mercado Livre é complementar: nunca derruba a automação.
    }




    // 2) Stock only (a automação de estoque nunca altera preços)
    const t2 = Date.now();
    await mark("precos", { status: "running", detail: "aguardando capacidade de processamento" });
    const lease = runId ? await acquireAutomationLease(runId, companyId) : null;
    let ps: unknown = null;
    try {
      await mark("precos", { status: "running", detail: "atualizando estoque na base" });
      const { data, error: psErr } = await callAdminRpc("automation_update_stock_only", {
        _company_id: companyId,
        _run_id: runId,
        _consider_ml_stock: considerMlStock,
      });
      if (psErr) throw new Error(psErr.message);
      ps = data;
    } finally {
      await releaseAutomationLease(lease);
    }
    const psr = (ps ?? {}) as Record<string, number>;
    result.preco_atualizado = 0;
    result.estoque_atualizado = Number(psr.estoque_atualizado ?? 0);
    result.sem_fornecedor = Number(psr.sem_fornecedor ?? 0);
    result.estoque_via_ml = Number(psr.estoque_via_ml ?? 0);
    const viaMl = Number(result.estoque_via_ml ?? 0);
    await mark("precos", {
      status: "done",
      detail:
        `${result.estoque_atualizado} estoque(s)` +
        ` · ${Number(result.estoque_atualizado) - viaMl} pelo fornecedor` +
         (considerMlStock ? ` · ${viaMl} pelo Mercado Livre (mínimo 4)` : " · Mercado Livre desconsiderado") +
        ` · ${result.sem_fornecedor} sem fornecedor`,
      ms: Date.now() - t2,
    });

    // Garante depósito padrão (sem ele nenhum estoque é enviado ao Bling)
    const { data: integ } = await supabaseAdmin
      .from("bling_integrations")
      .select("id, company_id, access_token, refresh_token, token_expires_at, status, default_deposito_id")
      .eq("company_id", companyId)
      .eq("status", "conectada")
      .maybeSingle();
    if (integ && !(integ as { default_deposito_id?: string | null }).default_deposito_id) {
      const { syncBlingDepositos } = await import("./bling-stores.server");
      const dep = await syncBlingDepositos(integ as never);
      if (!dep.default_id) throw new Error("Nenhum depósito encontrado no Bling para esta empresa.");
    }

    // 4) Status
    const t3 = Date.now();
    let inactivateIds: string[] = [];
    if (applyStatus) {
      await mark("status", { status: "running" });
      const { data: st, error: stErr } = await supabaseAdmin.rpc("automation_apply_supplier_status", {
        _company_id: companyId,
        _run_id: runId,
      } as never);
      if (stErr) throw new Error(stErr.message);
      const s = (st ?? {}) as { inactivated?: number; activated?: number; inactivate_ids?: string[] };
      inactivateIds = s.inactivate_ids ?? [];
      result.inativados = Number(s.inactivated ?? 0);
      result.ativados = Number(s.activated ?? 0);
      await mark("status", {
        status: "done",
        detail: `${result.inativados} inativado(s) · ${result.ativados} ativado(s)`,
        ms: Date.now() - t3,
      });
    } else {
      await mark("status", { status: "skipped" });
    }

    // 5) Enqueue Bling sync
    const t4 = Date.now();
    await mark("sync", { status: "running" });
    const { data: push, error: pushErr } = await supabaseAdmin.rpc("enqueue_bling_push", {
      _company_id: companyId,
      _product_ids: undefined,
      _scope: "estoque",
      _include_stores: includeStores,
      _only_changed: onlyChanged,
    } as never);
    if (pushErr) throw new Error(pushErr.message);
    const p = (push ?? {}) as Record<string, number>;
    let enfileirados =
      Number(p.created_preco ?? 0) + Number(p.created_estoque ?? 0) + Number(p.created_lojas ?? 0);
    if (inactivateIds.length > 0) {
      const CHUNK = 2000;
      for (let i = 0; i < inactivateIds.length; i += CHUNK) {
        const { data: inac } = await supabaseAdmin.rpc("enqueue_bling_inactivate", {
          _company_id: companyId,
          _product_ids: inactivateIds.slice(i, i + CHUNK),
        } as never);
        enfileirados += Number((inac as { enqueued?: number } | null)?.enqueued ?? 0);
      }
    }
    result.requisicoes_enfileiradas = enfileirados;
    await mark("sync", { status: "done", detail: `${enfileirados} requisição(ões)`, ms: Date.now() - t4 });

    if (runId) {
      await supabaseAdmin
        .from("automation_runs")
        .update({ status: "success", current_step: null, steps, result, finished_at: new Date().toISOString() })
        .eq("id", runId);
    }
    if (scheduleId) {
      await supabaseAdmin
        .from("automation_schedules")
        .update({ last_status: "success", last_run_id: runId, auto_retry_count: 0 } as never)
        .eq("id", scheduleId);
    }
    return { run_id: runId, status: "success", result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    for (const s of steps) if (s.status === "running") { s.status = "error"; s.detail = msg; }
    if (runId) {
      await supabaseAdmin
        .from("automation_runs")
        .update({ status: "error", error: msg, steps, result, finished_at: new Date().toISOString() })
        .eq("id", runId);
    }
    if (scheduleId) {
      await supabaseAdmin
        .from("automation_schedules")
        .update({ last_status: "error", last_run_id: runId } as never)
        .eq("id", scheduleId);
    }
    return { run_id: runId, status: "error", result };
  }
}

/**
 * Claims and executes all schedules that are due.
 * The RPC skips companies that already have an automation running, so each
 * company runs at most one automation at a time — but different companies
 * run simultaneously.
 */
export async function runDueAutomations(limit = 10) {
  const { data, error } = await supabaseAdmin.rpc("claim_due_automation_schedules", { _limit: limit } as never);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; company_id: string; slug: string; options: ScheduledAutomationOptions }>;

  const settled = await Promise.allSettled(
    rows.map((row) => runScheduledAutomation(row.company_id, row.slug, row.options ?? {}, row.id)),
  );

  const out = settled.map((s, i) => ({
    schedule_id: rows[i]!.id,
    company_id: rows[i]!.company_id,
    status: s.status === "fulfilled" ? s.value.status : "error",
    run_id: s.status === "fulfilled" ? s.value.run_id : null,
    error: s.status === "rejected" ? String((s.reason as Error)?.message ?? s.reason) : undefined,
  }));
  return { claimed: rows.length, runs: out };
}

/**
 * Claims due schedules and dispatches ONE HTTP request per company (via pg_net),
 * so each company gets its own server time budget instead of sharing a single
 * request with all the others (which was timing out at the price/stock step).
 */
export async function dispatchDueAutomations(baseUrl: string, secret: string, limit = 10) {
  const { data, error } = await supabaseAdmin.rpc("claim_due_automation_schedules", { _limit: limit } as never);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; company_id: string; slug: string; options: ScheduledAutomationOptions }>;

  const url = `${baseUrl.replace(/\/$/, "")}/api/public/automations/run`;
  const dispatched: Array<{ schedule_id: string; company_id: string; queued: boolean; error?: string }> = [];
  for (const row of rows) {
    const { error: qErr } = await (supabaseAdmin.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>)("enqueue_automation_run", {
      _url: url,
      _secret: secret,
      _schedule_id: row.id,
    } as never);
    dispatched.push({
      schedule_id: row.id,
      company_id: row.company_id,
      queued: !qErr,
      ...(qErr ? { error: qErr.message } : {}),
    });
  }
  return { claimed: rows.length, dispatched };
}
