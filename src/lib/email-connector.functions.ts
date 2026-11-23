/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function isGlobalAdmin(context: { supabase: any; userId: string }): Promise<boolean> {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  return !!data;
}

async function assertActiveUser(context: { supabase: any; userId: string }) {
  const admin = await isGlobalAdmin(context);
  if (admin) return { admin };
  const { data, error } = await context.supabase
    .from("user_permissions")
    .select("active, access_expires_at")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.active === false) throw new Error("Seu acesso está inativo.");
  if (data?.access_expires_at && new Date(data.access_expires_at).getTime() < Date.now()) {
    throw new Error("Seu acesso expirou.");
  }
  return { admin };
}

async function connectionForActor(
  context: { supabase: any; userId: string },
  connectionId: string,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("email_connections")
    .select(
      "id, user_id, provider, provider_grant_id, provider_account_email, provider_name, status",
    )
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Conexão de e-mail não encontrada.");
  if (data.user_id !== context.userId && !(await isGlobalAdmin(context))) {
    throw new Error("Você não pode acessar a conexão de outro usuário.");
  }
  return data;
}

function auditMetadata() {
  const request = getRequest();
  return {
    ip:
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null,
    user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
  };
}

export const getEmailConnectorConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { admin } = await assertActiveUser(context);
    const { getEmailConnectorPublicConfig } = await import("@/lib/email-connector.server");
    const config = getEmailConnectorPublicConfig(new URL(getRequest().url).origin);
    return admin
      ? config
      : {
          configured: config.configured,
          provider: config.provider,
          free_connected_accounts: config.free_connected_accounts,
          supported_connectors: config.supported_connectors,
        };
  });

export const startEmailConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z
      .object({ connector: z.enum(["google", "microsoft", "yahoo", "icloud", "imap"]).optional() })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    await assertActiveUser(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      createNylasAuthorizationUrl,
      getEmailCallbackUri,
      getEmailConnectorProvider,
      randomUrlSafe,
    } = await import("@/lib/email-connector.server");
    const db = supabaseAdmin as any;
    const provider = getEmailConnectorProvider();
    if (provider === "nango") {
      const connector = data.connector === "microsoft" ? "microsoft" : "google";
      const { data: profile } = await db
        .from("profiles")
        .select("nome, email")
        .eq("id", context.userId)
        .maybeSingle();
      const { createNangoConnectSession } = await import("@/lib/email-nango.server");
      const session = await createNangoConnectSession({
        userId: context.userId,
        userEmail: String(profile?.email ?? context.claims?.email ?? "").trim() || null,
        displayName: String(profile?.nome ?? "").trim() || null,
        connector,
      });
      return {
        provider: "nango" as const,
        session_token: session.token,
        expires_at: session.expires_at,
        integration_id: session.integration_id,
      };
    }
    const state = randomUrlSafe(32);
    const redirectUri = getEmailCallbackUri(new URL(getRequest().url).origin);
    const { error } = await db.from("email_oauth_states").insert({
      state,
      user_id: context.userId,
      provider: "nylas",
      requested_connector: data.connector ?? null,
      redirect_uri: redirectUri,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (error) throw new Error(error.message);
    return {
      provider: "nylas" as const,
      url: createNylasAuthorizationUrl({ state, redirectUri, connector: data.connector }),
    };
  });

