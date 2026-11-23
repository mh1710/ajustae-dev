// Server-only helpers for the Bling OAuth flow + rate-limited API access.
// Do not import from client code.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isLocalBlingTestRuntime } from "@/lib/local-test-environment.server";

export const BLING_API_BASE = "https://api.bling.com.br/Api/v3";
// Minimum ms between two API calls for the same integration.
// Shared company limit: at most two calls per second, with 550ms spacing.
export const BLING_MIN_INTERVAL_MS = 550;

const BLING_AUTH_URL = "https://api.bling.com.br/Api/v3/oauth/authorize";
const BLING_TOKEN_URL = "https://api.bling.com.br/Api/v3/oauth/token";

export function getBlingCallbackUrl(): string {
  // O redirect_uri cadastrado no Bling pode apontar para outro domínio
  // (ponte que só faz 302 para cá). Quando BLING_REDIRECT_BASE_URL está
  // definido, ele tem prioridade sobre APP_PUBLIC_URL.
  const base = process.env.BLING_REDIRECT_BASE_URL || process.env.APP_PUBLIC_URL;
  if (!base) {
    throw new Error("APP_PUBLIC_URL não configurado no backend.");
  }
  return `${base.replace(/\/$/, "")}/api/public/bling/callback`;
}


export interface BlingClientCredentials {
  clientId: string;
  clientSecret: string;
}

/** Credenciais globais (fallback via env) — usadas apenas se a empresa não tiver as suas. */
function getEnvClientCredentials(): BlingClientCredentials | null {
  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Credenciais do app OAuth do Bling da empresa (Client ID + Client Secret
 * salvos em bling_integrations). Cai para as variáveis de ambiente se a
 * empresa ainda não tiver credenciais próprias.
 */
export async function getCompanyBlingCredentials(
  companyId: string,
): Promise<BlingClientCredentials> {
  const { data } = await supabaseAdmin
    .from("bling_integrations")
    .select("client_id, client_secret")
    .eq("company_id", companyId)
    .maybeSingle();
  if (data?.client_id && data?.client_secret) {
    return { clientId: data.client_id, clientSecret: data.client_secret };
  }
  // O ambiente local deve usar somente a credencial explicitamente cadastrada
  // para a empresa de teste. Nunca herde um app global do processo/.env normal.
  if (isLocalBlingTestRuntime()) {
    throw new Error(
      "Cadastre o Client ID e o Client Secret desta empresa no ambiente local de teste.",
    );
  }
  const env = getEnvClientCredentials();
  if (env) return env;
  throw new Error(
    "Esta empresa ainda não tem Client ID e Client Secret do Bling cadastrados.",
  );
}

export function buildBlingAuthorizeUrl(state: string, clientId: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    state,
    redirect_uri: getBlingCallbackUrl(),
  });
  return `${BLING_AUTH_URL}?${params.toString()}`;
}

interface BlingTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
}

/** POST único no endpoint de token do Bling, sem espera ou repetição automática. */
async function postBlingToken(
  creds: BlingClientCredentials,
  body: URLSearchParams,
  tag: string,
): Promise<BlingTokenResponse> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetch(BLING_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "enable-jwt": "1",
    },
    body: body.toString(),
  });

  if (res.ok) return (await res.json()) as BlingTokenResponse;
  const errText = await res.text().catch(() => "");
  console.error(`[${tag}]`, res.status, errText.slice(0, 500));
  if (res.status === 429) {
    throw new Error(
      "O Bling recusou por excesso de requisições (429). Aguarde um minuto e tente novamente.",
    );
  }
  throw new Error(`Falha ao obter token do Bling (${res.status}). ${errText.slice(0, 200)}`);
}

export async function exchangeBlingCode(
  code: string,
  creds: BlingClientCredentials,
): Promise<BlingTokenResponse> {
  return postBlingToken(
    creds,
    new URLSearchParams({ grant_type: "authorization_code", code }),
    "bling-token-exchange",
  );
}

export async function refreshBlingToken(
  refreshToken: string,
  creds: BlingClientCredentials,
): Promise<BlingTokenResponse> {
  return postBlingToken(
    creds,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    "bling-refresh",
  );
}

/**
 * Faz a rotação do token uma empresa por vez. O refresh token do Bling é
 * rotativo: duas renovações simultâneas fazem a segunda receber invalid_grant,
 * mesmo quando a primeira já salvou um token perfeitamente válido.
 */
