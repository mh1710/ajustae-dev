import { describe, it } from "node:test";
import { strictEqual } from "node:assert";
import { classifySupplier } from "./supplier-freshness";

const now = new Date("2026-11-02T15:16:00Z").getTime();
const h = (n: number) => new Date(now - n * 3600_000).toISOString();

describe("classifySupplier", () => {
  it("download do Oderço falhou mas a base completa tem 6 h: segue com a base anterior", () => {
    strictEqual(classifySupplier({ codigo: "oderco", product_count: 2912, last_sync_at: h(0), last_sync_status: "erro", last_ok_sync_at: h(6) }, now), "usable");
  });
  it("base completa com mais de 12 h: para a automação", () => {
    strictEqual(classifySupplier({ codigo: "oderco", product_count: 2912, last_sync_at: h(0), last_sync_status: "erro", last_ok_sync_at: h(13) }, now), "missing");
  });
  it("base vazia nunca é usada", () => {
    strictEqual(classifySupplier({ codigo: "oderco", product_count: 0, last_sync_at: h(0), last_sync_status: "erro", last_ok_sync_at: h(1) }, now), "missing");
  });
  it("ok há 10 min é atualizada; ok há 1 h vira base anterior utilizável", () => {
    strictEqual(classifySupplier({ codigo: "hayamax", product_count: 7000, last_sync_at: new Date(now - 600_000).toISOString(), last_sync_status: "ok" }, now), "fresh");
    strictEqual(classifySupplier({ codigo: "hayamax", product_count: 7000, last_sync_at: h(1), last_sync_status: "ok", last_ok_sync_at: h(1) }, now), "usable");
  });
  it("Evolusom com erro na API usa a última leitura completa recente", () => {
    strictEqual(classifySupplier({ codigo: "evolusom", product_count: 7448, last_sync_at: h(0), last_sync_status: "erro", last_ok_sync_at: h(3) }, now), "usable");
  });
});
