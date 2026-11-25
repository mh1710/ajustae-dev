/**
 * Diagnóstico do 403 (Forbidden) do Mercado Livre, seguindo o guia oficial "Erro 403":
 * aplicativo bloqueado/desativado, escopos, usuário inativo ou com validação pendente,
 * IP não permitido, token de outro dono ou regra interna (PolicyAgent).
 * Módulo puro (sem servidor) para ser testado.
 */

export type Ml403Detail = {
  path: string;
  status: number;
  code: string | null;
  error: string | null;
  message: string | null;
  blockedBy: string | null;
  requestId: string | null;
};

export type Ml403Diagnosis = {
  app?: { active?: boolean; blocked?: boolean; disabled?: boolean; partialBlocked?: boolean; blockedReason?: string | null } | null;
  user?: { siteStatus?: string | null; pendingCodes?: string[] } | null;
  /** Status da mesma consulta feita sem token: 403 também indica bloqueio do recurso, não do token. */
  tokenlessStatus?: number | null;
};

export type Ml403Reason =
  | "app_blocked"
  | "app_disabled"
  | "user_inactive"
  | "invalid_scopes"
  | "ip_not_allowed"
  | "token_owner"
  | "policy_agent"
  | "unknown";

export type Ml403Explanation = { reason: Ml403Reason; text: string; pendingNote: string | null };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseMl403(path: string, body: unknown, headers: { get(name: string): string | null }): Ml403Detail {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  return {
    path,
    status: 403,
    code: str(b["code"]) ?? str(headers.get("x-policy-agent-block-code")),
    error: str(b["error"]),
    message: str(b["message"]) ?? str(headers.get("x-policy-agent-block-reason")),
    blockedBy: str(b["blocked_by"]),
    requestId: str(headers.get("x-request-id")),
  };
}

const PENDING_LABELS: Record<string, string> = {
  address_pending: "endereço da conta não cadastrado",
  identification_pending: "documento da conta não validado",
  phone_pending: "telefone não confirmado",
  email_pending: "e-mail não confirmado",
};

function pendingNote(codes: string[] | undefined): string | null {
  const unique = [...new Set((codes ?? []).filter(Boolean))];
  if (unique.length === 0) return null;
  const labels = unique.map((c) => PENDING_LABELS[c] ?? c);
  return `A conta do Mercado Livre tem pendência de cadastro: ${labels.join(", ")}. Complete em Minha conta para descartar essa causa.`;
}

export function explainMl403(d: Ml403Detail, diag: Ml403Diagnosis = {}): Ml403Explanation {
  const note = pendingNote(diag.user?.pendingCodes);
  const all = `${d.code ?? ""} ${d.error ?? ""} ${d.message ?? ""}`.toLowerCase();
  const out = (reason: Ml403Reason, text: string): Ml403Explanation => ({ reason, text, pendingNote: note });

  if (diag.app?.blocked || diag.app?.partialBlocked) {
    return out("app_blocked", `O Mercado Livre bloqueou o aplicativo${diag.app.blockedReason ? ` (motivo: ${diag.app.blockedReason})` : ""}.`);
  }
  if (diag.app?.disabled || diag.app?.active === false) return out("app_disabled", "O aplicativo está desativado no Mercado Livre.");
  if (diag.user?.siteStatus && diag.user.siteStatus !== "active") {
    return out("user_inactive", `A conta do Mercado Livre está ${diag.user.siteStatus === "deactive" ? "inativa" : diag.user.siteStatus}.`);
  }
  if (all.includes("scope")) return out("invalid_scopes", "Faltam permissões (escopos) no aplicativo para essa consulta.");
  if (/\bip\b|ip address|caller.*not allowed/.test(all)) return out("ip_not_allowed", "O Mercado Livre recusou o endereço de rede (IP) de onde a consulta saiu.");
  if (d.error === "access_denied" || all.includes("access to the requested resource is forbidden")) {
    return out("token_owner", "O token usado não é do dono dessa informação ou não tem permissão para ela.");
  }
  if ((d.blockedBy ?? "").toLowerCase() === "policyagent" || (d.code ?? "").startsWith("PA_")) {
    const scope = diag.tokenlessStatus === 403
      ? "Ela recusa até sem token, então não depende do token, dos escopos nem do aplicativo (que está ativo): o próprio Mercado Livre fechou esse recurso para nós."
      : diag.app && diag.user
        ? "O aplicativo, os escopos e a conta estão ativos."
        : "O Mercado Livre não autorizou esse recurso.";
    return out("policy_agent", `Regra interna do Mercado Livre (PolicyAgent, ${d.code ?? "sem código"}). ${scope}`.trim());
  }
  return out("unknown", `O Mercado Livre recusou sem informar o motivo${d.code ? ` (${d.code})` : ""}.`);
}

export function ml403Summary(e: Ml403Explanation): string {
  return e.pendingNote ? `${e.text} ${e.pendingNote}` : e.text;
}
