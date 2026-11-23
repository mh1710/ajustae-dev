import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  activateCdnSignature,
  deactivateCdnSignature,
  enqueueCdnImageTick,
} from "@/lib/cdn-images.server";
import { assertCdnPurgeConfigured, purgeCdnPublicId } from "@/lib/cdn-worker.server";

async function assertAdmin(context: any, companyId: string) {
  const { data, error } = await context.supabase
    .from("company_users")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .eq("ativo", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Somente administradores podem gerenciar imagens e assinaturas CDN.");
}

async function adminCompanies(context: any) {
  const { data, error } = await context.supabase
    .from("company_users")
    .select("company_id")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .eq("ativo", true);
  if (error) throw new Error(error.message);
  return Array.from(new Set((data ?? []).map((row: any) => String(row.company_id))));
}

const integrationInput = z.object({
  company_id: z.string().uuid(),
  integration_id: z.string().uuid(),
});

async function createSignatureRecord(db: any, item: z.infer<typeof integrationInput>) {
  const current = (
    await db
      .from("bling_integrations")
      .select("id,cdn_signature,cdn_signature_active,cdn_key_version_id")
      .eq("id", item.integration_id)
      .eq("company_id", item.company_id)
      .maybeSingle()
  ).data;
  if (!current) throw new Error("Integração não encontrada.");
  if (current.cdn_key_version_id || (current.cdn_signature && current.cdn_signature_active)) {
    throw new Error(
      "A integração já possui uma versão CDN ativa. Use Segurança da CDN para rotacionar sem quebrar links.",
    );
  }
  const signature = `cdn_${crypto.randomUUID().replaceAll("-", "")}`;
  await activateCdnSignature(signature);
  const { error } = await db
    .from("bling_integrations")
    .update({
      cdn_signature: signature,
      cdn_signature_active: true,
      cdn_signature_updated_at: new Date().toISOString(),
    })
    .eq("id", item.integration_id)
    .eq("company_id", item.company_id);
  if (error) {
    await deactivateCdnSignature(signature).catch(() => undefined);
    throw new Error(error.message);
  }
  return signature;
}

async function revokeSignatureRecord(
  db: any,
  item: z.infer<typeof integrationInput> & { signature: string },
) {
  const current = (
    await db
      .from("bling_integrations")
      .select("cdn_signature")
      .eq("id", item.integration_id)
      .eq("company_id", item.company_id)
      .maybeSingle()
  ).data;
  if (!current || current.cdn_signature !== item.signature)
    throw new Error("A assinatura não pertence a esta integração.");
  const { count, error: countError } = await db
    .from("bling_products")
    .select("id", { count: "exact", head: true })
    .eq("integration_id", item.integration_id)
    .or(
      `url_imagens_externas.ilike.%${item.signature}%,imagem_principal_url.ilike.%${item.signature}%`,
    );
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) > 0)
    throw new Error(
      "A assinatura ainda é usada por produtos. Faça uma rotação confirmada antes de revogar.",
    );
  assertCdnPurgeConfigured();
  await deactivateCdnSignature(item.signature);
  await purgeCdnPublicId(item.signature, "v1");
  const { error } = await db
    .from("bling_integrations")
    .update({ cdn_signature_active: false, cdn_signature_updated_at: new Date().toISOString() })
    .eq("id", item.integration_id)
    .eq("company_id", item.company_id);
  if (error) throw new Error(error.message);
}

export const createCdnIntegrationSignature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => integrationInput.parse(value))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const signature = await createSignatureRecord(db, data);
    return { signature, base_url: process.env.CDN_BASE_URL ?? "" };
  });

export const revokeCdnIntegrationSignature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    integrationInput.extend({ signature: z.string().regex(/^cdn_[a-f0-9]{32}$/i) }).parse(value),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    await revokeSignatureRecord(db, data);
    return { ok: true };
  });

export const createCdnIntegrationSignaturesBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z.object({ items: z.array(integrationInput).min(1).max(100) }).parse(value),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const created: string[] = [];
    for (const item of data.items) {
      await assertAdmin(context, item.company_id);
      created.push(await createSignatureRecord(db, item));
    }
    return { processed: created.length, signatures: created };
  });

export const revokeCdnIntegrationSignaturesBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z
      .object({
        items: z
          .array(integrationInput.extend({ signature: z.string() }))
          .min(1)
          .max(100),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    let processed = 0;
    for (const item of data.items) {
      await assertAdmin(context, item.company_id);
      await revokeSignatureRecord(db, item);
      processed++;
    }
    return { processed };
  });

const startInput = z.object({
  company_id: z.string().uuid().optional(),
  product_ids: z.array(z.string().uuid()).max(20000).default([]),
});

async function startJob(context: any, data: z.infer<typeof startInput>) {
  const allowed = data.company_id
    ? (await assertAdmin(context, data.company_id), [data.company_id])
    : await adminCompanies(context);
  if (!allowed.length) throw new Error("Nenhuma empresa administrável encontrada.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  if (data.product_ids.length) {
    const owned = new Set<string>();
    for (let index = 0; index < data.product_ids.length; index += 200) {
      const { data: rows, error } = await db
        .from("bling_products")
        .select("id")
        .in("company_id", allowed)
        .in("id", data.product_ids.slice(index, index + 200));
      if (error) throw new Error(error.message);
      for (const row of rows ?? []) owned.add(row.id);
    }
    if (owned.size !== new Set(data.product_ids).size)
      throw new Error("A seleção contém produtos inexistentes ou fora do seu acesso.");
  }
  const { data: job, error } = await db
    .from("cdn_image_jobs_v2")
    .insert({
      created_by: context.userId,
      company_ids: allowed,
      selected_product_ids: data.product_ids,
      status: "inventario",
      next_tick_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error || !job) throw new Error(error?.message ?? "Não foi possível criar a propagação.");
  try {
    await enqueueCdnImageTick(job.id);
  } catch (enqueueError) {
    await db
      .from("cdn_image_jobs_v2")
      .update({
        status: "erro",
        last_error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    throw enqueueError;
  }
  return job;
}

export const startCdnImagePropagationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => startInput.parse(value ?? {}))
  .handler(async ({ data, context }) => startJob(context, data));

export const propagateCdnImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_ids: z.array(z.string().uuid()).min(1).max(20000),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => startJob(context, data));

export const propagateAllCdnImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ company_id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) =>
    startJob(context, { company_id: data.company_id, product_ids: [] }),
  );

export const getCdnImagePropagationJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ job_id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const { data: job, error } = await (context.supabase as any)
      .from("cdn_image_jobs_v2")
      .select("*")
      .eq("id", data.job_id)
      .single();
    if (error || !job) throw new Error(error?.message ?? "Propagação não encontrada.");
    return job;
  });

export const listCdnImagePropagationJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z.object({ company_id: z.string().uuid().optional() }).parse(value ?? {}),
  )
  .handler(async ({ data, context }) => {
    const allowed = data.company_id
      ? (await assertAdmin(context, data.company_id), [data.company_id])
      : await adminCompanies(context);
    if (!allowed.length) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: jobs, error } = await (supabaseAdmin as any)
      .from("cdn_image_jobs_v2")
      .select("*")
      .overlaps("company_ids", allowed)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return jobs ?? [];
  });

export const cancelCdnImagePropagationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ job_id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const job = (
      await db.from("cdn_image_jobs_v2").select("company_ids").eq("id", data.job_id).single()
    ).data;
    if (!job) throw new Error("Propagação não encontrada.");
    for (const companyId of job.company_ids) await assertAdmin(context, companyId);
    await db
      .from("cdn_image_jobs_v2")
      .update({ status: "cancelado", finished_at: new Date().toISOString() })
      .eq("id", data.job_id)
      .in("status", ["inventario", "preparando", "processando"]);
    await db
      .from("cdn_image_job_items_v2")
      .update({
        status: "cancelado",
        reason: "Propagação cancelada pelo administrador.",
        finished_at: new Date().toISOString(),
      })
      .eq("job_id", data.job_id)
      .in("status", ["pendente", "processando"]);
    return { ok: true };
  });