async function rotateCompanyBlingToken(
  integration: {
    company_id: string;
    access_token: string | null;
    refresh_token: string | null;
    token_expires_at: string | null;
  },
  force = false,
): Promise<string> {
  const leaseKey = `bling-token:${integration.company_id}`;
  const holder = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let acquired = false;

  for (let attempt = 0; attempt < 12 && !acquired; attempt++) {
    const { data } = await supabaseAdmin.rpc("acquire_worker_lease", {
      _pool: "bling_token_refresh",
      _key: leaseKey,
      _holder: holder,
      _ttl_seconds: 45,
      _max_concurrent: 11,
    } as never);
    acquired = Boolean(data);
    if (!acquired) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!acquired) throw new Error("Renovação do token já está em andamento. A atualização retomará automaticamente.");

  try {
    const { data: current, error } = await supabaseAdmin
      .from("bling_integrations")
      .select("access_token, refresh_token, token_expires_at")
      .eq("company_id", integration.company_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!current?.access_token) throw new Error("Sem token de acesso.");

    const expiresAt = current.token_expires_at ? new Date(current.token_expires_at).getTime() : 0;
    const wasAlreadyRotated = current.access_token !== integration.access_token;
    if ((force && wasAlreadyRotated) || (!force && expiresAt - Date.now() > 60_000)) {
      integration.access_token = current.access_token;
      integration.refresh_token = current.refresh_token;
      integration.token_expires_at = current.token_expires_at;
      return current.access_token;
    }
    if (!current.refresh_token) throw new Error("Sem refresh token disponível.");

    const creds = await getCompanyBlingCredentials(integration.company_id);
    try {
      const token = await refreshBlingToken(current.refresh_token, creds);
      const newExpiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
      await supabaseAdmin
        .from("bling_integrations")
        .update({
          access_token: token.access_token,
          refresh_token: token.refresh_token ?? current.refresh_token,
          token_expires_at: newExpiresAt,
          scopes: token.scope ?? null,
          status: "conectada",
          last_error: null,
        })
        .eq("company_id", integration.company_id);
      integration.access_token = token.access_token;
      integration.refresh_token = token.refresh_token ?? current.refresh_token;
      integration.token_expires_at = newExpiresAt;
      return token.access_token;
    } catch (refreshError) {
      // Uma renovação pode ter terminado entre a leitura e a chamada. Nunca
      // derruba uma conexão se o banco já contém outro token ainda válido.
      const { data: latest } = await supabaseAdmin
        .from("bling_integrations")
        .select("access_token, refresh_token, token_expires_at")
        .eq("company_id", integration.company_id)
        .maybeSingle();
      const latestExpiry = latest?.token_expires_at ? new Date(latest.token_expires_at).getTime() : 0;
      if (latest?.access_token && latest.access_token !== current.access_token && latestExpiry > Date.now()) {
        integration.access_token = latest.access_token;
        integration.refresh_token = latest.refresh_token;
        integration.token_expires_at = latest.token_expires_at;
        return latest.access_token;
      }
      throw refreshError;
    }
  } finally {
    try {
      await supabaseAdmin.rpc("release_worker_lease", { _key: leaseKey, _holder: holder } as never);
    } catch {
      // A concessão expira sozinha; falha ao liberar não pode derrubar o fluxo.
    }
  }
}

/**
 * Valida Client ID + Client Secret sem precisar de token OAuth.
 * O Bling v3 não tem grant client_credentials, então usamos uma troca de
 * authorization_code com um code inválido: se as credenciais estiverem
 * erradas o Bling responde invalid_client (401); se estiverem corretas ele
 * responde invalid_grant (400), o que prova que o app foi reconhecido.
 */
export async function verifyBlingClientCredentials(
  creds: BlingClientCredentials,
): Promise<{ valid: boolean; detail: string }> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetch(BLING_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "enable-jwt": "1",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "credential-check-invalid-code",
      redirect_uri: getBlingCallbackUrl(),
    }).toString(),
  });
  const text = await res.text().catch(() => "");
  const lower = text.toLowerCase();
  if (res.ok) return { valid: true, detail: "Credenciais aceitas pelo Bling." };
  if (lower.includes("invalid_client") || res.status === 401) {
    return { valid: false, detail: "Client ID ou Client Secret inválidos." };
  }
  if (lower.includes("invalid_grant") || lower.includes("invalid_code") || res.status === 400) {
    return { valid: true, detail: "Client ID e Client Secret válidos." };
  }
  console.error("[bling-verify-credentials]", res.status, text.slice(0, 500));
  return { valid: false, detail: `Bling respondeu ${res.status}.` };
}



