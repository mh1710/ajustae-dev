/**
 * Toda chamada à API do Mercado Livre passa por aqui: reserva um horário na cota única
 * da aplicação (take_ml_app_slot, compartilhado entre empresas, tarefas e Workers),
 * pausa a aplicação inteira quando o ML responde 429 e tenta de novo com backoff e jitter.
 */
import { isMlRetryableStatus, mlRetryDelayMs, mlSlotSpacingMs } from "./ml-rate-limit";
import { explainMl403, parseMl403 } from "./ml-403";

/** Erro legível de uma resposta recusada; no 403 lê o corpo e diz o motivo (guia "Erro 403" do ML). */
export async function mlHttpError(res: Response, label: string): Promise<Error> {
  if (res.status !== 403) {
    await res.body?.cancel().catch(() => undefined);
    return new Error(`${label} (HTTP ${res.status}).`);
  }
  const path = (() => { try { return new URL(res.url).pathname; } catch { return ""; } })();
  const detail = parseMl403(path, await res.json().catch(() => null), res.headers);
  return new Error(`${label} (HTTP 403${detail.code ? ` ${detail.code}` : ""}). Motivo: ${explainMl403(detail).text}`);
}

/** Limite do ML ou indisponibilidade passageira: não é defeito do produto, tente mais tarde. */
export class MlTransientError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "MlTransientError";
  }
}

export type MlFetchOptions = {
  token?: string | null;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Espera máxima por uma vaga na cota antes de desistir desta consulta. */
  maxWaitMs?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SPACING_MS = mlSlotSpacingMs();

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

async function rpc(): Promise<Rpc> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return (supabaseAdmin.rpc as unknown as Rpc).bind(supabaseAdmin);
}

// Testes unitários simulam o fetch e não têm a cota compartilhada do banco para arbitrar.
const hasDatabase = () => !!process.env["SUPABASE_URL"] && !process.env["VITEST"];

async function takeSlot(maxWaitMs: number) {
  if (!hasDatabase()) return;
  const call = await rpc();
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const left = Math.max(0, deadline - Date.now());
    const { data, error } = await call("take_ml_app_slot", { _spacing_ms: SPACING_MS, _max_wait_ms: left });
    if (error) {
      // Banco indisponível: segue no ritmo local para não parar o Mercado Livre por isso.
      await sleep(SPACING_MS);
      return;
    }
    const wait = Number(data);
    if (Number.isFinite(wait) && wait >= 0) {
      if (wait > 0) await sleep(wait);
      return;
    }
    if (Date.now() >= deadline) {
      throw new MlTransientError("Limite de consultas do Mercado Livre em uso no momento; tente novamente em instantes.", 429);
    }
    await sleep(Math.min(1_000, Math.max(50, deadline - Date.now())));
  }
}

async function pauseApp(ms: number) {
  if (!hasDatabase()) return;
  try {
    const call = await rpc();
    await call("pause_ml_app", { _ms: ms });
  } catch {
    /* a espera local abaixo continua valendo */
  }
}

export async function mlFetch(url: string, options: MlFetchOptions = {}): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  const maxWaitMs = options.maxWaitMs ?? 20_000;
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;

  for (let attempt = 0; ; attempt++) {
    await takeSlot(maxWaitMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: options.method ?? "GET",
        headers,
        ...(options.body !== undefined ? { body: options.body } : {}),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
    } catch (e) {
      if (attempt >= maxRetries) {
        throw new MlTransientError(`Mercado Livre não respondeu (${e instanceof Error ? e.message : String(e)}); tente novamente.`);
      }
      await sleep(mlRetryDelayMs(500, attempt, null));
      continue;
    }
    if (!isMlRetryableStatus(res.status)) return res;

    const wait = mlRetryDelayMs(res.status, attempt, res.headers.get("retry-after"));
    // 429 vale para a aplicação inteira: todas as tarefas esperam juntas.
    if (res.status === 429) await pauseApp(wait);
    await res.body?.cancel().catch(() => undefined);
    if (attempt >= maxRetries) {
      throw new MlTransientError(
        res.status === 429
          ? "Mercado Livre está limitando as consultas agora (429). Tente novamente em alguns minutos."
          : `Mercado Livre indisponível (${res.status}); tente novamente.`,
        res.status,
      );
    }
    await sleep(wait);
  }
}
