import { test } from "node:test";
import { strictEqual } from "node:assert";
import { expandDepositHistory } from "./push-history-deposits";

const base = {
  id: "q1", tipo: "estoque", status: "concluido", valor_anterior: 3, valor_novo: 5,
  last_response_status: null, duration_ms: 900, processed_at: "2026-11-01T19:50:00Z",
};

test("estoque por depósito vira uma linha por chamada com o nome do estoque", () => {
  const rows = expandDepositHistory([{
    ...base,
    depositos_log: [
      { deposito_id: "1", descricao: "Kabum", anterior: 4, valor: 0, ok: true, status: 200, ms: 300, at: "2026-11-01T19:49:58Z" },
      { deposito_id: "2", descricao: "Magalu", anterior: 2, valor: 5, ok: false, status: 429, ms: 200, at: "2026-11-01T19:49:59Z" },
    ],
  }]);
  strictEqual(rows.length, 2);
  strictEqual(rows[0].deposito, "Kabum");
  strictEqual(rows[0].valor_novo, 0);
  strictEqual(rows[1].deposito, "Magalu");
  strictEqual(rows[1].status, "erro");
  strictEqual(rows[1].last_response_status, 429);
});

test("itens sem chamadas por depósito continuam com uma linha", () => {
  const rows = expandDepositHistory([{ ...base, tipo: "preco", depositos_log: null }]);
  strictEqual(rows.length, 1);
  strictEqual(rows[0].deposito, null);
});