export async function refreshBlingTokenIfNeeded(integration: {
  company_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
}): Promise<string> {
  if (!integration.access_token) throw new Error("Sem token de acesso.");
  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  const now = Date.now();
  // Refresh if within 60s of expiring
  if (expiresAt - now > 60_000) return integration.access_token;
  return rotateCompanyBlingToken(integration);
}

// Database arbitration also covers concurrent requests and separate Workers.
async function respectRateLimit(companyId: string) {
  for (;;) {
    const { data, error } = await (supabaseAdmin as any).rpc("take_bling_company_slot", { _company_id: companyId });
    if (error) throw new Error("Não foi possível reservar uma consulta ao Bling. Tente novamente.");
    const wait = Number(data);
    if (!Number.isFinite(wait) || wait < 0) throw new Error("Limite de consultas indisponível.");
    if (wait === 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.max(25, wait)));
  }
}

export interface BlingIntegrationRow {
  id: string;
  company_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  status: string;
}

export interface BlingCallResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  errorMessage?: string;
  errorCode?: string;
  responseBodySafe?: string;
  retries: number;
}

async function safeResponseText(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return text;
}

/** Fire-and-forget log de uma chamada à API do Bling, para contabilizar o limite diário de 120k. */
function logBlingCall(params: {
  company_id: string;
  integration_id: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  ok: boolean;
  retries: number;
  source?: string;
}) {
  const endpoint = params.path.split("?")[0].slice(0, 200);
  supabaseAdmin
    .from("bling_api_calls")
    .insert({
      company_id: params.company_id,
      integration_id: params.integration_id,
      method: params.method,
      endpoint,
      status: params.status,
      duration_ms: params.duration_ms,
      ok: params.ok,
      retries: params.retries,
      source: params.source ?? null,
    })
    .then(({ error }) => {
      if (error) console.error("[bling-api-log]", error.message);
    });
}


/**
 * Rate-limited GET to the Bling API with:
 *  - automatic token refresh on 401 (single retry)
 *  - Retry-After honored on 429
 *  - exponential backoff on 429/5xx (up to 5 attempts)
 *  - 400/404 returned as final (no retry) — caller decides
 */
