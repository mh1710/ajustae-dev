import { passwordExpired } from "./password-policy";

export const CODE_TTL_MINUTES = 10;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_SECONDS = 60;
export const CODE_MAX_PER_HOUR = 6;

export function sessionIdFromClaims(claims: unknown): string {
  const sid = (claims as { session_id?: unknown } | null)?.session_id;
  if (typeof sid !== "string" || !/^[0-9a-f-]{36}$/i.test(sid)) throw new Error("Sessão inválida. Entre novamente.");
  return sid;
}

/** Último login por senha (ou link de recuperação) desta sessão, em segundos desde a época. */
export function recentAuthMethod(claims: unknown, methods: string[], maxAgeSeconds: number, nowSeconds = Date.now() / 1000) {
  const amr = (claims as { amr?: Array<{ method?: string; timestamp?: number }> } | null)?.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => typeof entry?.timestamp === "number" && methods.includes(String(entry.method)) && nowSeconds - entry.timestamp <= maxAgeSeconds);
}

export function generateCode() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String((buf[0] ?? 0) % 1_000_000).padStart(6, "0");
}

export async function hashCode(challengeId: string, code: string) {
  const data = new TextEncoder().encode(`${challengeId}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function sameHash(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function maskEmail(email: string) {
  const [user = "", domain = ""] = email.split("@");
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${"•".repeat(Math.max(1, user.length - visible.length))}@${domain}`;
}

export type SecurityState = {
  enforced: boolean;
  mfa_verified: boolean;
  password_ok: boolean;
  ok: boolean;
  restricted: boolean;
  code_email: string;
  pending_code: boolean;
};

export async function loadSecurityState(userId: string, sessionId: string): Promise<SecurityState & { mfa_email_full: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const [settings, sec, mfa, user, roles, pending] = await Promise.all([
    db.from("account_security_settings").select("enforced, enforced_user_ids").eq("id", true).maybeSingle(),
    db.from("account_security").select("password_changed_at, mfa_email").eq("user_id", userId).maybeSingle(),
    db.from("account_mfa_sessions").select("session_id").eq("session_id", sessionId).eq("user_id", userId).maybeSingle(),
    supabaseAdmin.auth.admin.getUserById(userId),
    db.from("user_roles").select("role").eq("user_id", userId),
    db.from("account_mfa_challenges").select("id").eq("session_id", sessionId).is("consumed_at", null)
      .gt("expires_at", new Date().toISOString()).limit(1),
  ]);
  for (const r of [settings, sec, mfa, roles, pending]) if (r.error) throw new Error("Não foi possível conferir a segurança da conta.");
  if (user.error || !user.data.user) throw new Error("Conta não encontrada.");
  const enforced = !!settings.data?.enforced || ((settings.data?.enforced_user_ids ?? []) as string[]).includes(userId);
  const mfaVerified = !!mfa.data;
  const passwordOk = !passwordExpired(sec.data?.password_changed_at ?? null);
  const email = (sec.data?.mfa_email as string | null) || user.data.user.email || "";
  return {
    enforced,
    mfa_verified: mfaVerified,
    password_ok: passwordOk,
    ok: !enforced || (mfaVerified && passwordOk),
    restricted: (roles.data ?? []).some((r: { role: string }) => String(r.role) === "company_viewer"),
    code_email: email ? maskEmail(email) : "",
    pending_code: (pending.data ?? []).length > 0,
    mfa_email_full: email,
  };
}

/** Troca a senha pelo servidor; a concessão faz o banco registrar a data da troca válida. */
export async function setPasswordWithGrant(userId: string, password: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const grant = await db.from("account_password_grants")
    .upsert({ user_id: userId, expires_at: new Date(Date.now() + 2 * 60_000).toISOString() }, { onConflict: "user_id" });
  if (grant.error) throw new Error("Não foi possível autorizar a troca de senha.");
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
  if (error) {
    await db.from("account_password_grants").delete().eq("user_id", userId);
    throw new Error(/same/i.test(error.message) ? "Escolha uma senha diferente da atual." : error.message);
  }
}

/** Confere a senha atual sem afetar as sessões existentes. */
export async function verifyCurrentPassword(email: string, password: string) {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Configuração de acesso indisponível.");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  await client.auth.signOut({ scope: "local" });
  return true;
}
