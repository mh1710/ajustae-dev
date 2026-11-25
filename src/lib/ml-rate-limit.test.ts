import { describe, expect, it } from "vitest";
import { isMlRetryableStatus, mlRetryDelayMs, mlSlotSpacingMs, ML_APP_HOURLY_LIMIT } from "./ml-rate-limit";

describe("limite da API do Mercado Livre", () => {
  it("usa a cota oficial de 18.000 por hora", () => {
    expect(ML_APP_HOURLY_LIMIT).toBe(18_000);
  });

  it("espaça as consultas em 250 ms, no máximo 14.400 por hora", () => {
    expect(mlSlotSpacingMs()).toBe(250);
    expect(Math.floor(3_600_000 / mlSlotSpacingMs())).toBeLessThanOrEqual(18_000);
  });

  it("tenta de novo só em 429 e 5xx", () => {
    expect(isMlRetryableStatus(429)).toBe(true);
    expect(isMlRetryableStatus(503)).toBe(true);
    expect(isMlRetryableStatus(403)).toBe(false);
    expect(isMlRetryableStatus(404)).toBe(false);
  });

  it("respeita o Retry-After informado pelo Mercado Livre", () => {
    expect(mlRetryDelayMs(429, 0, "7", () => 0)).toBe(7_000);
    expect(mlRetryDelayMs(429, 0, "600", () => 0)).toBe(30_000);
  });

  it("dobra a espera a cada 429 seguido", () => {
    expect(mlRetryDelayMs(429, 0, null, () => 0)).toBe(2_000);
    expect(mlRetryDelayMs(429, 1, null, () => 0)).toBe(4_000);
    expect(mlRetryDelayMs(429, 2, null, () => 0)).toBe(8_000);
    expect(mlRetryDelayMs(500, 0, null, () => 0)).toBe(500);
  });
});
