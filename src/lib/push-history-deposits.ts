export type DepositLogEntry = {
  deposito_id: string;
  descricao: string | null;
  anterior: number | null;
  valor: number;
  ok: boolean;
  status: number | null;
  ms: number | null;
  at: string;
};

type HistoryRow = {
  id: string;
  tipo: string;
  status: string;
  valor_anterior: unknown;
  valor_novo: unknown;
  last_response_status: number | null;
  duration_ms: number | null;
  processed_at: string | null;
  depositos_log?: DepositLogEntry[] | null;
  [key: string]: unknown;
};

/**
 * Estoque por depósito: cada chamada ao Bling vira uma linha nos Logs,
 * com o nome do estoque atualizado. Demais itens seguem com uma linha.
 */
export function expandDepositHistory<T extends HistoryRow>(rows: T[]): (T & { deposito: string | null })[] {
  return rows.flatMap((r): (T & { deposito: string | null })[] => {
    const log = Array.isArray(r.depositos_log) ? r.depositos_log : [];
    if (r.tipo !== "estoque" || log.length === 0) return [{ ...r, deposito: null as string | null }];
    return log.map((d, i): T & { deposito: string | null } => ({
      ...r,
      id: `${r.id}-${i}`,
      deposito: d.descricao || d.deposito_id,
      status: d.ok ? "concluido" : "erro",
      last_response_status: d.ok ? null : d.status,
      valor_anterior: d.anterior,
      valor_novo: d.valor,
      duration_ms: d.ms,
      processed_at: d.at,
    }));
  });
}
