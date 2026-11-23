import { expect, it } from "vitest";
import { prospectDeliveryDays, prospectShippingFailureReason } from "./ml-prospect-shipping";

const now = new Date("2026-11-11T21:24:00Z"); // quarta, 18:24 em Maringá

it("conta dias corridos no fuso de Maringá", () => {
  expect(prospectDeliveryDays("2026-11-13T00:00:00-03:00", now)).toBe(2);
  expect(prospectDeliveryDays("2026-11-15T00:00:00-03:00", now)).toBe(4);
  expect(prospectDeliveryDays(null, now)).toBeNull();
});

it("informa o prazo mais rápido quando passa do limite", () => {
  expect(prospectShippingFailureReason("deadline", 2, 1000, { cheapestOverCost: false, matchedOverCost: false, fastestDays: 4 }))
    .toBe("entrega mais rápida para o CEP em 4 dias (limite 2 dias)");
});

it("separa custo acima do máximo do prazo", () => {
  expect(prospectShippingFailureReason("deadline", 2, 1000, { cheapestOverCost: true, matchedOverCost: false, fastestDays: 1 }))
    .toBe("oferta mais barata acima do custo máximo (R$ 1000)");
  expect(prospectShippingFailureReason("deadline", 2, 1000, { cheapestOverCost: false, matchedOverCost: true, fastestDays: 2 }))
    .toBe("entrega em até 2 dias só acima do custo máximo (R$ 1000)");
});
