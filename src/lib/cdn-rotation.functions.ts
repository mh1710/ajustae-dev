/* eslint-disable @typescript-eslint/no-explicit-any -- temporary until the new migration is applied and Supabase types are regenerated */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { nextRotationAt } from "@/lib/cdn-rotation";

async function assertGlobalAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Acesso restrito a administradores do sistema.");
}

export const adminGetCdnRotationDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertGlobalAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [settingsResult, integrationsResult, versionsResult, jobsResult] = await Promise.all([
      db.from("cdn_rotation_settings").select("*").eq("singleton", true).single(),
      db
        .from("bling_integrations")
        .select(
          "id,company_id,status,cdn_signature,cdn_signature_active,cdn_key_version_id,companies(nome)",
        )
        .eq("status", "conectada")
        .order("created_at"),
      db
        .from("cdn_key_versions")
        .select(
          "id,integration_id,public_id,format,generation,status,activated_at,retire_after,revoked_at,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("cdn_key_rotation_jobs")
        .select(
          "id,company_id,integration_id,trigger_type,status,total_products,processed_products,confirmed_products,conflict_products,error_products,skipped_products,old_key_version_id,new_key_version_id,grace_until,revoke_approved_at,external_consumers_confirmed_at,purge_request_id,last_error,created_at,finished_at",
        )
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    for (const result of [settingsResult, integrationsResult, versionsResult, jobsResult]) {
      if (result.error) throw new Error(result.error.message);
    }
    return {
      settings: settingsResult.data,
      integrations: integrationsResult.data ?? [],
      versions: versionsResult.data ?? [],
      jobs: jobsResult.data ?? [],
    };
  });

const settingsInput = z.object({
  enabled: z.boolean(),
  mode: z.enum(["manual", "event_driven", "periodic"]),
  interval_days: z.number().int().min(30).max(730),
  grace_days: z.number().int().min(2).max(90),
  start_hour: z.number().int().min(0).max(23),
  timezone: z.string().trim().min(1).max(80).default("America/Sao_Paulo"),
  max_products_per_day: z.number().int().min(1).max(40000),
  require_revoke_approval: z.boolean(),
});

export const adminSaveCdnRotationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => settingsInput.parse(value))
  .handler(async ({ data, context }) => {
    await assertGlobalAdmin(context);
    if (data.mode !== "periodic" && data.enabled) {
      throw new Error(
        "O agendamento só pode ser ativado no modo periódico. Use ações manuais nos outros modos.",
      );
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nextRun = data.enabled
      ? nextRotationAt(new Date(), data.interval_days, data.start_hour, data.timezone).toISOString()
      : null;
    const { error } = await (supabaseAdmin as any)
      .from("cdn_rotation_settings")
      .update({
        ...data,
        next_run_at: nextRun,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("singleton", true);
    if (error) throw new Error(error.message);
    await (supabaseAdmin as any).from("cdn_key_rotation_audit").insert({
      actor_id: context.userId,
      action: "settings_updated",
      details: { ...data, next_run_at: nextRun },
    });
    return { ok: true, next_run_at: nextRun };
  });

export const adminStartCdnRotation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z
      .object({
        integration_id: z.string().uuid(),
        kind: z.enum(["dry_run", "pilot", "full"]),
        external_consumers_confirmed: z.boolean().default(false),
        consumer_scope: z.enum(["bling_only", "bling_and_channels"]).default("bling_only"),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    await assertGlobalAdmin(context);
    if (data.kind !== "dry_run" && !data.external_consumers_confirmed) {
      throw new Error(
        "Confirme que consumidores externos foram inventariados antes de iniciar uma rotação real.",
      );
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: integration, error: integrationError } = await db
      .from("bling_integrations")
      .select("id,company_id,status")
      .eq("id", data.integration_id)
      .single();
    if (integrationError || !integration)
      throw new Error(integrationError?.message ?? "Integração não encontrada.");
    if (integration.status !== "conectada")
      throw new Error("A integração precisa estar conectada.");
    const { data: settings, error: settingsError } = await db
      .from("cdn_rotation_settings")
      .select("*")
      .eq("singleton", true)
      .single();
    if (settingsError) throw new Error(settingsError.message);
    const now = new Date().toISOString();
    const { data: job, error } = await db
      .from("cdn_key_rotation_jobs")
      .insert({
        company_id: integration.company_id,
        integration_id: integration.id,
        created_by: context.userId,
        trigger_type: data.kind === "dry_run" ? "dry_run" : "manual",
        settings_snapshot: settings,
        product_limit: data.kind === "full" ? null : 10,
        consumer_scope: data.consumer_scope,
        external_consumers_confirmed_by: data.external_consumers_confirmed ? context.userId : null,
        external_consumers_confirmed_at: data.external_consumers_confirmed ? now : null,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("Esta integração já possui uma rotação ativa.");
      throw new Error(error.message);
    }
    await db.from("cdn_key_rotation_audit").insert({
      job_id: job.id,
      actor_id: context.userId,
      action: "job_created",
      details: { kind: data.kind, consumer_scope: data.consumer_scope },
    });
    try {
      const { enqueueCdnRotationTick } = await import("@/lib/cdn-rotation.server");
      await enqueueCdnRotationTick(job.id);
    } catch (enqueueError) {
      await db
        .from("cdn_key_rotation_jobs")
        .update({
          status: "paused",
          resume_status: "planned",
          last_error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
        })
        .eq("id", job.id);
      throw enqueueError;
    }
    return { id: job.id };
  });

export const adminCdnRotationAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        action: z.enum([
          "pause",
          "resume",
          "expand_full",
          "confirm_consumers",
          "rollback",
          "cancel",
          "approve_revoke",
        ]),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    await assertGlobalAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: job, error } = await db
      .from("cdn_key_rotation_jobs")
      .select("*")
      .eq("id", data.job_id)
      .single();
    if (error || !job) throw new Error(error?.message ?? "Rotação não encontrada.");
    const now = new Date().toISOString();
    if (data.action === "pause") {
      if (["completed", "cancelled", "rolled_back"].includes(job.status))
        throw new Error("A rotação já terminou.");
      checkedUpdate(
        await db
          .from("cdn_key_rotation_jobs")
          .update({ status: "paused", resume_status: job.status, updated_at: now })
          .eq("id", job.id),
      );
    } else if (data.action === "cancel") {
      if (["revoking", "completed"].includes(job.status))
        throw new Error("Não é possível cancelar depois do início da revogação.");
      if (job.trigger_type === "dry_run") {
        if (job.new_key_version_id) {
          const { data: version } = await db
            .from("cdn_key_versions")
            .select("id,public_id,status")
            .eq("id", job.new_key_version_id)
            .maybeSingle();
          if (version && version.status !== "revoked") {
            const { setCdnKeyVersionStatus } = await import("@/lib/cdn-worker.server");
            await setCdnKeyVersionStatus(version.public_id, "revoke");
            await db
              .from("cdn_key_versions")
              .update({ status: "revoked", revoked_at: now, updated_at: now })
              .eq("id", version.id);
          }
        }
        checkedUpdate(
          await db
            .from("cdn_key_rotation_jobs")
            .update({ status: "cancelled", finished_at: now, updated_at: now })
            .eq("id", job.id),
        );
      } else {
        checkedUpdate(
          await db
            .from("cdn_key_rotation_jobs")
            .update({
              status: "paused",
              resume_status:
                job.status === "paused" ? (job.resume_status ?? "pushing") : job.status,
              last_error:
                "Execução interrompida com segurança. As duas chaves continuam válidas; retome ou faça rollback.",
              updated_at: now,
            })
            .eq("id", job.id),
        );
      }
    } else if (data.action === "approve_revoke") {
      if (job.status !== "awaiting_revoke")
        throw new Error("A rotação ainda não passou por todos os gates de revogação.");
      checkedUpdate(
        await db
          .from("cdn_key_rotation_jobs")
          .update({
            status: "revoking",
            resume_status: null,
            revoke_approved_by: context.userId,
            revoke_approved_at: now,
            next_tick_at: now,
            updated_at: now,
          })
          .eq("id", job.id),
      );
    } else if (data.action === "confirm_consumers") {
      if (job.external_consumers_confirmed_at)
        throw new Error("Consumidores externos já foram confirmados.");
      if (!job.grace_until)
        throw new Error("A confirmação só é aceita depois da atualização dos produtos.");
      checkedUpdate(
        await db
          .from("cdn_key_rotation_jobs")
          .update({
            external_consumers_confirmed_by: context.userId,
            external_consumers_confirmed_at: now,
            status: job.status === "paused" && job.resume_status === "grace" ? "grace" : job.status,
            resume_status:
              job.status === "paused" && job.resume_status === "grace" ? null : job.resume_status,
            last_error:
              job.status === "paused" && job.resume_status === "grace" ? null : job.last_error,
            next_tick_at: now,
            updated_at: now,
          })
          .eq("id", job.id),
      );
    } else if (data.action === "rollback") {
      if (!["paused", "grace", "awaiting_revoke"].includes(job.status)) {
        throw new Error("Rollback só pode começar antes da revogação da chave antiga.");
      }
      checkedUpdate(
        await db
          .from("cdn_key_rotation_jobs")
          .update({
            status: "rolling_back",
            resume_status: null,
            last_error: null,
            next_tick_at: now,
            updated_at: now,
          })
          .eq("id", job.id),
      );
    } else if (data.action === "expand_full") {
      if (!["paused", "grace", "awaiting_revoke"].includes(job.status)) {
        throw new Error("A expansão deve partir de um piloto pausado ou em período de graça.");
      }
      checkedUpdate(
        await db
          .from("cdn_key_rotation_jobs")
          .update({
            status: "preparing",
            resume_status: null,
            product_limit: null,
            prepare_cursor: null,
            grace_until: null,
            last_error: null,
            next_tick_at: now,
            updated_at: now,
          })
          .eq("id", job.id),
      );
    } else {
      if (job.status !== "paused")
        throw new Error("Somente uma rotação pausada pode ser retomada.");
      const resumeStatus = job.resume_status ?? "pushing";
      const { data: items } = await db
        .from("cdn_key_rotation_items")
        .select("id,product_id")
        .eq("job_id", job.id)
        .in("status", ["error", "conflict"]);
      if (resumeStatus === "pushing" && !(items ?? []).length && job.product_limit) {
        throw new Error(
          "O piloto terminou. Use “Expandir para todos” para migrar os produtos restantes.",
        );
      }
      if (
        resumeStatus === "grace" &&
        !(items ?? []).length &&
        job.grace_until &&
        !job.external_consumers_confirmed_at
      ) {
        throw new Error("Confirme os consumidores externos antes de continuar.");
      }
      for (const item of resumeStatus === "pushing" ? (items ?? []) : []) {
        const { data: product } = await db
          .from("bling_products")
          .select("updated_at")
          .eq("id", item.product_id)
          .maybeSingle();
        await db
          .from("cdn_key_rotation_items")
          .update({
            status: "cdn_validated",
            product_updated_at_snapshot: product?.updated_at ?? null,
            error: null,
            finished_at: null,
            next_retry_at: now,
            updated_at: now,
          })
          .eq("id", item.id);
      }
      checkedUpdate(
        await db
          .from("cdn_key_rotation_jobs")
          .update({
            status: resumeStatus,
            resume_status: null,
            last_error: null,
            next_tick_at: now,
            updated_at: now,
          })
          .eq("id", job.id),
      );
    }
    await db.from("cdn_key_rotation_audit").insert({
      job_id: job.id,
      actor_id: context.userId,
      action: data.action,
    });
    if (
      ["resume", "expand_full", "confirm_consumers", "rollback", "approve_revoke"].includes(
        data.action,
      )
    ) {
      const { enqueueCdnRotationTick } = await import("@/lib/cdn-rotation.server");
      await enqueueCdnRotationTick(job.id);
    }
    return { ok: true };
  });

function checkedUpdate(result: { error?: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
}
