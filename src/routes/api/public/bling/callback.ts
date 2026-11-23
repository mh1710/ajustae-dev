import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/bling/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        const appBase =
          (process.env.APP_RETURN_URL || process.env.APP_PUBLIC_URL)?.replace(/\/$/, "") ??
          url.origin;
        const redirectTo = (msg: string, kind: "ok" | "err") =>
          Response.redirect(
            `${appBase}/integracoes?bling=${kind}&msg=${encodeURIComponent(msg)}`,
            302,
          );

        const mask = (s: string | null) =>
          !s ? "∅" : s.length <= 8 ? "***" : `${s.slice(0, 4)}…${s.slice(-4)}`;
        const now = new Date().toISOString();
        console.log("[bling-callback] iniciado", { now, state: mask(state), hasCode: !!code });

        if (error) return redirectTo(`Bling retornou erro: ${error}`, "err");
        if (!state) return redirectTo("state_ausente: parâmetro state não recebido", "err");
        if (!code) return redirectTo("Parâmetros inválidos: code ausente", "err");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { exchangeBlingCode, getCompanyBlingCredentials } = await import("@/lib/bling.server");

        // Lookup state (do NOT delete; one-time-use via used_at)
        const { data: stateRow, error: stateErr } = await supabaseAdmin
          .from("bling_oauth_states")
          .select("state, company_id, user_id, integration_id, expires_at, used_at")
          .eq("state", state)
          .maybeSingle();

        if (stateErr) {
          console.error("[bling-callback] falha_consulta_state", stateErr.message);
          return redirectTo("falha_consulta_state: erro ao consultar state", "err");
        }

        console.log("[bling-callback] state lookup", {
          encontrado: !!stateRow,
          expires_at: stateRow?.expires_at,
          used_at: stateRow?.used_at,
          company_id: stateRow?.company_id,
        });

        if (!stateRow) {
          return redirectTo("state_nao_encontrado: registro do state não existe", "err");
        }

        // If already used, treat as idempotent success when integration is connected.
        if (stateRow.used_at) {
          const { data: integ } = await supabaseAdmin
            .from("bling_integrations")
            .select("status")
            .eq("company_id", stateRow.company_id)
            .maybeSingle();
          if (integ?.status === "conectada") {
            console.log("[bling-callback] state_ja_utilizado -> idempotente OK");
            return redirectTo("Bling conectado com sucesso!", "ok");
          }
          return redirectTo("state_ja_utilizado: autorização já processada", "err");
        }

        if (new Date(stateRow.expires_at).getTime() < Date.now()) {
          return redirectTo("state_expirado: reinicie a autorização", "err");
        }

        try {
          console.log("[bling-callback] trocando code por token");
          const creds = await getCompanyBlingCredentials(stateRow.company_id);
          const token = await exchangeBlingCode(code, creds);
          const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

          await supabaseAdmin
            .from("bling_integrations")
            .upsert(
              {
                company_id: stateRow.company_id,
                status: "conectada",
                access_token: token.access_token,
                refresh_token: token.refresh_token,
                token_expires_at: expiresAt,
                scopes: token.scope ?? null,
                last_error: null,
              },
              { onConflict: "company_id" },
            );

          // Mark state as used (do NOT delete — keeps audit + enables idempotency)
          await supabaseAdmin
            .from("bling_oauth_states")
            .update({ used_at: new Date().toISOString() })
            .eq("state", state);

          console.log("[bling-callback] sucesso", { company_id: stateRow.company_id });
          return redirectTo("Bling conectado com sucesso!", "ok");
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Falha ao trocar código.";
          console.error("[bling-callback] falha_troca_token", msg);
          await supabaseAdmin
            .from("bling_integrations")
            .upsert(
              { company_id: stateRow.company_id, status: "erro", last_error: msg },
              { onConflict: "company_id" },
            );
          return redirectTo(msg, "err");
        }
      },
    },
  },
});