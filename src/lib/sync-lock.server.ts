import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ActiveSync = {
  kind: "produtos" | "multilojas" | "envio" | "automacao" | "verificacao" | "campos" | "pedidos";
  label: string;
  detail?: string;
  id?: string | null;
  paused?: boolean;
};

const JOB_ACTIVE = ["pendente", "catalogando", "processando", "pausada_por_limite", "retomando", "cancelando"];

/**
 * Retorna a sincronização em andamento da empresa (se houver).
 * Uma empresa só pode ter uma operação de sincronização por vez.
 */
export async function getActiveSync(companyId: string): Promise<ActiveSync | null> {
  // 1) Sincronização de produtos (catálogo Bling)
  const { data: integ } = await supabaseAdmin
    .from("bling_integrations")
    .select("id")
    .eq("company_id", companyId)
    .maybeSingle();
  if (integ?.id) {
    const { data: job } = await supabaseAdmin
      .from("bling_sync_jobs")
      .select("id, status")
      .eq("integration_id", integ.id)
      .in("status", JOB_ACTIVE)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (job) {
      return {
        kind: "produtos",
        label: "Sincronização de produtos com o Bling",
        detail: String(job.status),
        id: job.id as string,
      };
    }
  }

  // 2) Sincronização de multilojas
  const { data: storeJob } = await supabaseAdmin
    .from("bling_store_sync_jobs")
    .select("id, status")
    .eq("company_id", companyId)
    .in("status", ["pendente", "processando", "retomando"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (storeJob) {
    return {
      kind: "multilojas",
      label: "Sincronização de multilojas",
      detail: String(storeJob.status),
      id: storeJob.id as string,
    };
  }

  // 3) Automação em execução
  const { data: run } = await supabaseAdmin
    .from("automation_runs")
    .select("id, slug, current_step")
    .eq("company_id", companyId)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (run) {
    // Nomes amigáveis: a chave interna "precos" é a etapa que grava o estoque
    // na base (a automação de estoque nunca altera preços).
    const STEP_LABELS: Record<string, string> = {
      fornecedores: "atualizando base dos fornecedores",
      precos: "atualizando estoque na base",
      status: "ativando/inativando produtos",
      sync: "enfileirando envio ao Bling",
    };
    const step = (run as { current_step?: string | null }).current_step ?? null;
    return {
      kind: "automacao",
      label: "Automação de estoque",
      detail: step ? (STEP_LABELS[step] ?? step) : undefined,
      id: run.id as string,
    };
  }


  // These resumable job tables have not yet reached the generated database types.
  const jobsClient = supabaseAdmin as any;
  const { data: existence } = await jobsClient.from("bling_existence_jobs")
    .select("id, done_count, total").eq("company_id", companyId)
    .in("status", ["pendente", "processando"]).limit(1).maybeSingle();
  if (existence) return {
    kind: "verificacao", label: "Verificação de produtos no Bling", id: existence.id,
    detail: `${existence.done_count} de ${existence.total} verificados`,
  };
  const { data: fields } = await jobsClient.from("bling_custom_field_jobs")
    .select("id, done_count, total").eq("company_id", companyId)
    .in("status", ["pendente", "processando"]).limit(1).maybeSingle();
  if (fields) return {
    kind: "campos", label: "Atualização de campos customizados", id: fields.id,
    detail: `${fields.done_count} de ${fields.total} processados`,
  };
  const { data: orders } = await supabaseAdmin.from("bling_orders_sync_jobs")
    .select("id, orders_found, pages_processed").eq("company_id", companyId)
    .in("status", ["pendente", "executando"]).limit(1).maybeSingle();
  if (orders) return {
    kind: "pedidos", label: "Sincronização de pedidos", id: orders.id,
    detail: `${orders.orders_found} pedidos · ${orders.pages_processed} páginas`,
  };

  // 4) Fila de envio ao Bling com itens pendentes/pausados/processando
  const counts = await Promise.all(
    (["pendente", "processando", "pausado"] as const).map(async (st) => {
      const { count } = await supabaseAdmin
        .from("bling_push_queue")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", st);
      return count ?? 0;
    }),
  );
  const [pendentes, processando, pausados] = counts;
  const emFila = pendentes + processando + pausados;
  if (emFila > 0) {
    return {
      kind: "envio",
      label: "Envio de alterações ao Bling",
      detail: `${pendentes + processando} na fila${pausados ? ` · ${pausados} pausado(s)` : ""}`,
      paused: pendentes + processando === 0 && pausados > 0,
    };
  }

  return null;
}

/**
 * Bloqueia uma nova sincronização enquanto outra estiver em andamento.
 * `allow` permite continuar quando a operação nova é a mesma já em curso.
 */
export async function assertNoActiveSync(companyId: string, allow: ActiveSync["kind"][] = []) {
  const active = await getActiveSync(companyId);
  if (!active || allow.includes(active.kind)) return;
  throw new Error(
    `Já existe uma sincronização em andamento nesta empresa: ${active.label}` +
      (active.detail ? ` (${active.detail})` : "") +
      ". Tente novamente mais tarde, após a conclusão.",
  );
}
