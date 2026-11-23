/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/email/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const providerError = url.searchParams.get("error");
        const appBase = (
          process.env.APP_RETURN_URL ||
          process.env.APP_PUBLIC_URL ||
          url.origin
        ).replace(/\/$/, "");
        const redirect = (kind: "ok" | "err", message: string) =>
          Response.redirect(
            `${appBase}/codigos-email?email=${kind}&msg=${encodeURIComponent(message)}`,
            302,
          );

        if (providerError) return redirect("err", `O provedor recusou a conexão: ${providerError}`);
        if (!state || !code) return redirect("err", "Autorização inválida: code ou state ausente.");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { exchangeNylasCode, getNylasGrant } = await import("@/lib/email-connector.server");
        const db = supabaseAdmin as any;
        const { data: stateRow, error: stateError } = await db
          .from("email_oauth_states")
          .select("state, user_id, redirect_uri, expires_at, used_at, requested_connector")
          .eq("state", state)
          .maybeSingle();
        if (stateError) return redirect("err", "Não foi possível validar a autorização.");
        if (!stateRow)
          return redirect("err", "Autorização não encontrada. Inicie a conexão novamente.");
        if (stateRow.used_at) {
          const { data: existing } = await db
            .from("email_connections")
            .select("id")
            .eq("user_id", stateRow.user_id)
            .eq("status", "connected")
            .limit(1)
            .maybeSingle();
          return existing
            ? redirect("ok", "E-mail já conectado com sucesso.")
            : redirect("err", "Esta autorização já foi utilizada.");
        }
        if (new Date(stateRow.expires_at).getTime() <= Date.now()) {
          return redirect("err", "A autorização expirou. Inicie a conexão novamente.");
        }

        try {
          const token = await exchangeNylasCode(code, stateRow.redirect_uri);
          const grant = await getNylasGrant(token.grant_id).catch(() => ({}));
          const email =
            String(token.email ?? grant.email ?? "")
              .trim()
              .toLowerCase() || null;
          const providerName = String(
            token.provider ?? grant.provider ?? stateRow.requested_connector ?? "nylas",
          );
          const now = new Date().toISOString();

          if (email) {
            await db
              .from("email_connections")
              .update({ status: "revoked", revoked_at: now, updated_at: now })
              .eq("user_id", stateRow.user_id)
              .eq("provider_account_email", email)
              .neq("provider_grant_id", token.grant_id)
              .eq("status", "connected");
          }

          const { error: connectionError } = await db.from("email_connections").upsert(
            {
              user_id: stateRow.user_id,
              provider: "nylas",
              provider_grant_id: token.grant_id,
              provider_account_email: email,
              provider_name: providerName,
              status: "connected",
              scopes: token.scope ?? null,
              connected_at: now,
              last_error: null,
              revoked_at: null,
              updated_at: now,
            },
            { onConflict: "provider,provider_grant_id" },
          );
          if (connectionError) throw new Error(connectionError.message);
          await db.from("email_oauth_states").update({ used_at: now }).eq("state", state);
          return redirect(
            "ok",
            "E-mail conectado. Os códigos da WebContinental serão detectados automaticamente.",
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha ao concluir a conexão.";
          return redirect("err", message);
        }
      },
    },
  },
});
