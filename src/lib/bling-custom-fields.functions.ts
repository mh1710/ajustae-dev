import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertMember(context: { supabase: any; userId: string }, companyId: string) {
  const { data, error } = await context.supabase.from("company_users").select("ativo")
    .eq("company_id", companyId).eq("user_id", context.userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.ativo) throw new Error("Sem acesso a esta empresa.");
}

export type CustomFieldJob = {
  id: string; kind: "sync" | "push" | "auto"; status: string; done_count: number; total: number; error_count: number;
  field_id: string | null; valor: string | null; last_error: string | null; started_at: string; lease_until: string | null;
};
export type CustomFieldOption = { id: number; nome: string };
export type CustomFieldDef = {
  id: string; bling_id_campo: string; nome: string | null; situacao: number | null;
  tipo: string | null; tipo_campo_id: number | null; opcoes: CustomFieldOption[] | null;
};
export type CustomFieldRow = { id: string; codigo: string | null; nome: string | null; situacao: string | null; valores: Record<string, string | null> };

const filterSchema = z.object({
  search: z.string().max(200).optional(),
  field_id: z.string().uuid().optional(),
  field_mode: z.enum(["vazio", "preenchido"]).optional(),
});

export const getCustomFieldsOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const [{ data: fields }, { data: jobs }] = await Promise.all([
      sb.from("bling_custom_fields").select("id, bling_id_campo, nome, situacao, tipo, tipo_campo_id, opcoes").eq("company_id", data.company_id).order("nome"),
      sb.from("bling_custom_field_jobs").select("id, kind, status, done_count, total, error_count, field_id, valor, last_error, started_at, lease_until")
        .eq("company_id", data.company_id).order("started_at", { ascending: false }).limit(5),
    ]);
    const list = (jobs ?? []) as CustomFieldJob[];
    // Recupera job sem worker ativo.
    for (const j of list) {
      if (j.status !== "executando") continue;
      const stale = !j.lease_until || new Date(j.lease_until).getTime() < Date.now() - 120_000;
      if (stale) {
        const { enqueueCustomFieldTick } = await import("./bling-custom-fields.server");
        await enqueueCustomFieldTick(j.id).catch(() => undefined);
      }
    }
    const { count } = await sb.from("bling_products").select("id", { count: "exact", head: true })
      .eq("company_id", data.company_id).not("bling_product_id", "is", null);
    const { data: roles } = await sb.from("bling_custom_field_roles").select("role, custom_field_id, valor").eq("company_id", data.company_id);
    const roleMap: Record<string, string> = {};
    const roleValores: Record<string, string | null> = {};
    for (const r of (roles ?? []) as any[]) { roleMap[r.role] = r.custom_field_id; roleValores[r.role] = r.valor ?? null; }
    return { fields: (fields ?? []) as CustomFieldDef[], jobs: list, total_products: count ?? 0, roles: roleMap, valores: roleValores };
  });

export const listProductCustomFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => filterSchema.extend({
    company_id: z.string().uuid(), page: z.number().int().min(0), page_size: z.number().int().min(10).max(200),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("list_product_custom_fields", {
      _company_id: data.company_id, _search: data.search || null, _field_id: data.field_id ?? null,
      _field_mode: data.field_mode ?? null, _limit: data.page_size, _offset: data.page * data.page_size,
    });
    if (error) throw new Error(error.message);
    return res as { total: number; rows: CustomFieldRow[] };
  });

async function getInteg(db: any, companyId: string) {
  const { data: integ } = await db.from("bling_integrations").select("id").eq("company_id", companyId).maybeSingle();
  if (!integ) throw new Error("Empresa sem integração com o Bling.");
  const { data: running } = await db.from("bling_custom_field_jobs").select("id")
    .eq("company_id", companyId).in("status", ["executando", "pausado"]).limit(1).maybeSingle();
  if (running) throw new Error("Já existe uma tarefa de campos customizados em andamento ou pausada. Retome ou cancele antes.");
  return integ.id as string;
}

export const startCustomFieldsSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const integration_id = await getInteg(db, data.company_id);
    const { count } = await db.from("bling_products").select("id", { count: "exact", head: true })
      .eq("company_id", data.company_id).not("bling_product_id", "is", null);
    const { data: job, error } = await db.from("bling_custom_field_jobs")
      .insert({ company_id: data.company_id, integration_id, kind: "sync", total: count ?? 0 }).select("id").single();
    if (error) throw new Error(error.message);
    const { processCustomFieldTick, enqueueCustomFieldTick } = await import("./bling-custom-fields.server");
    const r = await processCustomFieldTick(job.id, 12_000);
    if (!r.done && !r.stopped) await enqueueCustomFieldTick(job.id);
    return { job_id: job.id };
  });