export const resumeCdnImagePropagationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ job_id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const job = (
      await db.from("cdn_image_jobs_v2").select("company_ids,status").eq("id", data.job_id).single()
    ).data;
    if (!job) throw new Error("Propagação não encontrada.");
    for (const companyId of job.company_ids) await assertAdmin(context, companyId);
    if (!["inventario", "preparando", "processando"].includes(job.status))
      throw new Error("Este job não está em andamento.");
    const now = new Date().toISOString();
    const { data: resumed, error } = await db
      .from("cdn_image_jobs_v2")
      .update({
        next_tick_at: now,
        lease_token: null,
        lease_until: null,
        heartbeat_at: now,
      })
      .eq("id", data.job_id)
      .in("status", ["inventario", "preparando", "processando"])
      .or(`lease_until.is.null,lease_until.lt.${now}`)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!resumed) return { ok: true, busy: true };
    await enqueueCdnImageTick(data.job_id);
    return { ok: true, busy: false };
  });

export const retryCdnImagePropagationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ job_id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const job = (
      await db.from("cdn_image_jobs_v2").select("company_ids,status").eq("id", data.job_id).single()
    ).data;
    if (!job) throw new Error("Propagação não encontrada.");
    for (const companyId of job.company_ids) await assertAdmin(context, companyId);
    if (job.status !== "erro") throw new Error("Somente jobs com erro podem ser reiniciados.");
    await db
      .from("cdn_image_job_items_v2")
      .update({
        status: "pendente",
        error: null,
        reason: "Item retomado após correção do job.",
        finished_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("job_id", data.job_id)
      .eq("status", "processando");
    const { error } = await db
      .from("cdn_image_jobs_v2")
      .update({
        status: "inventario",
        inventory_sync_id: crypto.randomUUID(),
        inventory_cursor: null,
        inventory_scanned: 0,
        lease_token: null,
        lease_until: null,
        next_tick_at: new Date().toISOString(),
        last_error: null,
        finished_at: null,
      })
      .eq("id", data.job_id)
      .eq("status", "erro");
    if (error) throw new Error(error.message);
    await enqueueCdnImageTick(data.job_id);
    return { ok: true };
  });

export const listCdnPropagationReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        status: z
          .enum([
            "todos",
            "atualizado",
            "sem_imagem",
            "ja_cdn",
            "sem_integracao",
            "erro",
            "cancelado",
          ])
          .default("todos"),
        search: z.string().trim().max(100).default(""),
        page: z.number().int().min(0).default(0),
        page_size: z.number().int().min(10).max(200).default(50),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const job = (
      await db.from("cdn_image_jobs_v2").select("company_ids").eq("id", data.job_id).single()
    ).data;
    if (!job) throw new Error("Propagação não encontrada.");
    for (const companyId of job.company_ids) await assertAdmin(context, companyId);
    let query = db
      .from("cdn_image_job_items_v2")
      .select(
        "id,company_id,product_id,integration_id,codigo,cod_fornecedor,fornecedor,status,candidate_bases,image_keys,image_urls,reason,error,attempts,finished_at",
        { count: "exact" },
      )
      .eq("job_id", data.job_id)
      .order("codigo", { ascending: true })
      .range(data.page * data.page_size, (data.page + 1) * data.page_size - 1);
    if (data.status !== "todos") query = query.eq("status", data.status);
    if (data.search)
      query = query.or(
        `codigo.ilike.%${data.search.replace(/[,%()]/g, "")}%,cod_fornecedor.ilike.%${data.search.replace(/[,%()]/g, "")}%`,
      );
    const { data: items, count, error } = await query;
    if (error) throw new Error(error.message);
    return { items: items ?? [], total: count ?? 0, page: data.page, page_size: data.page_size };
  });
