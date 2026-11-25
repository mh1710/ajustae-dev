import { describe, expect, it } from "vitest";
import { isOffersListPath, offersStillBlocked, ML_OFFERS_RETRY_MS } from "./ml-prospect-block";

describe("bloqueio da lista de ofertas do ML", () => {
  it("reconhece só a lista de ofertas do catálogo", () => {
    expect(isOffersListPath("/products/MLB39960346/items")).toBe(true);
    expect(isOffersListPath("/products/MLB39960346")).toBe(false);
    expect(isOffersListPath("/items/MLB2777345363")).toBe(false);
  });

  it("pausa por 10 minutos e libera depois", () => {
    const now = Date.parse("2026-11-23T18:20:00Z");
    const params = { ml_offers_blocked_until: new Date(now + ML_OFFERS_RETRY_MS).toISOString() };
    expect(ML_OFFERS_RETRY_MS).toBe(600_000);
    expect(offersStillBlocked(params, now + 9 * 60_000)).toBe(true);
    expect(offersStillBlocked(params, now + 10 * 60_000 + 1)).toBe(false);
    expect(offersStillBlocked({}, now)).toBe(false);
  });
});
