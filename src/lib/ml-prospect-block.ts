/**
 * Bloqueio da lista de ofertas do Mercado Livre (/products/{id}/items → 403 PolicyAgent).
 * Quando acontece, o garimpo pausa em vez de descartar candidatos e tenta de novo depois.
 * Módulo puro (sem servidor) para ser testado.
 */

export const ML_OFFERS_RETRY_MS = 10 * 60_000;

/** Caminho da lista de ofertas de um produto de catálogo. */
export function isOffersListPath(path: string): boolean {
  return /^\/products\/[A-Z]{3}\d+\/items\/?$/.test(path);
}

/** Momento (ms) até o qual a busca fica pausada; null quando não há pausa válida. */
export function offersBlockedUntil(params: unknown): number | null {
  const raw = (params as { ml_offers_blocked_until?: unknown } | null)?.ml_offers_blocked_until;
  if (typeof raw !== "string") return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

/** true quando a pausa ainda vale e o ciclo deve esperar. */
export function offersStillBlocked(params: unknown, now: number): boolean {
  const until = offersBlockedUntil(params);
  return until !== null && until > now;
}

export function offersBlockedMessage(retryAt: Date, reason?: string | null): string {
  const hhmm = retryAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const why = reason ? ` Motivo: ${reason}` : "";
  return `O Mercado Livre bloqueou a consulta de ofertas (403).${why} A busca está pausada, nenhum produto foi descartado por isso e ela tenta de novo sozinha às ${hhmm}.`;
}