export const completeNangoEmailConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z
      .object({
        connection_id: z.string().min(1).max(200),
        integration_id: z.string().min(1).max(100),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    await assertActiveUser(context);
    const {
      assertNangoConnectionOwnership,
      connectorForNangoIntegration,
      getNangoMailboxEmail,
      getNangoReadonlyScopes,
    } = await import("@/lib/email-nango.server");
    const connector = connectorForNangoIntegration(data.integration_id);
    if (!connector) throw new Error("Integração Nango não autorizada neste ambiente.");
    await assertNangoConnectionOwnership({
      connectionId: data.connection_id,
      integrationId: data.integration_id,
      userId: context.userId,
    });
    const email = await getNangoMailboxEmail({
      connectionId: data.connection_id,
      integrationId: data.integration_id,
      connector,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const now = new Date().toISOString();
    if (email) {
      await db
        .from("email_connections")
        .update({ status: "revoked", revoked_at: now, updated_at: now })
        .eq("user_id", context.userId)
        .eq("provider", "nango")
        .eq("provider_account_email", email)
        .neq("provider_grant_id", data.connection_id)
        .eq("status", "connected");
    }
    const { error } = await db.from("email_connections").upsert(
      {
        user_id: context.userId,
        provider: "nango",
        provider_grant_id: data.connection_id,
        provider_account_email: email,
        provider_name: data.integration_id,
        status: "connected",
        scopes: getNangoReadonlyScopes(connector),
        connected_at: now,
        last_error: null,
        revoked_at: null,
        updated_at: now,
      },
      { onConflict: "provider,provider_grant_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, email, provider: "nango" as const };
  });

export const listEmailDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { admin } = await assertActiveUser(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { maskEmailCode } = await import("@/lib/email-connector.server");
    const db = supabaseAdmin as any;
    let connectionQuery = db
      .from("email_connections")
      .select(
        "id, user_id, provider, provider_account_email, provider_name, status, connected_at, last_sync_at, last_error, revoked_at, updated_at",
      )
      .order("updated_at", { ascending: false });
    let codeQuery = db
      .from("email_verification_codes")
      .select(
        "id, connection_id, owner_user_id, sender_email, subject, code_length, received_at, expires_at, first_revealed_at, used_at, code_ciphertext",
      )
      .order("received_at", { ascending: false })
      .limit(100);
    if (!admin) {
      connectionQuery = connectionQuery.eq("user_id", context.userId);
      codeQuery = codeQuery.eq("owner_user_id", context.userId);
    }
    const [{ data: connections, error: connectionError }, { data: codes, error: codeError }] =
      await Promise.all([connectionQuery, codeQuery]);
    if (connectionError) throw new Error(connectionError.message);
    if (codeError) throw new Error(codeError.message);

    const ownerIds = Array.from(new Set((connections ?? []).map((row: any) => row.user_id)));
    const { data: profiles } = ownerIds.length
      ? await db.from("profiles").select("id, nome, email").in("id", ownerIds)
      : { data: [] };
    const profileMap = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));
    const now = Date.now();
    return {
      is_admin: admin,
      connections: (connections ?? []).map((row: any) => ({
        ...row,
        owner_name: profileMap.get(row.user_id)?.nome ?? null,
        owner_email: profileMap.get(row.user_id)?.email ?? null,
        is_own: row.user_id === context.userId,
      })),
      codes: (codes ?? []).map((row: any) => ({
        id: row.id,
        connection_id: row.connection_id,
        owner_user_id: row.owner_user_id,
        owner_name: profileMap.get(row.owner_user_id)?.nome ?? null,
        owner_email: profileMap.get(row.owner_user_id)?.email ?? null,
        sender_email: row.sender_email,
        subject: row.subject,
        masked_code: maskEmailCode(row.code_length),
        received_at: row.received_at,
        expires_at: row.expires_at,
        first_revealed_at: row.first_revealed_at,
        used_at: row.used_at,
        expired: new Date(row.expires_at).getTime() <= now,
        available:
          !!row.code_ciphertext && !row.used_at && new Date(row.expires_at).getTime() > now,
      })),
    };
  });

export const revealEmailCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ code_id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    await assertActiveUser(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptEmailCode } = await import("@/lib/email-connector.server");
    const db = supabaseAdmin as any;
    const { data: row, error } = await db
      .from("email_verification_codes")
      .select("id, owner_user_id, code_ciphertext, code_iv, expires_at, used_at, first_revealed_at")
      .eq("id", data.code_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Código não encontrado.");
    if (row.owner_user_id !== context.userId && !(await isGlobalAdmin(context))) {
      throw new Error("Você não pode revelar o código de outro usuário.");
    }
    if (row.used_at) throw new Error("Este código já foi marcado como utilizado.");
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new Error("Este código expirou.");
    if (!row.code_ciphertext || !row.code_iv)
      throw new Error("Este código não está mais disponível.");
    const code = await decryptEmailCode(row.code_ciphertext, row.code_iv);
    const now = new Date().toISOString();
    await Promise.all([
      db
        .from("email_verification_codes")
        .update({ first_revealed_at: row.first_revealed_at ?? now })
        .eq("id", row.id),
      db.from("email_code_access_audit").insert({
        code_id: row.id,
        actor_user_id: context.userId,
        owner_user_id: row.owner_user_id,
        action: "reveal",
        metadata: auditMetadata(),
      }),
    ]);
    return { code, expires_at: row.expires_at };
  });

