/**
 * Limite oficial da API do Mercado Livre (consultado em GET /applications/{id}:
 * max_requests_per_hour = 18.000), aplicado por aplicação (Client ID) e compartilhado
 * por todas as empresas, tarefas e Workers. Módulo puro para ser testado.
 */

export const ML_APP_HOURLY_LIMIT = 18_000;
/** Usamos 80% da cota para deixar folga a picos, chamadas de login e limites por endpoint. */
export const ML_APP_SAFE_SHARE = 0.8;
export const ML_MAX_RETRY_WAIT_MS = 30_000;

/** Intervalo mínimo entre duas consultas da aplicação (250 ms = 4 por segundo = 14.400 por hora). */
export function mlSlotSpacingMs(hourlyLimit = ML_APP_HOURLY_LIMIT, share = ML_APP_SAFE_SHARE): number {
  const perHour = Math.floor(hourlyLimit * share);
  if (!Number.isFinite(perHour) || perHour <= 0) throw new Error("Limite do Mercado Livre inválido.");
  return Math.ceil(3_600_000 / perHour);
}

/** 429 e erros 5xx são passageiros: esperam e tentam de novo. */
export function isMlRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Espera antes da próxima tentativa: respeita Retry-After (segundos) quando o ML informa;
 * senão, backoff exponencial com jitter (429: 2 s, 4 s, 8 s…; 5xx: 0,5 s, 1 s, 2 s…).
 */
export function mlRetryDelayMs(
  status: number,
  attempt: number,
  retryAfter: string | null,
  random: () => number = Math.random,
): number {
  const seconds = Number(retryAfter);
  if (retryAfter !== null && retryAfter.trim() !== "" && Number.isFinite(seconds) && seconds > 0) {
    return Math.min(Math.ceil(seconds * 1000), ML_MAX_RETRY_WAIT_MS);
  }
  const base = (status === 429 ? 2_000 : 500) * 2 ** Math.max(0, attempt);
  return Math.min(Math.round(base + random() * base * 0.5), ML_MAX_RETRY_WAIT_MS);
}
