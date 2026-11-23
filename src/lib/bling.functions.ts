import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildBlingAuthorizeUrl,
  getBlingCallbackUrl,
  getCompanyBlingCredentials,
  refreshBlingTokenIfNeeded,
  verifyBlingClientCredentials,
} from "./bling.server";
import { isLocalBlingTestRuntime } from "./local-test-environment.server";

async function requireCompanyAdmin(
  supabase: { from: (t: string) => any },
  companyId: string,
  userId: string,
) {
  const { data: membership, error } = await supabase
    .from("company_users")
    .select("role, ativo")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!membership || !membership.ativo || membership.role !== "admin") {
    throw new Error("Acesso negado a esta empresa.");
  }
}

const maskSecret = (s: string | null | undefined) =>
  !s ? null : s.length <= 8 ? "••••" : `${s.slice(0, 4)}••••${s.slice(-4)}`;

export const getBlingRuntimeEnvironment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({
    mode: process.env.BLING_RUNTIME_ENV === "local_test" ? "local_test" as const : "production" as const,
    writes_enabled: true,
    project_id:
      process.env.BLING_RUNTIME_ENV === "local_test"
        ? process.env.SUPABASE_PROJECT_ID ?? null
        : null,
  }));

/** Apps OAuth cadastrados (Client ID/Secret por empresa do Bling). Secret nunca sai do servidor. */
export const listBlingOAuthApps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    // Um projeto de teste pode ter recebido o catálogo histórico pelas
    // migrations. Credenciais locais precisam ser informadas por empresa.
    if (isLocalBlingTestRuntime()) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("bling_oauth_apps")
      .select("id, nome, client_id")
      .order("nome");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Credenciais atuais da empresa (client_id visível, secret mascarado). */
export const getBlingCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ company_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireCompanyAdmin(context.supabase, data.company_id, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("bling_integrations")
      .select("client_id, client_secret, oauth_app_nome")
      .eq("company_id", data.company_id)
      .maybeSingle();
    return {
      client_id: row?.client_id ?? null,
      client_secret_masked: maskSecret(row?.client_secret),
      oauth_app_nome: row?.oauth_app_nome ?? null,
    };
  });

/** Salva Client ID/Secret da empresa — direto ou copiando de um app cadastrado. */
export const saveBlingCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        app_id: z.string().uuid().optional(),
        client_id: z.string().trim().min(10).optional(),
        client_secret: z.string().trim().min(10).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireCompanyAdmin(context.supabase, data.company_id, context.userId);
    if (isLocalBlingTestRuntime() && data.app_id) {
      throw new Error(
        "No ambiente local de teste, informe um Client ID e Client Secret exclusivos para a empresa.",
      );
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let clientId = data.client_id ?? null;
    let clientSecret = data.client_secret ?? null;
    let appNome: string | null = null;

    if (data.app_id) {
      const { data: app, error } = await supabaseAdmin
        .from("bling_oauth_apps")
        .select("nome, client_id, client_secret")
        .eq("id", data.app_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!app) throw new Error("App do Bling não encontrado.");
      clientId = app.client_id;
      clientSecret = app.client_secret;
      appNome = app.nome;
    }

    if (!clientId || !clientSecret) {
      throw new Error("Informe Client ID e Client Secret, ou selecione um app cadastrado.");
    }

    const { error: upErr } = await supabaseAdmin.from("bling_integrations").upsert(
      {
        company_id: data.company_id,
        client_id: clientId,
        client_secret: clientSecret,
        oauth_app_nome: appNome,
      },
      { onConflict: "company_id" },
    );
    if (upErr) throw new Error(upErr.message);
    return { success: true, client_id: clientId, oauth_app_nome: appNome };
  });

export const listBlingIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Array<{
    id: string;
    company_id: string;
    status: string;
    nome_conexao: string | null;
    token_expires_at: string | null;
    scopes: string | null;
    bling_account_id: string | null;
    last_sync_at: string | null;
    last_error: string | null;
    updated_at: string;
    cdn_signature: string | null;
    cdn_signature_active: boolean;
    cdn_signature_updated_at: string | null;
  }>> => {
    const { data: memberships, error: memberError } = await context.supabase.from('company_users').select('company_id').eq('user_id', context.userId).eq('ativo', true);
    if (memberError) throw new Error(memberError.message);
    if (!memberships?.length) return [];
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const db = supabaseAdmin as any;
    const { data, error } = await db
      .from("bling_integrations")
      .select(
        "id, company_id, status, nome_conexao, token_expires_at, scopes, bling_account_id, last_sync_at, last_error, updated_at, cdn_signature, cdn_signature_active, cdn_signature_updated_at",
      ).in("company_id", memberships.map((member) => member.company_id));
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string;
      company_id: string;
      status: string;
      nome_conexao: string | null;
      token_expires_at: string | null;
      scopes: string | null;
      bling_account_id: string | null;
      last_sync_at: string | null;
      last_error: string | null;
      updated_at: string;
      cdn_signature: string | null;
      cdn_signature_active: boolean;
      cdn_signature_updated_at: string | null;
    }>;
  });

