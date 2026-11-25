/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  extractWebContinentalCode,
  matchesAllowedEmailSender,
  matchesWebContinentalTokenSubject,
} from "@/lib/email-code-parser";

const NYLAS_DEFAULT_API = "https://api.us.nylas.com";
const DEFAULT_ALLOWED_SENDERS = "webcontinental.com.br";

export type EmailConnectorProvider = "nango" | "nylas";

type JsonRecord = Record<string, unknown>;

export type NylasMessage = {
  id: string;
  grant_id: string;
  subject?: string | null;
  body?: string | null;
  snippet?: string | null;
  date?: number | null;
  from?: Array<{ email?: string | null; name?: string | null }>;
};

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Configuração ausente no servidor: ${name}`);
  return value;
}

function apiBase(): string {
  return (env("NYLAS_API_URI") || NYLAS_DEFAULT_API).replace(/\/$/, "");
}

export function getEmailConnectorProvider(): EmailConnectorProvider {
  return env("EMAIL_CONNECTOR_PROVIDER").toLowerCase() === "nylas" ? "nylas" : "nango";
}

export function getEmailCallbackUri(origin?: string): string {
  const explicit = env("NYLAS_REDIRECT_URI");
  if (explicit) return explicit;
  const base = (env("APP_PUBLIC_URL") || origin || "").replace(/\/$/, "");
  if (!base) throw new Error("Configure APP_PUBLIC_URL ou NYLAS_REDIRECT_URI.");
  return `${base}/api/public/email/callback`;
}

export function getEmailWebhookUri(origin?: string): string {
  const base = (env("APP_PUBLIC_URL") || origin || "").replace(/\/$/, "");
  if (!base) throw new Error("Configure APP_PUBLIC_URL para publicar o webhook.");
  return `${base}/api/public/email/webhook`;
}

export function getEmailConnectorPublicConfig(origin?: string) {
  const allowedSenders = getAllowedSenderRules();
  const provider = getEmailConnectorProvider();
  const nangoConfigured = !!env("NANGO_API_KEY");
  const nangoCredentialCount = [env("NANGO_API_KEY"), env("NANGO_API_KEY_SECONDARY")].filter(
    Boolean,
  ).length;
  const parsedNangoLimit = Number.parseInt(env("NANGO_CONNECTIONS_PER_KEY") || "10", 10);
  const nangoConnectionsPerCredential =
    Number.isFinite(parsedNangoLimit) && parsedNangoLimit > 0 ? parsedNangoLimit : 10;
  const nylasConfigured = !!env("NYLAS_CLIENT_ID") && !!env("NYLAS_API_KEY");
  return {
    provider,
    configured:
      (provider === "nango" ? nangoConfigured : nylasConfigured) &&
      !!env("EMAIL_CODE_ENCRYPTION_KEY"),
    callback_url: getEmailCallbackUri(origin),
    webhook_url: getEmailWebhookUri(origin),
    allowed_senders: allowedSenders,
    code_ttl_minutes: getCodeTtlMinutes(),
    free_connected_accounts:
      provider === "nango" ? nangoCredentialCount * nangoConnectionsPerCredential : 5,
    nango_credential_slots: provider === "nango" ? nangoCredentialCount : 0,
    supported_connectors:
      provider === "nango" && !env("NANGO_OUTLOOK_INTEGRATION_ID")
        ? (["google"] as const)
        : (["google", "microsoft"] as const),
  };
}

export function createNylasAuthorizationUrl(args: {
  state: string;
  redirectUri: string;
  connector?: "google" | "microsoft" | "yahoo" | "icloud" | "imap";
}): string {
  const url = new URL(`${apiBase()}/v3/connect/auth`);
  url.searchParams.set("client_id", requiredEnv("NYLAS_CLIENT_ID"));
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("state", args.state);
  if (args.connector) url.searchParams.set("provider", args.connector);
  return url.toString();
}

async function nylasRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requiredEnv("NYLAS_API_KEY")}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as JsonRecord | null;
  if (!response.ok) {
    const message =
      (payload?.error as JsonRecord | undefined)?.message ??
      payload?.message ??
      `Nylas respondeu HTTP ${response.status}`;
    throw new Error(String(message));
  }
  return payload as T;
}

export async function exchangeNylasCode(code: string, redirectUri: string) {
  const response = await fetch(`${apiBase()}/v3/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: requiredEnv("NYLAS_CLIENT_ID"),
      client_secret: requiredEnv("NYLAS_API_KEY"),
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  const payload = (await response.json().catch(() => null)) as JsonRecord | null;
  if (!response.ok || !payload?.grant_id) {
    const message =
      (payload?.error as JsonRecord | undefined)?.message ??
      payload?.error_description ??
      payload?.message ??
      "Não foi possível concluir a autorização do e-mail.";
    throw new Error(String(message));
  }
  return payload as {
    grant_id: string;
    email?: string;
    scope?: string;
    provider?: string;
  };
}

export async function getNylasGrant(grantId: string) {
  const payload = await nylasRequest<{ data?: JsonRecord }>(
    `/v3/grants/${encodeURIComponent(grantId)}`,
  );
  return (payload.data ?? payload) as JsonRecord;
}