export const clearLocalCustomFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid(), reset_definitions: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: restricted, error: accessError } = await (context.supabase as any).rpc("is_company_restricted");
    if (accessError || restricted) throw new Error("Sem permissão para limpar campos customizados.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await (supabaseAdmin as any).rpc("clear_local_custom_fields", {
      _company_id: data.company_id, _reset_definitions: data.reset_definitions,
    });
    if (error) throw new Error(error.message);
    return result as { values_deleted: number; fields_deleted: number };
  });

export const refreshCustomFieldDefinitions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const integrationId = await getInteg(db, data.company_id);
    const { data: integ, error } = await db.from("bling_integrations").select("*").eq("id", integrationId).single();
    if (error) throw new Error(error.message);
    const { syncCustomFieldDefinitions } = await import("./bling-custom-fields.server");
    return { count: await syncCustomFieldDefinitions(integ, data.company_id) };
  });

export const startCustomFieldsBulkEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    target_field_id: z.string().uuid(),
    valor: z.string().max(2000),
    product_ids: z.array(z.string().uuid()).max(5000).optional(),
    filter: filterSchema.optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const integration_id = await getInteg(db, data.company_id);
    const { data: cf } = await db.from("bling_custom_fields").select("id").eq("id", data.target_field_id).eq("company_id", data.company_id).maybeSingle();
    if (!cf) throw new Error("Campo customizado não encontrado nesta empresa.");
    const { data: job, error } = await db.from("bling_custom_field_jobs")
      .insert({ company_id: data.company_id, integration_id, kind: "push", field_id: data.target_field_id, valor: data.valor, status: "pausado" })
      .select("id").single();
    if (error) throw new Error(error.message);
    const f = data.filter ?? {};
    const { data: n, error: e2 } = await db.rpc("fill_custom_field_push_items", {
      _job_id: job.id, _company_id: data.company_id, _product_ids: data.product_ids?.length ? data.product_ids : null,
      _search: f.search || null, _field_id: f.field_id ?? null, _field_mode: f.field_mode ?? null,
    });
    if (e2) { await db.from("bling_custom_field_jobs").delete().eq("id", job.id); throw new Error(e2.message); }
    if (!n) { await db.from("bling_custom_field_jobs").delete().eq("id", job.id); throw new Error("Nenhum produto encontrado para editar."); }
    await db.from("bling_custom_field_jobs").update({ status: "executando" }).eq("id", job.id);
    const { processCustomFieldTick, enqueueCustomFieldTick } = await import("./bling-custom-fields.server");
    const r = await processCustomFieldTick(job.id, 12_000);
    if (!r.done && !r.stopped) await enqueueCustomFieldTick(job.id);
    return { job_id: job.id, total: n as number };
  });

export const controlCustomFieldJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(), job_id: z.string().uuid(), action: z.enum(["pause", "resume", "cancel"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const status = data.action === "pause" ? "pausado" : data.action === "cancel" ? "cancelado" : "executando";
    const patch: Record<string, unknown> = { status };
    if (data.action === "cancel") patch.finished_at = new Date().toISOString();
    if (data.action === "resume") patch.last_error = null;
    const { error } = await db.from("bling_custom_field_jobs").update(patch).eq("id", data.job_id).eq("company_id", data.company_id);
    if (error) throw new Error(error.message);
    if (data.action === "resume") {
      const { enqueueCustomFieldTick } = await import("./bling-custom-fields.server");
      await enqueueCustomFieldTick(data.job_id);
    }
    return { ok: true };
  });

export type CustomFieldErrorItem = { product_id: string; codigo: string | null; nome: string | null; erro: string | null };

export const listCustomFieldJobErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid(), job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: job } = await db.from("bling_custom_field_jobs").select("id").eq("id", data.job_id).eq("company_id", data.company_id).maybeSingle();
    if (!job) throw new Error("Tarefa não encontrada.");
    const { data: items, error } = await db.from("bling_custom_field_push_items")
      .select("product_id, erro, bling_products(codigo, nome)").eq("job_id", data.job_id).eq("status", "erro").limit(1000);
    if (error) throw new Error(error.message);
    return ((items ?? []) as any[]).map((i) => ({
      product_id: i.product_id, erro: i.erro, codigo: i.bling_products?.codigo ?? null, nome: i.bling_products?.nome ?? null,
    })) as CustomFieldErrorItem[];
  });

