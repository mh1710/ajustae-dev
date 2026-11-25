import { supabase } from "@/integrations/supabase/client";
import { claimPasswordChangeSession, getMySecurityState } from "./account-security.functions";
import type { SecurityState } from "./account-security.functions";

// Guarda por alguns minutos o "liberado" da sessão atual para não consultar a cada navegação.
let cache: { token: string; at: number; state: SecurityState } | null = null;
const TTL_MS = 5 * 60_000;

function sessionKey(accessToken: string) {
  try {
    const payload = JSON.parse(atob(accessToken.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    return String(payload.session_id ?? accessToken);
  } catch {
    return accessToken;
  }
}

export async function fetchSecurityState(force = false): Promise<SecurityState | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const key = sessionKey(token);
  if (!force && cache && cache.token === key && cache.state.ok && Date.now() - cache.at < TTL_MS) return cache.state;
  const state = await getMySecurityState();
  cache = { token: key, at: Date.now(), state };
  return state;
}

export function rememberSecurityState(state: SecurityState) {
  supabase.auth.getSession().then(({ data }) => {
    const token = data.session?.access_token;
    if (token) cache = { token: sessionKey(token), at: Date.now(), state };
  });
}

export function clearSecurityState() {
  cache = null;
}

/** A troca de senha encerra as sessões: entra de novo com a senha nova e herda a verificação, quando houver. */
export async function signInAfterPasswordChange(email: string, password: string): Promise<SecurityState | null> {
  clearSecurityState();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return null;
  const state = await claimPasswordChangeSession();
  rememberSecurityState(state);
  return state;
}