export async function deleteNylasGrant(grantId: string) {
  await nylasRequest(`/v3/grants/${encodeURIComponent(grantId)}`, { method: "DELETE" });
}

export async function getNylasMessage(grantId: string, messageId: string): Promise<NylasMessage> {
  const payload = await nylasRequest<{ data?: NylasMessage }>(
    `/v3/grants/${encodeURIComponent(grantId)}/messages/${encodeURIComponent(messageId)}`,
  );
  return (payload.data ?? payload) as NylasMessage;
}

export async function listNylasMessages(grantId: string, limit = 20): Promise<NylasMessage[]> {
  const payload = await nylasRequest<{ data?: NylasMessage[] }>(
    `/v3/grants/${encodeURIComponent(grantId)}/messages?limit=${Math.min(Math.max(limit, 1), 50)}`,
  );
  return Array.isArray(payload.data) ? payload.data : [];
}

export function randomUrlSafe(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToBase64(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(): Promise<CryptoKey> {
  const raw = base64ToBytes(requiredEnv("EMAIL_CODE_ENCRYPTION_KEY"));
  if (raw.byteLength !== 32) {
    throw new Error("EMAIL_CODE_ENCRYPTION_KEY deve conter exatamente 32 bytes em Base64.");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptEmailCode(code: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(code),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptEmailCode(ciphertext: string, iv: string): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    await encryptionKey(),
    base64ToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export function maskEmailCode(length: number): string {
  return "•".repeat(Math.max(4, Math.min(length, 10)));
}

export function getAllowedSenderRules(): string[] {
  return (env("WEBCONTINENTAL_ALLOWED_SENDERS") || DEFAULT_ALLOWED_SENDERS)
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedWebContinentalSender(email: string): boolean {
  return matchesAllowedEmailSender(email, getAllowedSenderRules());
}

export function getCodeTtlMinutes(): number {
  const parsed = Number(env("EMAIL_CODE_TTL_MINUTES") || 15);
  if (!Number.isFinite(parsed)) return 15;
  return Math.min(Math.max(Math.round(parsed), 5), 60);
}

function receivedDate(message: NylasMessage): Date {
  const value = Number(message.date ?? 0);
  const date = value > 0 ? new Date(value * 1000) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function finishWebhookEvent(
  eventId: string | null,
  status: "processed" | "ignored" | "failed",
  error?: string,
) {
  if (!eventId) return;
  const db = supabaseAdmin as any;
  await db
    .from("email_webhook_events")
    .update({
      status,
      last_error: error?.slice(0, 1000) ?? null,
      processed_at: status === "failed" ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("event_id", eventId);
}

type ActiveEmailConnection = { id: string; user_id: string; status: string };
type StorableEmailMessage = {
  id: string;
  subject?: string | null;
  body?: string | null;
  snippet?: string | null;
  received_at: string;
  from?: Array<{ email?: string | null; name?: string | null }>;
};

async function storeEmailMessage(
  connection: ActiveEmailConnection,
  message: StorableEmailMessage,
  eventId?: string | null,
) {
  const db = supabaseAdmin as any;
  const sender = message.from?.[0]?.email?.trim().toLowerCase() ?? "";
  const receivedAt = new Date(message.received_at);
  const expiresAt = new Date(receivedAt.getTime() + getCodeTtlMinutes() * 60_000);

  await db
    .from("email_connections")
    .update({
      last_sync_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  if (!sender || !isAllowedWebContinentalSender(sender)) {
    await finishWebhookEvent(eventId ?? null, "ignored", "Remetente fora da lista permitida.");
    return { stored: false, reason: "sender_not_allowed" };
  }
  if (!matchesWebContinentalTokenSubject(message.subject)) {
    await finishWebhookEvent(
      eventId ?? null,
      "ignored",
      "Assunto não corresponde ao token de acesso da WebContinental Marketplace.",
    );
    return { stored: false, reason: "subject_not_allowed" };
  }
  if (expiresAt.getTime() <= Date.now()) {
    await finishWebhookEvent(
      eventId ?? null,
      "ignored",
      "Mensagem recebida fora da janela de validade.",
    );
    return { stored: false, reason: "message_too_old" };
  }

  const code = extractWebContinentalCode(message);
  if (!code) {
    await finishWebhookEvent(eventId ?? null, "ignored", "Nenhum código reconhecido.");
    return { stored: false, reason: "code_not_found" };
  }

  const encrypted = await encryptEmailCode(code);
  const { error: upsertError } = await db.from("email_verification_codes").upsert(
    {
      connection_id: connection.id,
      owner_user_id: connection.user_id,
      provider_message_id: message.id,
      sender_email: sender,
      subject: String(message.subject ?? "").slice(0, 300) || null,
      code_ciphertext: encrypted.ciphertext,
      code_iv: encrypted.iv,
      code_length: code.length,
      received_at: receivedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    },
    { onConflict: "connection_id,provider_message_id", ignoreDuplicates: true },
  );
  if (upsertError) throw new Error(upsertError.message);
  await finishWebhookEvent(eventId ?? null, "processed");
  return { stored: true };
}

export async function processNylasMessage(args: {
  grantId: string;
  messageId: string;
  eventId?: string | null;
}) {
  const db = supabaseAdmin as any;
  const { data: connection, error: connectionError } = await db
    .from("email_connections")
    .select("id, user_id, status")
    .eq("provider", "nylas")
    .eq("provider_grant_id", args.grantId)
    .maybeSingle();
  if (connectionError) throw new Error(connectionError.message);
  if (!connection || connection.status === "revoked") {
    await finishWebhookEvent(args.eventId ?? null, "ignored", "Conexão inexistente ou revogada.");
    return { stored: false, reason: "connection_not_active" };
  }
  const message = await getNylasMessage(args.grantId, args.messageId);
  return storeEmailMessage(
    connection,
    {
      id: message.id,
      subject: message.subject,
      body: message.body,
      snippet: message.snippet,
      received_at: receivedDate(message).toISOString(),
      from: message.from,
    },
    args.eventId,
  );
}

export async function syncNangoConnection(connection: {
  id: string;
  user_id: string;
  provider_grant_id: string;
  provider_name?: string | null;
  provider_credential_slot?: number | null;
  status: string;
}) {
  const db = supabaseAdmin as any;
  if (connection.status === "revoked") throw new Error("Esta conexão foi revogada.");
  const { connectorForNangoIntegration, getNangoMessage, listNangoMessageIds } =
    await import("@/lib/email-nango.server");
  const integrationId = String(connection.provider_name ?? "").trim();
  const credentialSlot = connection.provider_credential_slot === 2 ? 2 : 1;
  const connector = connectorForNangoIntegration(integrationId, credentialSlot);
  if (!connector) throw new Error("Integração Nango desconhecida para esta conexão.");
  const ids = await listNangoMessageIds({
    connectionId: connection.provider_grant_id,
    integrationId,
    connector,
    limit: 20,
    credentialSlot,
  });
  const { data: existing, error: existingError } = ids.length
    ? await db
        .from("email_verification_codes")
        .select("provider_message_id")
        .eq("connection_id", connection.id)
        .in("provider_message_id", ids)
    : { data: [], error: null };
  if (existingError) throw new Error(existingError.message);
  const seen = new Set((existing ?? []).map((row: any) => String(row.provider_message_id)));
  let stored = 0;
  for (const messageId of ids) {
    if (seen.has(messageId)) continue;
    const message = await getNangoMessage({
      connectionId: connection.provider_grant_id,
      integrationId,
      connector,
      messageId,
      credentialSlot,
    });
    const result = await storeEmailMessage(connection, message);
    if (result.stored) stored += 1;
  }
  const now = new Date().toISOString();
  await db
    .from("email_connections")
    .update({ last_sync_at: now, last_error: null, updated_at: now })
    .eq("id", connection.id);
  return { checked: ids.length, stored };
}

export async function syncAllNangoConnections(limit = 10) {
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("email_connections")
    .select("id, user_id, provider_grant_id, provider_name, status, last_sync_at")
    .eq("provider", "nango")
    .eq("status", "connected")
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(Math.min(Math.max(limit, 1), 25));
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((connection: any) => connection.id);
  const { data: slotRows } = ids.length
    ? await db.from("email_connections").select("id,provider_credential_slot").in("id", ids)
    : { data: [] };
  const slots = new Map(
    (slotRows ?? []).map((row: any) => [row.id, row.provider_credential_slot === 2 ? 2 : 1]),
  );
  const results: Array<{ id: string; checked: number; stored: number; error?: string }> = [];
  for (const connection of data ?? []) {
    try {
      const result = await syncNangoConnection({
        ...connection,
        provider_credential_slot: slots.get(connection.id) ?? 1,
      });
      results.push({ id: connection.id, ...result });
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "Falha na leitura Nango.";
      await db
        .from("email_connections")
        .update({ last_error: message.slice(0, 1000), updated_at: new Date().toISOString() })
        .eq("id", connection.id);
      results.push({ id: connection.id, checked: 0, stored: 0, error: message });
    }
  }
  return results;
}

export async function processNylasGrantEvent(
  grantId: string,
  eventType: string,
  eventId?: string | null,
) {
  const db = supabaseAdmin as any;
  const status = eventType.startsWith("grant.deleted") ? "revoked" : "reauth_required";
  await db
    .from("email_connections")
    .update({
      status,
      last_error: `Nylas informou ${eventType}.`,
      updated_at: new Date().toISOString(),
    })
    .eq("provider", "nylas")
    .eq("provider_grant_id", grantId);
  await finishWebhookEvent(eventId ?? null, "processed");
}

export async function markWebhookFailed(eventId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Falha ao processar evento de e-mail.";
  await finishWebhookEvent(eventId, "failed", message);
}

export async function verifyNylasWebhookSignature(
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  const secret = env("NYLAS_WEBHOOK_SECRET");
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const actual = signature.trim().toLowerCase();
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}
