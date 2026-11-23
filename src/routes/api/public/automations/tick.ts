import { createFileRoute } from "@tanstack/react-router";

function trim(v: string | null | undefined) {
  return (v ?? "").trim();
}

function isAcceptedCronKey(provided: string, publishableKey: string) {
  if (!provided) return false;
  if (publishableKey && provided === publishableKey) return true;
  try {
    const [, payload] = provided.split(".");
    if (!payload) return false;
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { iss?: string; role?: string; ref?: string };
    const ref =
      process.env.SUPABASE_PROJECT_ID ??
      process.env.VITE_SUPABASE_PROJECT_ID ??
      (process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname.split(".")[0] : "");
    return decoded.role === "anon" && decoded.ref === ref && decoded.iss === "supabase";
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/automations/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = trim(process.env.BLING_WORKER_SECRET);
        const publishable = trim(
          process.env.SUPABASE_PUBLISHABLE_KEY ??
            process.env.SUPABASE_ANON_KEY ??
            process.env.VITE_SUPABASE_ANON_KEY ??
            process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        );
        const url = new URL(request.url);
        const provided =
          trim(request.headers.get("x-worker-secret")) ||
          trim(url.searchParams.get("secret")) ||
          trim(request.headers.get("apikey"));

        const okAuth =
          (!!secret && provided === secret) || isAcceptedCronKey(provided, publishable);
        if (!okAuth) return new Response("Forbidden", { status: 403 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // unstick abandoned workers before scheduling more work
        const { data: reclaimed } = await supabaseAdmin.rpc("reclaim_stuck_workers", {
          _minutes: 10,
        } as never);

        const base = (process.env.APP_PUBLIC_URL ?? new URL(request.url).origin).replace(/\/$/, "");

        // Recupera execuções interrompidas usando a última atividade e, com
        // secret disponível, retoma sozinha (até 2 tentativas por agendamento).
        const { data: recovered } = await (
          supabaseAdmin.rpc as unknown as (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: unknown }>
        )("reclaim_stuck_automation_runs", {
          _minutes: 5,
          _url: secret ? `${base}/api/public/automations/run` : null,
          _secret: secret || null,
        });

        // Renova preventivamente os tokens do Bling (Client ID/Secret por empresa).
        let tokens: unknown = null;
        try {
          const { refreshExpiringBlingTokens } = await import("@/lib/bling.server");
          tokens = await refreshExpiringBlingTokens();
        } catch (e) {
          tokens = { error: e instanceof Error ? e.message : String(e) };
        }

        const { runDueAutomations, dispatchDueAutomations } =
          await import("@/lib/automations.server");
        // Cada empresa roda numa requisição própria (tempo limite individual);
        // sem secret, cai no modo antigo (tudo no mesmo tick).
        const res = secret
          ? await dispatchDueAutomations(base, secret, 10)
          : await runDueAutomations(10);

        // Mantém a fila de envio ao Bling andando: a cada ciclo, refaz o
        // fan-out por empresa. Sem isso, se o encadeamento morrer, a fila
        // fica parada em "pendente" para sempre.
        if (secret) {
          try {
            await supabaseAdmin.rpc("enqueue_http_job", {
              _url: `${base}/api/public/bling/push-dispatch`,
              _secret: secret,
              _body: {} as never,
            } as never);
          } catch {
            /* best-effort */
          }

          // Transformações de IA: limite temporário volta sozinho na rodada
          // seguinte; pausa por créditos espera ação do dono do app.
          try {
            const { resumeRateLimitedAiJobs } = await import("@/lib/ai-transforms.server");
            await resumeRateLimitedAiJobs();
            await supabaseAdmin.rpc("enqueue_http_job", {
              _url: `${base}/api/public/ai/tick`,
              _secret: secret,
              _body: {} as never,
            } as never);
          } catch {
            /* best-effort */
          }

          // Filas encadeadas (campos customizados, fornecedores, sincronizações,
          // Mercado Livre, imagens): retoma as que pararam, mesmo sem ninguém logado.
          try {
            const { kickStalledWorkers } = await import("@/lib/worker-watchdog.server");
            await kickStalledWorkers(base, secret);
          } catch {
            /* best-effort */
          }

          // Caixas Nango são consultadas em uma requisição isolada. O worker
          // busca apenas mensagens candidatas recentes e hidrata somente IDs
          // ainda ausentes no cofre, mantendo o ciclo idempotente e econômico.
          if ((process.env.EMAIL_CONNECTOR_PROVIDER ?? "nango").trim().toLowerCase() === "nango") {
            try {
              await supabaseAdmin.rpc("enqueue_http_job", {
                _url: `${base}/api/public/email/nango-sync`,
                _secret: secret,
                _body: {} as never,
              } as never);
            } catch {
              /* best-effort */
            }
          }
        }

        // Fallback: mantém a sincronização de pedidos andando mesmo se o
        // encadeamento via pg_net falhar em algum ciclo.
        let orders: unknown = null;
        const { data: stuck } = await supabaseAdmin
          .from("bling_orders_sync_jobs")
          .select("id")
          .in("status", ["pendente", "executando"])
          .order("updated_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (stuck) {
          const jobId = (stuck as { id: string }).id;
          const { processOrdersSyncTick } = await import("@/lib/bling-orders.server");
          const deadline = Date.now() + 45_000;
          let r = await processOrdersSyncTick(jobId);
          // Executa alguns ciclos dentro do mesmo tick para avançar mais rápido.
          while (!r.done && Date.now() < deadline) {
            r = await processOrdersSyncTick(jobId);
          }
          orders = { job_id: jobId, ...r };
          const base = (process.env.APP_PUBLIC_URL ?? new URL(request.url).origin).replace(
            /\/$/,
            "",
          );
          if (!r.done && secret) {
            await supabaseAdmin.rpc("enqueue_bling_sync_tick", {
              _url: `${base}/api/public/bling/orders-tick`,
              _secret: secret,
              _job_id: jobId,
            } as never);
          }
        }

        return Response.json({ success: true, reclaimed, recovered, tokens, orders, ...res });
      },
    },
  },
});
