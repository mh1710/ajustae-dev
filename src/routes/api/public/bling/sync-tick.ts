import { createFileRoute } from "@tanstack/react-router";

type ClaimRow = {
  claimed: boolean;
  job_id: string | null;
  integration_id: string | null;
  company_id: string | null;
  phase: string | null;
  reason: string | null;
};

async function updateJobTrace(jobId: string | null, patch: Record<string, unknown>) {
  if (!jobId) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("bling_sync_jobs")
    .update({
      ...patch,
      worker_last_heartbeat_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    } as never)
    .eq("id", jobId);
}

function parseSecret(value: string | null) {
  return value?.trim() ?? "";
}

function isAcceptedCronKey(provided: string, publishableKey: string) {
  if (!provided) return false;
  if (publishableKey && provided === publishableKey) return true;
  try {
    const [, payload] = provided.split(".");
    if (!payload) return false;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as {
      iss?: string;
      role?: string;
      ref?: string;
    };
    const projectRef =
      process.env.SUPABASE_PROJECT_ID ??
      process.env.VITE_SUPABASE_PROJECT_ID ??
      (process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname.split(".")[0] : "");
    return decoded.role === "anon" && decoded.ref === projectRef && decoded.iss === "supabase";
  } catch {
    return false;
  }
}

async function enqueueNextTick(jobId: string, url: string, secret: string) {
  if (!secret) {
    await updateJobTrace(jobId, {
      worker_last_status: "next_tick_not_scheduled",
      worker_last_error: "Worker secret ausente para agendar próximo lote.",
    });
    return false;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("enqueue_bling_sync_tick", {
    _url: url,
    _secret: secret,
    _job_id: jobId,
  });

  if (error) {
    await updateJobTrace(jobId, {
      worker_last_status: "next_tick_failed",
      worker_last_error: error.message,
    });
    return false;
  }

  await updateJobTrace(jobId, { worker_last_status: "next_tick_queued" });
  return true;
}

export const Route = createFileRoute("/api/public/bling/sync-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = parseSecret(process.env.BLING_WORKER_SECRET ?? null);
        const publishableKey = parseSecret(
          process.env.SUPABASE_PUBLISHABLE_KEY ??
            process.env.SUPABASE_ANON_KEY ??
            process.env.VITE_SUPABASE_ANON_KEY ??
            process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
            null,
        );
        const url = new URL(request.url);
        const provided =
          parseSecret(request.headers.get("x-worker-secret")) ||
          parseSecret(url.searchParams.get("secret")) ||
          parseSecret(request.headers.get("apikey"));
        let jobId: string | null = null;
        try {
          const body = (await request.json().catch(() => ({}))) as { job_id?: string; syncJobId?: string };
          jobId = body.syncJobId ?? body.job_id ?? null;
        } catch {
          jobId = null;
        }
        if (!secret && !provided) {
          await updateJobTrace(jobId, {
            status: "pausada_por_erro",
            pause_reason: "worker_secret_missing",
            last_error_code: "worker_secret_missing",
            last_error_message: "Worker não iniciado: secret do worker ausente.",
            worker_last_status: "worker_secret_missing",
            worker_last_error: "Worker secret ausente.",
          });
          return new Response("Unauthorized", { status: 401 });
        }
        const providedIsWorkerSecret = Boolean(secret && provided === secret);
        const providedIsCronKey = isAcceptedCronKey(provided, publishableKey);
        if (secret && !providedIsWorkerSecret && !providedIsCronKey) {
          await updateJobTrace(jobId, {
            status: "pausada_por_erro",
            pause_reason: "worker_secret_invalid",
            last_error_code: "worker_secret_invalid",
            last_error_message: "Worker não iniciado: secret do worker inválido.",
            worker_last_status: "worker_secret_invalid",
            worker_last_error: "Worker secret inválido.",
          });
          return new Response("Forbidden", { status: 403 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { processSyncBatch } = await import("@/lib/bling-sync.server");

        // Pick claim (advisory lock)
        const { data: claim } = await supabaseAdmin.rpc("claim_next_sync_job", {
          _job_id: jobId ?? undefined,
        });
        const row = (Array.isArray(claim) ? claim[0] : null) as ClaimRow | null;
        if (!row?.claimed || !row.job_id) {
          await updateJobTrace(jobId, {
            worker_last_status: "no_eligible_job",
            worker_last_error: row?.reason ?? "Nenhum job elegível encontrado.",
          });
          return Response.json({ ok: true, active: false, claimed: false, reason: row?.reason ?? "no_eligible_job" });
        }
        const result = await processSyncBatch(row.job_id);

        // Self-invoke to keep processing if still active; cron is the safety net if this fails.
        if (result.active) {
          const configuredBase = process.env.APP_PUBLIC_URL?.replace(/\/$/, "") || "";
          const requestBase = new URL(request.url).origin;
          const base = configuredBase || requestBase;
          if (base) {
            await enqueueNextTick(row.job_id, `${base}/api/public/bling/sync-tick`, secret);
          }
        }
        return Response.json({ ok: true, claimed: true, job_id: row.job_id, ...result });
      },
    },
  },
});