export const blingAuthStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ company_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    // Verify membership as admin
    const { data: membership, error: mErr } = await context.supabase
      .from("company_users")
      .select("role, ativo")
      .eq("company_id", data.company_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (mErr) throw new Error(mErr.message);
    if (!membership || !membership.ativo || membership.role !== "admin") {
      throw new Error("Acesso negado a esta empresa.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { randomBytes } = await import("node:crypto");
    const state = randomBytes(32).toString("hex");

    // Ensure an integration row exists so we can link the state to it.
    const { data: existing } = await supabaseAdmin
      .from("bling_integrations")
      .select("id")
      .eq("company_id", data.company_id)
      .maybeSingle();

    let integrationId = existing?.id ?? null;
    if (!integrationId) {
      const { data: created, error: createErr } = await supabaseAdmin
        .from("bling_integrations")
        .insert({ company_id: data.company_id, status: "desconectada" })
        .select("id")
        .single();
      if (createErr) throw new Error(createErr.message);
      integrationId = created.id;
    }

    const { error: stateErr } = await supabaseAdmin.from("bling_oauth_states").insert({
      state,
      company_id: data.company_id,
      user_id: context.userId,
      integration_id: integrationId,
    });
    if (stateErr) throw new Error(stateErr.message);

    const { clientId } = await getCompanyBlingCredentials(data.company_id);
    const url = buildBlingAuthorizeUrl(state, clientId);
    return { url };
  });

export const blingTestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ company_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: membership } = await context.supabase
      .from("company_users")
      .select("ativo")
      .eq("company_id", data.company_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!membership || !membership.ativo) throw new Error("Acesso negado.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: integration } = await supabaseAdmin
      .from("bling_integrations")
      .select("*")
      .eq("company_id", data.company_id)
      .maybeSingle();

    if (!integration || !integration.access_token) {
      // Sem token OAuth: ainda dá para validar o Client ID / Client Secret.
      try {
        const creds = await getCompanyBlingCredentials(data.company_id);
        const check = await verifyBlingClientCredentials(creds);
        if (check.valid) {
          return {
            success: true,
            mode: "credentials" as const,
            message: `${check.detail} Falta autorizar (Conectar ao Bling) para gerar o token.`,
          };
        }
        return { success: false, mode: "credentials" as const, error: check.detail };
      } catch (e) {
        return {
          success: false,
          mode: "credentials" as const,
          error: e instanceof Error ? e.message : "Integração não está conectada.",
        };
      }
    }


    try {
      const token = await refreshBlingTokenIfNeeded(integration);
      const res = await fetch("https://api.bling.com.br/Api/v3/produtos?pagina=1&limite=1", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "enable-jwt": "1",
        },
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const msg = `Bling respondeu ${res.status}`;
        await supabaseAdmin
          .from("bling_integrations")
          .update({ status: "erro", last_error: msg })
          .eq("company_id", data.company_id);
        console.error("[bling-test-connection]", res.status, errText.slice(0, 500));
        return { success: false, error: msg };
      }

      // Checa também a permissão de Estoques/Depósitos, necessária para atualizar estoque.
      const stockRes = await fetch("https://api.bling.com.br/Api/v3/depositos", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "enable-jwt": "1",
        },
      });
      const stockText = await stockRes.text().catch(() => "");
      if (stockRes.status === 403 || stockText.includes("insufficient_scope")) {
        const msg =
          "Conectado, mas sem permissão de Estoques/Depósitos. No Bling, edite o aplicativo desta empresa, marque as permissões de Estoques e Depósitos, salve e reconecte a empresa aqui.";
        await supabaseAdmin
          .from("bling_integrations")
          .update({ status: "erro", last_error: msg })
          .eq("company_id", data.company_id);
        return { success: false, error: msg };
      }

      await supabaseAdmin
        .from("bling_integrations")
        .update({
          status: "conectada",
          last_sync_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("company_id", data.company_id);
      return { success: true };

    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      await supabaseAdmin
        .from("bling_integrations")
        .update({ status: "erro", last_error: msg })
        .eq("company_id", data.company_id);
      return { success: false, error: msg };
    }
  });

export const blingDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ company_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: membership } = await context.supabase
      .from("company_users")
      .select("role, ativo")
      .eq("company_id", data.company_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!membership || !membership.ativo || membership.role !== "admin") {
      throw new Error("Acesso negado.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("bling_integrations")
      .update({
        status: "desconectada",
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        scopes: null,
        bling_account_id: null,
        last_error: null,
      })
      .eq("company_id", data.company_id);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const getBlingCallbackUrlForDisplay = createServerFn({ method: "GET" }).handler(async () => {
  return { url: getBlingCallbackUrl() };
});
