/* eslint-disable @typescript-eslint/no-explicit-any */

const NANGO_DEFAULT_API = "https://api.nango.dev";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const OUTLOOK_READONLY_SCOPES = "openid email offline_access User.Read Mail.Read";

export type EmailConnector = "google" | "microsoft";

export type ProviderEmailMessage = {
  id: string;
  subject?: string | null;
  body?: string | null;
  snippet?: string | null;
  received_at: string;
  from?: Array<{ email?: string | null; name?: string | null }>;
};

type JsonRecord = Record<string, any>;

class NangoHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Configuração ausente no servidor: ${name}`);
  return value;
}

function apiBase(): string {
  return (env("NANGO_API_URL") || NANGO_DEFAULT_API).replace(/\/$/, "");
}

export function getNangoIntegrationId(connector: EmailConnector): string {
  if (connector === "microsoft") return env("NANGO_OUTLOOK_INTEGRATION_ID") || "outlook";
  return env("NANGO_GMAIL_INTEGRATION_ID") || "google-mail";
}

export function getNangoReadonlyScopes(connector: EmailConnector): string {
  return connector === "microsoft" ? OUTLOOK_READONLY_SCOPES : GMAIL_READONLY_SCOPE;
}

export function connectorForNangoIntegration(integrationId: string): EmailConnector | null {
  if (integrationId === getNangoIntegrationId("google")) return "google";
  if (integrationId === getNangoIntegrationId("microsoft")) return "microsoft";
  return null;
}

async function parseResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function errorMessage(payload: any, fallback: string): string {
  return String(
    payload?.error?.message ??
      payload?.error?.code ??
      payload?.message ??
      payload?.error ??
      fallback,
  );
}

async function nangoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requiredEnv("NANGO_API_KEY")}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await parseResponse(response);
  if (!response.ok) {
    throw new NangoHttpError(
      errorMessage(payload, `Nango respondeu HTTP ${response.status}`),
      response.status,
    );
  }
  return payload as T;
}

export async function createNangoConnectSession(args: {
  userId: string;
  userEmail?: string | null;
  displayName?: string | null;
  connector: EmailConnector;
}) {
  const integrationId = getNangoIntegrationId(args.connector);
  const payload = await nangoRequest<{
    data?: { token?: string; connect_link?: string; expires_at?: string };
  }>("/connect/sessions", {
    method: "POST",
    body: JSON.stringify({
      end_user: {
        id: args.userId,
        ...(args.userEmail ? { email: args.userEmail } : {}),
        ...(args.displayName ? { display_name: args.displayName } : {}),
      },
      tags: {
        ajustae_user_id: args.userId,
        ...(args.userEmail ? { end_user_email: args.userEmail } : {}),
      },
      allowed_integrations: [integrationId],
      integrations_config_defaults: {
        [integrationId]: {
          connection_config: {
            oauth_scopes_override: getNangoReadonlyScopes(args.connector),
          },
        },
      },
    }),
  });
  const token = payload.data?.token;
  if (!token) throw new Error("O Nango não devolveu o token da sessão de conexão.");
  return {
    token,
    connect_link: payload.data?.connect_link ?? null,
    expires_at: payload.data?.expires_at ?? null,
    integration_id: integrationId,
  };
}

type NangoConnectionSummary = {
  connection_id?: string;
  id?: string;
  provider_config_key?: string;
  providerConfigKey?: string;
  end_user?: { id?: string } | null;
  endUser?: { id?: string } | null;
  tags?: Record<string, string>;
};

function connectionArray(payload: any): NangoConnectionSummary[] {
  if (Array.isArray(payload?.connections)) return payload.connections;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.connections)) return payload.data.connections;
  return [];
}

export async function assertNangoConnectionOwnership(args: {
  connectionId: string;
  integrationId: string;
  userId: string;
}) {
  const params = new URLSearchParams({
    endUserId: args.userId,
    integrationId: args.integrationId,
    limit: "100",
  });
  let payload: any;
  try {
    payload = await nangoRequest<any>(`/connections?${params}`);
  } catch (error) {
    if (!(error instanceof NangoHttpError) || error.status !== 404) throw error;
    payload = await nangoRequest<any>(`/connection?${params}`);
  }
  const connection = connectionArray(payload).find((item) => {
    const id = String(item.connection_id ?? item.id ?? "");
    const integration = String(item.provider_config_key ?? item.providerConfigKey ?? "");
    const owner = String(item.end_user?.id ?? item.endUser?.id ?? item.tags?.ajustae_user_id ?? "");
    return id === args.connectionId && integration === args.integrationId && owner === args.userId;
  });
  if (!connection) {
    throw new Error("A conexão do Nango não pertence ao usuário autenticado.");
  }
  return connection;
}

async function nangoProxy<T>(args: {
  connectionId: string;
  integrationId: string;
  path: string;
  init?: RequestInit;
}): Promise<T> {
  return nangoRequest<T>(`/proxy${args.path}`, {
    ...args.init,
    headers: {
      "connection-id": args.connectionId,
      "provider-config-key": args.integrationId,
      ...args.init?.headers,
    },
  });
}

function decodeBase64UrlUtf8(value?: string | null): string {
  if (!value) return "";
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function gmailHeader(payload: any, name: string): string {
  const headers = Array.isArray(payload?.headers) ? payload.headers : [];
  return String(
    headers.find((header: any) => String(header?.name ?? "").toLowerCase() === name.toLowerCase())
      ?.value ?? "",
  );
}

function gmailBodies(part: any, out: { plain: string[]; html: string[] }) {
  const mimeType = String(part?.mimeType ?? "").toLowerCase();
  const decoded = decodeBase64UrlUtf8(part?.body?.data);
  if (decoded && mimeType === "text/plain") out.plain.push(decoded);
  else if (decoded && mimeType === "text/html") out.html.push(decoded);
  for (const child of Array.isArray(part?.parts) ? part.parts : []) gmailBodies(child, out);
}

export function normalizeGmailMessage(message: any): ProviderEmailMessage {
  const bodies = { plain: [] as string[], html: [] as string[] };
  gmailBodies(message?.payload, bodies);
  const fromHeader = gmailHeader(message?.payload, "from");
  const email =
    fromHeader.match(/<([^>]+)>/)?.[1] ?? fromHeader.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? "";
  const name = fromHeader.includes("<")
    ? fromHeader.split("<")[0].trim().replace(/^"|"$/g, "")
    : "";
  const timestamp = Number(message?.internalDate ?? 0);
  const received = timestamp > 0 ? new Date(timestamp) : new Date();
  return {
    id: String(message?.id ?? ""),
    subject: gmailHeader(message?.payload, "subject") || null,
    body: bodies.plain.join("\n").trim() || bodies.html.join("\n").trim() || null,
    snippet: String(message?.snippet ?? "") || null,
    received_at: Number.isNaN(received.getTime())
      ? new Date().toISOString()
      : received.toISOString(),
    from: email ? [{ email: email.toLowerCase(), name: name || null }] : [],
  };
}

export async function getNangoMailboxEmail(args: {
  connectionId: string;
  integrationId: string;
  connector: EmailConnector;
}): Promise<string | null> {
  if (args.connector === "microsoft") {
    const profile = await nangoProxy<JsonRecord>({ ...args, path: "/v1.0/me" });
    return (
      String(profile.mail ?? profile.userPrincipalName ?? "")
        .trim()
        .toLowerCase() || null
    );
  }
  const profile = await nangoProxy<JsonRecord>({
    ...args,
    path: "/gmail/v1/users/me/profile",
  });
  return (
    String(profile.emailAddress ?? "")
      .trim()
      .toLowerCase() || null
  );
}

export async function listNangoMessageIds(args: {
  connectionId: string;
  integrationId: string;
  connector: EmailConnector;
  limit?: number;
}): Promise<string[]> {
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
  if (args.connector === "microsoft") {
    const query = new URLSearchParams({
      $top: String(limit),
      $select: "id,subject,receivedDateTime,from,bodyPreview",
      $orderby: "receivedDateTime desc",
      $filter: `receivedDateTime ge ${new Date(Date.now() - 24 * 3600_000).toISOString()}`,
    });
    const payload = await nangoProxy<{ value?: Array<{ id?: string }> }>({
      ...args,
      path: `/v1.0/me/messages?${query}`,
    });
    return (payload.value ?? []).map((item) => String(item.id ?? "")).filter(Boolean);
  }
  const query = new URLSearchParams({
    maxResults: String(limit),
    labelIds: "INBOX",
    q: 'subject:"WebContinental Marketplace - Token de acesso" newer_than:1d',
  });
  const payload = await nangoProxy<{ messages?: Array<{ id?: string }> }>({
    ...args,
    path: `/gmail/v1/users/me/messages?${query}`,
  });
  return (payload.messages ?? []).map((item) => String(item.id ?? "")).filter(Boolean);
}

export async function getNangoMessage(args: {
  connectionId: string;
  integrationId: string;
  connector: EmailConnector;
  messageId: string;
}): Promise<ProviderEmailMessage> {
  if (args.connector === "microsoft") {
    const message = await nangoProxy<any>({
      ...args,
      path: `/v1.0/me/messages/${encodeURIComponent(args.messageId)}?$select=id,subject,receivedDateTime,from,body,bodyPreview`,
    });
    return {
      id: String(message.id ?? args.messageId),
      subject: String(message.subject ?? "") || null,
      body: String(message.body?.content ?? "") || null,
      snippet: String(message.bodyPreview ?? "") || null,
      received_at: new Date(message.receivedDateTime ?? Date.now()).toISOString(),
      from: message.from?.emailAddress?.address
        ? [
            {
              email: String(message.from.emailAddress.address).toLowerCase(),
              name: String(message.from.emailAddress.name ?? "") || null,
            },
          ]
        : [],
    };
  }
  const message = await nangoProxy<any>({
    ...args,
    path: `/gmail/v1/users/me/messages/${encodeURIComponent(args.messageId)}?format=full`,
  });
  return normalizeGmailMessage(message);
}

export async function deleteNangoConnection(args: { connectionId: string; integrationId: string }) {
  const query = new URLSearchParams({ provider_config_key: args.integrationId });
  try {
    await nangoRequest(`/connections/${encodeURIComponent(args.connectionId)}?${query}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (!(error instanceof NangoHttpError) || error.status !== 404) throw error;
    await nangoRequest(`/connection/${encodeURIComponent(args.connectionId)}?${query}`, {
      method: "DELETE",
    });
  }
}

export function isNangoConfigured(): boolean {
  return !!env("NANGO_API_KEY");
}
