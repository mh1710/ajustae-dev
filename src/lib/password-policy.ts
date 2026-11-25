// Política de senha exigida para todas as contas (Amazon SP-API / proteção de dados).
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_AGE_DAYS = 365;

export function passwordPolicyIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) issues.push(`pelo menos ${PASSWORD_MIN_LENGTH} caracteres`);
  if (password.length > 72) issues.push("no máximo 72 caracteres");
  if (!/[a-zA-Z]/.test(password)) issues.push("uma letra");
  if (!/[0-9]/.test(password)) issues.push("um número");
  if (!/[^a-zA-Z0-9\s]/.test(password)) issues.push("um caractere especial (ex.: ! @ # $ %)");
  return issues;
}

export function assertPasswordPolicy(password: string) {
  const issues = passwordPolicyIssues(password);
  if (issues.length) throw new Error(`A senha precisa ter ${issues.join(", ")}.`);
}

export function passwordExpired(changedAt: string | null | undefined, now = new Date()) {
  if (!changedAt) return true;
  const changed = new Date(changedAt).getTime();
  if (!Number.isFinite(changed)) return true;
  return now.getTime() - changed >= PASSWORD_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}