export const markEmailCodeUsed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ code_id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    await assertActiveUser(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: row, error } = await db
      .from("email_verification_codes")
      .select("id, owner_user_id")
      .eq("id", data.code_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Código não encontrado.");
    if (row.owner_user_id !== context.userId && !(await isGlobalAdmin(context))) {
      throw new Error("Você não pode alterar o código de outro usuário.");
    }
    const now = new Date().toISOString();
    const { error: updateError } = await db
      .from("email_verification_codes")
      .update({ used_at: now, code_ciphertext: null, code_iv: null })
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);
    await db.from("email_code_access_audit").insert({
      code_id: row.id,
      actor_user_id: context.userId,
      owner_user_id: row.owner_user_id,
      action: "mark_used",
      metadata: auditMetadata(),
    });
    return { ok: true };
  });

export const disconnectEmailConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ connection_id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    await assertActiveUser(context);
    const connection = await connectionForActor(context, data.connection_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    try {
      if (connection.provider === "nango") {
        const { deleteNangoConnection } = await import("@/lib/email-nango.server");
        await deleteNangoConnection({
          connectionId: connection.provider_grant_id,
          integrationId: connection.provider_name,
        });
      } else {
        const { deleteNylasGrant } = await import("@/lib/email-connector.server");
        await deleteNylasGrant(connection.provider_grant_id);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha ao revogar a conexão no provedor.";
      if (!/404|not found/i.test(message)) throw error;
    }
    const now = new Date().toISOString();
    await Promise.all([
      db
        .from("email_connections")
        .update({ status: "revoked", revoked_at: now, updated_at: now })
        .eq("id", connection.id),
      db
        .from("email_verification_codes")
        .update({ code_ciphertext: null, code_iv: null, used_at: now })
        .eq("connection_id", connection.id)
        .is("used_at", null),
      db.from("email_code_access_audit").insert({
        code_id: null,
        actor_user_id: context.userId,
        owner_user_id: connection.user_id,
        action: "disconnect",
        metadata: auditMetadata(),
      }),
    ]);
    return { ok: true };
  });

export const syncEmailConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ connection_id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    await assertActiveUser(context);
    const connection = await connectionForActor(context, data.connection_id);
    if (connection.status === "revoked") throw new Error("Esta conexão foi revogada.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let checked = 0;
    let stored = 0;
    if (connection.provider === "nango") {
      const { syncNangoConnection } = await import("@/lib/email-connector.server");
      const result = await syncNangoConnection(connection);
      checked = result.checked;
      stored = result.stored;
    } else {
      const { listNylasMessages, processNylasMessage } =
        await import("@/lib/email-connector.server");
      const messages = await listNylasMessages(connection.provider_grant_id, 20);
      checked = messages.length;
      for (const message of messages) {
        const result = await processNylasMessage({
          grantId: connection.provider_grant_id,
          messageId: message.id,
        });
        if (result.stored) stored += 1;
      }
    }
    await (supabaseAdmin as any).from("email_code_access_audit").insert({
      code_id: null,
      actor_user_id: context.userId,
      owner_user_id: connection.user_id,
      action: "manual_sync",
      metadata: { ...auditMetadata(), messages_checked: checked, codes_found: stored },
    });
    return { ok: true, checked, stored };
  });

export const listEmailAccessAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertActiveUser(context);
    if (!(await isGlobalAdmin(context)))
      throw new Error("Acesso restrito ao administrador global.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data, error } = await db
      .from("email_code_access_audit")
      .select("id, code_id, actor_user_id, owner_user_id, action, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const ids = Array.from(
      new Set((data ?? []).flatMap((row: any) => [row.actor_user_id, row.owner_user_id])),
    );
    const { data: profiles } = ids.length
      ? await db.from("profiles").select("id, nome, email").in("id", ids)
      : { data: [] };
    const profileMap = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));
    return (data ?? []).map((row: any) => ({
      ...row,
      actor_name:
        profileMap.get(row.actor_user_id)?.nome ??
        profileMap.get(row.actor_user_id)?.email ??
        row.actor_user_id,
      owner_name:
        profileMap.get(row.owner_user_id)?.nome ??
        profileMap.get(row.owner_user_id)?.email ??
        row.owner_user_id,
    }));
  });