export async function blingApiGet<T = unknown>(
  integration: BlingIntegrationRow,
  path: string,
): Promise<BlingCallResult<T>> {
  const backoff = [2000, 5000, 10000, 20000, 40000];
  let retries = 0;
  let token = await refreshBlingTokenIfNeeded(integration);
  let didAuthRefresh = false;

  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    await respectRateLimit(integration.company_id);
    let res: Response;
    const _t0 = Date.now();
    try {
      res = await fetch(`${BLING_API_BASE}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "enable-jwt": "1",
        },
      });
      logBlingCall({ company_id: integration.company_id, integration_id: integration.id, method: "GET", path, status: res.status, duration_ms: Date.now() - _t0, ok: res.ok, retries });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "network_error";
      logBlingCall({ company_id: integration.company_id, integration_id: integration.id, method: "GET", path, status: 0, duration_ms: Date.now() - _t0, ok: false, retries });
      if (attempt >= backoff.length) {
        return { ok: false, status: 0, errorMessage: msg, errorCode: "network", responseBodySafe: msg, retries };
      }
      const wait = backoff[attempt] + Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, wait));
      retries++;
      continue;
    }


    if (res.status === 401 && !didAuthRefresh) {
      didAuthRefresh = true;
      try {
        // Force refresh regardless of expiry
        const { refreshBlingToken } = await import("./bling.server");
        if (!integration.refresh_token) {
          await supabaseAdmin
            .from("bling_integrations")
            .update({ status: "requer_reconexao", last_error: "401 e sem refresh token." })
            .eq("id", integration.id);
          return { ok: false, status: 401, errorMessage: "requer_reconexao", errorCode: "auth", responseBodySafe: "requer_reconexao", retries };
        }
        token = await rotateCompanyBlingToken(integration, true);
        continue; // retry once
      } catch (e) {
        await supabaseAdmin
          .from("bling_integrations")
          .update({
            status: "requer_reconexao",
            last_error: e instanceof Error ? e.message : "Falha ao renovar token.",
          })
          .eq("id", integration.id);
        return { ok: false, status: 401, errorMessage: "requer_reconexao", errorCode: "auth", responseBodySafe: "requer_reconexao", retries };
      }
    }

    if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
      if (attempt >= backoff.length) {
        const text = await safeResponseText(res);
        return {
          ok: false,
          status: res.status,
          errorMessage: text.slice(0, 300) || `HTTP ${res.status}`,
          errorCode: res.status === 429 ? "rate_limit" : "server_error",
          responseBodySafe: text.slice(0, 1000),
          retries,
        };
      }
      let wait: number;
      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        wait = retryAfter ? Math.max(1, parseInt(retryAfter, 10)) * 1000 : backoff[attempt];
      } else {
        wait = backoff[attempt];
      }
      wait += Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, wait));
      retries++;
      continue;
    }

    if (!res.ok) {
      const text = await safeResponseText(res);
      const scopeIssue = text.includes("insufficient_scope");
      return {
        ok: false,
        status: res.status,
        errorMessage: scopeIssue
          ? "permissao_insuficiente: o app do Bling desta empresa consegue LER, mas não ALTERAR. No Bling, abra o app > Lista de escopos > 'Controle de Estoque' (seta) e marque as ações de gravação (incluir/alterar lançamento de estoque). Depois reconecte a empresa aqui para gerar um novo token."
          : text.slice(0, 300) || `HTTP ${res.status}`,
        errorCode: scopeIssue ? "insufficient_scope" : `http_${res.status}`,
        responseBodySafe: text.slice(0, 1000),
        retries,
      };
    }


    const text = await safeResponseText(res);
    let json: T | null = null;
    try {
      json = text ? (JSON.parse(text) as T) : null;
    } catch {
      json = null;
    }
    return { ok: true, status: res.status, data: json ?? (undefined as unknown as T), responseBodySafe: text.slice(0, 1000), retries };
  }

  return { ok: false, status: 0, errorMessage: "exhausted", errorCode: "exhausted", responseBodySafe: "exhausted", retries };
}

/**
 * Rate-limited PATCH/POST/PUT to the Bling API with the same retry/refresh
 * semantics as blingApiGet. `noRetry400` is true because 400/403/404 are
 * validation/permission errors that the queue records as final.
 */
export async function blingApiRequest<T = unknown>(
  integration: BlingIntegrationRow,
  method: "PATCH" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<BlingCallResult<T>> {
  const backoff = [2000, 5000, 10000, 20000, 40000];
  let retries = 0;
  let token = await refreshBlingTokenIfNeeded(integration);
  let didAuthRefresh = false;
  const hasBody = body !== undefined;
  const payload = hasBody ? JSON.stringify(body) : undefined;


  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    await respectRateLimit(integration.company_id);
    let res: Response;
    const _t0 = Date.now();
    try {
      res = await fetch(`${BLING_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "enable-jwt": "1",
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
        },
        ...(hasBody ? { body: payload } : {}),
      });
      logBlingCall({ company_id: integration.company_id, integration_id: integration.id, method, path, status: res.status, duration_ms: Date.now() - _t0, ok: res.ok, retries });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "network_error";
      logBlingCall({ company_id: integration.company_id, integration_id: integration.id, method, path, status: 0, duration_ms: Date.now() - _t0, ok: false, retries });
      if (attempt >= backoff.length) {
        return { ok: false, status: 0, errorMessage: msg, errorCode: "network", responseBodySafe: msg, retries };
      }
      await new Promise((r) => setTimeout(r, backoff[attempt] + Math.floor(Math.random() * 400)));
      retries++;
      continue;
    }


    if (res.status === 401 && !didAuthRefresh) {
      didAuthRefresh = true;
      try {
        if (!integration.refresh_token) {
          await supabaseAdmin
            .from("bling_integrations")
            .update({ status: "requer_reconexao", last_error: "401 sem refresh token." })
            .eq("id", integration.id);
          return { ok: false, status: 401, errorMessage: "requer_reconexao", errorCode: "auth", responseBodySafe: "requer_reconexao", retries };
        }
        token = await rotateCompanyBlingToken(integration, true);
        continue;
      } catch (e) {
        await supabaseAdmin
          .from("bling_integrations")
          .update({ status: "requer_reconexao", last_error: e instanceof Error ? e.message : "Falha ao renovar token." })
          .eq("id", integration.id);
        return { ok: false, status: 401, errorMessage: "requer_reconexao", errorCode: "auth", responseBodySafe: "requer_reconexao", retries };
      }
    }

    if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
      if (attempt >= backoff.length) {
        const text = await safeResponseText(res);
        return {
          ok: false, status: res.status,
          errorMessage: text.slice(0, 300) || `HTTP ${res.status}`,
          errorCode: res.status === 429 ? "rate_limit" : "server_error",
          responseBodySafe: text.slice(0, 1000), retries,
        };
      }
      let wait: number;
      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        wait = retryAfter ? Math.max(1, parseInt(retryAfter, 10)) * 1000 : backoff[attempt];
      } else {
        wait = backoff[attempt];
      }
      await new Promise((r) => setTimeout(r, wait + Math.floor(Math.random() * 400)));
      retries++;
      continue;
    }

    if (!res.ok) {
      const text = await safeResponseText(res);
      const scopeIssue = text.includes("insufficient_scope");
      return {
        ok: false, status: res.status,
        errorMessage: scopeIssue
          ? "permissao_insuficiente: o app do Bling desta empresa consegue LER, mas não ALTERAR. No Bling, abra o app > Lista de escopos > 'Controle de Estoque' (seta) e marque as ações de gravação (incluir/alterar lançamento de estoque). Depois reconecte a empresa aqui para gerar um novo token."
          : text.slice(0, 300) || `HTTP ${res.status}`,
        errorCode: scopeIssue ? "insufficient_scope" : `http_${res.status}`,
        responseBodySafe: text.slice(0, 1000), retries,
      };
    }


    const text = await safeResponseText(res);
    let json: T | null = null;
    try { json = text ? (JSON.parse(text) as T) : null; } catch { json = null; }
    return { ok: true, status: res.status, data: json ?? (undefined as unknown as T), responseBodySafe: text.slice(0, 1000), retries };
  }
  return { ok: false, status: 0, errorMessage: "exhausted", errorCode: "exhausted", responseBodySafe: "exhausted", retries };
}

