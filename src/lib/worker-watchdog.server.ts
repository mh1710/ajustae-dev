/**
 * Vigia das filas encadeadas: a cada minuto (app-tick) reenfileira o próximo lote
 * das tarefas ativas que pararam de avançar, para que continuem com o sistema fechado.
 * Os ticks são idempotentes (lease/claim), então um reenvio extra não duplica trabalho.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { IMAGE_AUDIT_SHARDS } from "@/lib/image-audit-batch";

const db = supabaseAdmin as any;

type Spec = {
  table: string;
  statuses: string[];
  path: string;
  staleCol?: string;
  rpc?: "sync";
  extra?: Record<string, unknown>;
};

const SPECS: Spec[] = [
  {
    table: "bling_custom_field_jobs",
    statuses: ["executando"],
    path: "/api/public/bling/custom-fields-tick",
  },
  {
    table: "bling_supplier_sync_jobs",
    statuses: ["executando"],
    path: "/api/public/bling/suppliers-tick",
  },
  {
    table: "bling_sync_jobs",
    statuses: ["pendente", "catalogando", "processando", "retomando", "cancelando"],
    path: "/api/public/bling/sync-tick",
    staleCol: "updated_at",
    rpc: "sync",
  },
  {
    table: "bling_store_sync_jobs",
    statuses: ["pendente", "processando"],
    path: "/api/public/bling/stores-tick",
    staleCol: "updated_at",
    rpc: "sync",
  },
  {
    table: "ml_map_jobs",
    statuses: ["pendente", "processando"],
    path: "/api/public/mercadolivre/map-tick",
    staleCol: "updated_at",
    extra: { worker: 0 },
  },
  {
    table: "ml_prospect_jobs",
    statuses: ["pendente", "processando"],
    path: "/api/public/mercadolivre/prospect-tick",
    staleCol: "updated_at",
  },
];

export async function kickStalledWorkers(base: string, secret: string) {
  const out: Record<string, number> = {};
  const now = new Date();
  const staleIso = new Date(now.getTime() - 2 * 60_000).toISOString();
  // Daily ML recotation must survive a lost HTTP chain, independently of company automations.
  try {
    const cutoff = new Date(now.getTime() - 20 * 3600_000).toISOString();
    const { data } = await db
      .from("ml_product_matches")
      .select("product_id")
      .lt("checked_at", cutoff)
      .limit(1);
    if (data?.length)
      await db.rpc("enqueue_http_job", {
        _url: `${base}/api/public/mercadolivre/refresh-tick`,
        _secret: secret,
        _body: {},
      });
  } catch {
    /* retry on next watchdog minute */
  }
  // Auditorias: a varredura de fotos segue por fatias (lease + cursor de URL). A
  // etapa final leva mais que o limite de 60s de uma chamada HTTP, então uma
  // corrida parada há 2 minutos é agendada no cron do banco para terminar sozinha.
  const { data: auditRuns } = await db
    .from("audit_runs")
    .select("id,image_scan_started,image_scan_done,updated_at")
    .eq("status", "processando")
    .limit(20);
  for (const run of auditRuns ?? []) {
    if (run.image_scan_started && !run.image_scan_done) {
      for (let i = 0; i < IMAGE_AUDIT_SHARDS; i++) {
        await db.rpc("enqueue_http_job", {
          _url: `${base}/api/public/bling/image-audit-tick`,
          _secret: secret,
          _body: { job_id: run.id },
        });
      }
    }
    if (!run.updated_at || run.updated_at < staleIso) {
      await db.rpc("schedule_audit_finish", { _run_id: run.id });
    }
  }
  out.audit_runs = (auditRuns ?? []).length;
  for (const s of SPECS) {
    try {
      let q = db.from(s.table).select("id").in("status", s.statuses).limit(20);
      if (s.staleCol) q = q.lt(s.staleCol, staleIso);
      else q = q.or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`);
      const { data, error } = await q;
      if (error) continue;
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
      for (const id of ids) {
        if (s.rpc === "sync") {
          await db.rpc("enqueue_bling_sync_tick", {
            _url: `${base}${s.path}`,
            _secret: secret,
            _job_id: id,
          });
        } else {
          await db.rpc("enqueue_http_job", {
            _url: `${base}${s.path}`,
            _secret: secret,
            _body: { job_id: id, ...(s.extra ?? {}) },
          });
        }
      }
      out[s.table] = ids.length;
    } catch {
      /* best-effort por fila */
    }
  }
  // Imagens CDN: o tick escolhe sozinho a tarefa ativa.
  try {
    const { data } = await db
      .from("cdn_image_jobs_v2")
      .select("id")
      .in("status", ["inventario", "preparando", "processando"])
      .limit(1);
    if ((data ?? []).length) {
      await db.rpc("enqueue_http_job", {
        _url: `${base}/api/public/cdn-images/tick`,
        _secret: secret,
        _body: {},
      });
      out.cdn_image_jobs_v2 = 1;
    }
  } catch {
    /* best-effort */
  }
  // Rotação CDN: planeja somente quando a política periódica estiver habilitada
  // e retoma jobs vencidos. A configuração nasce desligada.
  try {
    const { planDueCdnRotations } = await import("@/lib/cdn-rotation.server");
    const planned = await planDueCdnRotations();
    out.cdn_rotations_planned = planned.planned;
    const { data } = await db
      .from("cdn_key_rotation_jobs")
      .select("id")
      .in("status", [
        "planned",
        "activating",
        "stabilizing",
        "preparing",
        "pushing",
        "verifying",
        "grace",
        "revoking",
        "rolling_back",
      ])
      .lte("next_tick_at", now.toISOString())
      .limit(1);
    if ((data ?? []).length) {
      await db.rpc("enqueue_http_job", {
        _url: `${base}/api/public/cdn-rotation/tick`,
        _secret: secret,
        _body: {},
      });
      out.cdn_key_rotation_jobs = 1;
    }
  } catch {
    /* migration/configuração ainda não instalada: tenta no próximo minuto */
  }
  return out;
}
