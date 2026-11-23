import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AI_FEATURES_ENABLED, AI_DISABLED_MESSAGE } from "@/lib/ai-features";

export type AiJobKind = "shorten_title" | "remove_warranty" | "expand_short_desc" | "find_ean";

export type AiJobProgress = {
  id: string;
  kind: AiJobKind;
  status:
    | "pendente"
    | "executando"
    | "pausado_creditos"
    | "pausado_limite"
    | "concluido"
    | "cancelado"
    | "erro";
  total: number;
  done: number;
  updated_count: number;
  errors: number;
  last_sku: string | null;
  last_error: string | null;
  created_at: string;
  finished_at: string | null;
};

export const AI_JOB_LABELS: Record<AiJobKind, string> = {
  shorten_title: "Encurtando títulos",
  remove_warranty: "Removendo garantia/Anatel",
  expand_short_desc: "Expandindo descrições curtas",
  find_ean: "Buscando EAN/GTIN",
};

async function assertMember(ctx: { supabase: any; userId: string }, companyId: string) {
  const { data, error } = await ctx.supabase
    .from("company_users")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", ctx.userId)
    .eq("ativo", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sem acesso a esta empresa.");
}

/** Cria (ou reaproveita) a tarefa em segundo plano e dá o primeiro empurrão no worker. */
export const enqueueAiTransformJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        kind: z.enum(["shorten_title", "remove_warranty", "expand_short_desc", "find_ean"]),
        product_ids: z.array(z.string().uuid()).min(1),
        params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!AI_FEATURES_ENABLED) throw new Error(AI_DISABLED_MESSAGE);
    await assertMember(context, data.company_id);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: result, error } = await admin.rpc("enqueue_ai_transform_job", {
      _company_id: data.company_id,
      _kind: data.kind,
      _product_ids: data.product_ids,
      _params: data.params ?? {},
    });
    if (error) throw new Error(error.message);

    const jobId = (result as any)?.job_id as string | null;
    const total = Number((result as any)?.total ?? 0);

    // Empurrão inicial: o worker também é reencadeado pelo agendamento do servidor.
    const secret = (process.env.BLING_WORKER_SECRET ?? "").trim();
    const base = (process.env.APP_PUBLIC_URL ?? "").replace(/\/$/, "");
    if (jobId && secret && base) {
      try {
        await admin.rpc("enqueue_http_job", {
          _url: `${base}/api/public/ai/tick`,
          _secret: secret,
          _body: { job_id: jobId },
        });
      } catch {
        /* o agendamento periódico assume a partir daqui */
      }
    }

    return { job_id: jobId, queued: total };
  });

/** Estado das transformações de IA da empresa (para o indicador flutuante). */
export const listAiTransformJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).rpc("get_ai_transform_progress", {
      _company_id: data.company_id,
    });
    if (error) throw new Error(error.message);
    return (Array.isArray(result) ? result : []) as AiJobProgress[];
  });

export const cancelAiTransformJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("cancel_ai_transform_job", {
      _job_id: data.job_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resumeAiTransformJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("resume_ai_transform_job", {
      _job_id: data.job_id,
    });
    if (error) throw new Error(error.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const secret = (process.env.BLING_WORKER_SECRET ?? "").trim();
    const base = (process.env.APP_PUBLIC_URL ?? "").replace(/\/$/, "");
    if (secret && base) {
      try {
        await (supabaseAdmin as any).rpc("enqueue_http_job", {
          _url: `${base}/api/public/ai/tick`,
          _secret: secret,
          _body: { job_id: data.job_id },
        });
      } catch {
        /* o agendamento periódico assume a partir daqui */
      }
    }
    return { ok: true };
  });