/**
 * Renova preventivamente os tokens das integrações conectadas.
 * O token do Bling dura ~6h, então renovamos quando falta menos de 1h —
 * na prática, a cada ~5 horas. Usa o Client ID/Secret da empresa.
 */
export async function refreshExpiringBlingTokens(marginMs = 60 * 60 * 1000) {
  // Cooldown entre tentativas por empresa: sem isso, integrações com refresh
  // token inválido eram retentadas a cada tick (1 min) e estouravam o limite
  // do endpoint de token do Bling (429) para todas as outras empresas.
  const RETRY_COOLDOWN_MS = 30 * 60 * 1000;
  const { data, error } = await supabaseAdmin
    .from("bling_integrations")
    .select(
      "company_id, access_token, refresh_token, token_expires_at, status, last_refresh_attempt_at",
    );
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    company_id: string;
    access_token: string | null;
    refresh_token: string | null;
    token_expires_at: string | null;
    status: string | null;
    last_refresh_attempt_at: string | null;
  }>;

  let refreshed = 0;
  let failed = 0;
  let skipped = 0;
  const errors: Array<{ company_id: string; error: string }> = [];

  for (const row of rows) {
    if (!row.refresh_token) continue;
    // Integrações que já precisam de reautorização manual não devem ser
    // retentadas automaticamente — só gastam quota do endpoint de token.
    if (row.status === "requer_reconexao") {
      skipped++;
      continue;
    }
    const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
    if (expiresAt - Date.now() > marginMs) continue;
    const lastAttempt = row.last_refresh_attempt_at
      ? new Date(row.last_refresh_attempt_at).getTime()
      : 0;
    if (Date.now() - lastAttempt < RETRY_COOLDOWN_MS) {
      skipped++;
      continue;
    }
    await supabaseAdmin
      .from("bling_integrations")
      .update({ last_refresh_attempt_at: new Date().toISOString() })
      .eq("company_id", row.company_id);
    try {
      await rotateCompanyBlingToken(row);
      refreshed++;
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ company_id: row.company_id, error: msg });
      const invalidGrant = msg.includes("400") || msg.toLowerCase().includes("invalid_grant");
      await supabaseAdmin
        .from("bling_integrations")
        .update({
          last_error: `Falha ao renovar token: ${msg}`,
          ...(invalidGrant ? { status: "requer_reconexao" } : {}),
        })
        .eq("company_id", row.company_id);
      // Se o Bling está limitando (429), para o ciclo — insistir só piora.
      if (msg.includes("429")) break;
    }
    // Espaçamento entre chamadas ao endpoint de token (limite do Bling).
    await new Promise((r) => setTimeout(r, 1200));
  }
  return { checked: rows.length, refreshed, failed, skipped, errors };
}