/** Volta itens com erro para a fila e retoma a tarefa (todos ou só os informados). */
export const retryCustomFieldErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(), job_id: z.string().uuid(), product_ids: z.array(z.string().uuid()).max(1000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: job } = await db.from("bling_custom_field_jobs").select("id, status, kind, error_count")
      .eq("id", data.job_id).eq("company_id", data.company_id).maybeSingle();
    if (!job || job.kind === "sync") throw new Error("Tarefa não encontrada.");
    const { data: other } = await db.from("bling_custom_field_jobs").select("id")
      .eq("company_id", data.company_id).in("status", ["executando", "pausado"]).neq("id", data.job_id).limit(1).maybeSingle();
    if (other) throw new Error("Há outra tarefa de campos customizados em andamento. Aguarde ou cancele antes.");
    let q = db.from("bling_custom_field_push_items").update({ status: "pendente", erro: null })
      .eq("job_id", data.job_id).eq("status", "erro");
    if (data.product_ids?.length) q = q.in("product_id", data.product_ids);
    const { data: upd, error } = await q.select("product_id");
    if (error) throw new Error(error.message);
    const n = (upd ?? []).length;
    if (n === 0) throw new Error("Nenhum item com erro para refazer.");
    await db.from("bling_custom_field_jobs").update({
      status: "executando", error_count: Math.max(0, (job.error_count ?? 0) - n), lease_until: null, last_error: null, finished_at: null,
    }).eq("id", data.job_id);
    const { processCustomFieldTick, enqueueCustomFieldTick } = await import("./bling-custom-fields.server");
    const r = await processCustomFieldTick(data.job_id, 8_000);
    if (!r.done && !r.stopped) await enqueueCustomFieldTick(data.job_id);
    return { retried: n };
  });

export const CUSTOM_FIELD_ROLES = ["mapa", "anvisa", "anatel_homologacao", "anatel", "garantia", "garantia_extenso", "modelo"] as const;

export const saveCustomFieldRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    roles: z.record(z.enum(CUSTOM_FIELD_ROLES), z.string().uuid().nullable()),
    valores: z.record(z.enum(CUSTOM_FIELD_ROLES), z.string().max(200).nullable()).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    for (const [role, cf] of Object.entries(data.roles)) {
      if (!cf) { await db.from("bling_custom_field_roles").delete().eq("company_id", data.company_id).eq("role", role); continue; }
      const { data: ok } = await db.from("bling_custom_fields").select("id").eq("id", cf).eq("company_id", data.company_id).maybeSingle();
      if (!ok) throw new Error("Campo inválido para esta empresa.");
      const { error } = await db.from("bling_custom_field_roles").upsert(
        { company_id: data.company_id, role, custom_field_id: cf, valor: data.valores?.[role as (typeof CUSTOM_FIELD_ROLES)[number]] ?? null, updated_at: new Date().toISOString() }, { onConflict: "company_id,role" });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const startCustomFieldsAuto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    product_ids: z.array(z.string().uuid()).max(5000).optional(),
    filter: filterSchema.optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { count: nRoles } = await db.from("bling_custom_field_roles").select("role", { count: "exact", head: true }).eq("company_id", data.company_id);
    if (!nRoles) throw new Error("Aponte primeiro qual campo é cada um (Mapa, Anvisa, Anatel, Garantia, Modelo).");
    const integration_id = await getInteg(db, data.company_id);
    const { data: job, error } = await db.from("bling_custom_field_jobs")
      .insert({ company_id: data.company_id, integration_id, kind: "auto", status: "pausado" }).select("id").single();
    if (error) throw new Error(error.message);
    const f = data.filter ?? {};
    const { data: n, error: e2 } = await db.rpc("fill_custom_field_push_items", {
      _job_id: job.id, _company_id: data.company_id, _product_ids: data.product_ids?.length ? data.product_ids : null,
      _search: f.search || null, _field_id: f.field_id ?? null, _field_mode: f.field_mode ?? null,
    });
    if (e2) { await db.from("bling_custom_field_jobs").delete().eq("id", job.id); throw new Error(e2.message); }
    if (!n) { await db.from("bling_custom_field_jobs").delete().eq("id", job.id); throw new Error("Nenhum produto encontrado."); }
    await db.from("bling_custom_field_jobs").update({ status: "executando" }).eq("id", job.id);
    const { processCustomFieldTick, enqueueCustomFieldTick } = await import("./bling-custom-fields.server");
    const r = await processCustomFieldTick(job.id, 12_000);
    if (!r.done && !r.stopped) await enqueueCustomFieldTick(job.id);
    return { job_id: job.id, total: n as number };
  });
