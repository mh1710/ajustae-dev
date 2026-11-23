import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/mercadolivre/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        const appBase = (process.env.APP_PUBLIC_URL ?? url.origin).replace(/\/$/, "");
        const back = (msg: string, kind: "ok" | "err") =>
          Response.redirect(
            `${appBase}/fornecedores?ml=${kind}&msg=${encodeURIComponent(msg)}`,
            302,
          );

        if (error) return back(`Mercado Livre retornou erro: ${error}`, "err");
        if (!code || !state) return back("Parâmetros inválidos na autorização.", "err");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { exchangeMlCode } = await import("@/lib/mercadolivre.server");

        const { data: stateRow } = await supabaseAdmin
          .from("ml_oauth_states")
          .select("state, expires_at, used_at")
          .eq("state", state)
          .maybeSingle();

        if (!stateRow) return back("Autorização inválida (state não encontrado).", "err");
        if (stateRow.used_at) return back("Mercado Livre conectado.", "ok");
        if (new Date(stateRow.expires_at).getTime() < Date.now())
          return back("Autorização expirada, tente novamente.", "err");

        try {
          const token = await exchangeMlCode(code);

          let nickname: string | null = null;
          try {
            const me = await fetch("https://api.mercadolibre.com/users/me", {
              headers: { Authorization: `Bearer ${token.access_token}` },
            });
            if (me.ok) nickname = ((await me.json()) as { nickname?: string }).nickname ?? null;
          } catch {
            // opcional
          }

          await supabaseAdmin.from("ml_integration").upsert(
            {
              singleton: true,
              status: "conectada",
              access_token: token.access_token,
              refresh_token: token.refresh_token ?? null,
              token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
              ml_user_id: token.user_id ? String(token.user_id) : null,
              ml_nickname: nickname,
              last_error: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "singleton" },
          );

          await supabaseAdmin
            .from("ml_oauth_states")
            .update({ used_at: new Date().toISOString() })
            .eq("state", state);

          return back("Mercado Livre conectado com sucesso!", "ok");
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Falha ao conectar.";
          return back(msg, "err");
        }
      },
    },
  },
});
