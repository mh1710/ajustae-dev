import { afterEach, expect, it, vi } from "vitest";
import { evaluateCandidate } from "./ml-prospect.server";
import { prospectRequiredIssues } from "./ml-prospect-approval";
import { prospectDeliveryMatches } from "./ml-prospect-shipping";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const params = { categories: [], keywords: [], max_cost: 200, max_weight_kg: 30, max_length_cm: 70, zip_code: "87020000", shipping_mode: "deadline" as const, max_delivery_days: 3 };

function mockDelivery(date: string | null, latest?: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T20:13:00Z"));
  const fetcher = vi.fn(async (input: string) => {
    const path = new URL(input).pathname;
    const data = path.endsWith("/shipping_options") ? { options: [{ cost: 10, estimated_delivery_time: { date }, estimated_delivery_limit: { date: latest } }] }
      : path.endsWith("/items") ? { results: [{ id: "MLB1", price: 100, available_quantity: 5, shipping: { logistic_type: "cross_docking" } }] }
      : { name: "Mouse", pictures: [1, 2, 3].map(i => ({ url: `https://example.com/${i}.jpg` })), attributes: [{ id: "GTIN", value_name: "7891234567890" }] };
    return new Response(JSON.stringify(data));
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

it("consulta o CEP de Maringá e aprova chegada em três dias sem exigir Full", async () => {
  const fetcher = mockDelivery("2026-11-14T21:00:00-03:00");
  const result = await evaluateCandidate("test", "MLB123", params);
  expect(result.ok).toBe(true);
  expect(fetcher.mock.calls.some(([url]) => url.includes("shipping_options?zip_code=87020000"))).toBe(true);
  if (!result.ok) throw new Error("Oferta deveria passar");
  expect(result.row.raw.zip_code).toBe("87020000");
  expect(result.row.raw.max_delivery_days).toBe(3);
  expect(prospectRequiredIssues(result.row).filter(x => x.rule === "oferta-ml")).toEqual([]);
});

it("rejeita entrega no quarto dia para o máximo de três dias", async () => {
  mockDelivery("2026-11-15T00:00:00-03:00");
  expect((await evaluateCandidate("test", "MLB123", params)).ok).toBe(false);
});

it("prazo ausente não comprova chegada em três dias", async () => {
  mockDelivery(null);
  expect((await evaluateCandidate("test", "MLB123", params)).ok).toBe(false);
});

it("usa o final da janela de entrega para bloquear uma estimativa acima de três dias", async () => {
  mockDelivery("2026-11-13T12:00:00-03:00", "2026-11-15T12:00:00-03:00");
  expect((await evaluateCandidate("test", "MLB123", params)).ok).toBe(false);
});

it("revisão bloqueia uma oferta acima do prazo escolhido", () => {
  mockDelivery(null);
  expect(prospectRequiredIssues({ available_quantity: 5, delivery_date: "2026-11-15T00:00:00-03:00", raw: { shipping_mode: "deadline", max_delivery_days: 3 } }).some(x => x.rule === "oferta-ml")).toBe(true);
});

it("três dias corridos incluem o final do terceiro dia no horário de Maringá", () => {
  const now = new Date("2026-11-11T20:13:00Z");
  expect(prospectDeliveryMatches("2026-11-14T23:59:59-03:00", 3, now)).toBe(true);
  expect(prospectDeliveryMatches("2026-11-15T00:00:00-03:00", 3, now)).toBe(false);
});

it("alterar o prazo de três para dois dias muda a aprovação", async () => {
  mockDelivery("2026-11-14T12:00:00-03:00");
  expect((await evaluateCandidate("test", "MLB123", { ...params, max_delivery_days: 2 })).ok).toBe(false);
});

it.each(["2026-11-12T23:59:59-03:00", "2026-11-13T23:59:59-03:00"])("amanhã ou dois dias aceita %s na busca e revisão", async date => {
  mockDelivery(date);
  const result = await evaluateCandidate("test", "MLB123", { ...params, max_delivery_days: 2 });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Entrega em até dois dias deveria passar");
  expect(result.row.raw.max_delivery_days).toBe(2);
  expect(prospectRequiredIssues(result.row).filter(x => x.rule === "oferta-ml")).toEqual([]);
});

it("amanhã ou dois dias rejeita janela terminando no terceiro dia", async () => {
  mockDelivery("2026-11-12T12:00:00-03:00", "2026-11-14T00:00:00-03:00");
  expect((await evaluateCandidate("test", "MLB123", { ...params, max_delivery_days: 2 })).ok).toBe(false);
  expect(prospectRequiredIssues({ available_quantity: 5, delivery_date: "2026-11-14T00:00:00-03:00", raw: { shipping_mode: "deadline", max_delivery_days: 2 } }).some(x => x.rule === "oferta-ml")).toBe(true);
});

it("amanhã ou dois dias rejeita oferta sem estimativa", async () => {
  mockDelivery(null);
  expect((await evaluateCandidate("test", "MLB123", { ...params, max_delivery_days: 2 })).ok).toBe(false);
});