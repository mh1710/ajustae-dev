export type ProspectShippingMode = "full" | "tomorrow" | "deadline" | "full_tomorrow";

/** Calendar days in Brasília, including the whole selected arrival day. */
export function prospectDeliveryLimit(days: number, now = new Date()): number {
  const local = new Date(now.getTime() - 3 * 3600_000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days, 23, 59, 59, 999) + 3 * 3600_000;
}

/** Prefer the latest published estimate, never the beginning of a delivery window. */
export function prospectDeliveryDate(option: Record<string, any>): string | null {
  const values = [option.estimated_delivery_time?.date, option.estimated_delivery_time?.time_frame?.to,
    option.estimated_delivery_limit?.date, option.estimated_delivery_final?.date]
    .filter((v): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)));
  return values.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

export function prospectDeliveryMatches(date: unknown, days: unknown, now = new Date()): boolean {
  const count = Number(days);
  const time = typeof date === "string" ? Date.parse(date) : NaN;
  return Number.isInteger(count) && count >= 1 && count <= 30 && Number.isFinite(time)
    && time >= now.getTime() && time <= prospectDeliveryLimit(count, now);
}

/** Old jobs retain both restrictions; new searches explicitly choose one. */
export function prospectShippingMatches(mode: ProspectShippingMode | undefined, isFull: boolean, arrivesTomorrow: boolean, arrivesWithinDeadline = false): boolean {
  if (mode === "full") return isFull;
  if (mode === "tomorrow") return arrivesTomorrow;
  if (mode === "deadline") return arrivesWithinDeadline;
  return isFull && arrivesTomorrow;
}
/** Calendar days in Brasília from today until the estimated arrival date. */
export function prospectDeliveryDays(date: unknown, now = new Date()): number | null {
  const time = typeof date === "string" ? Date.parse(date) : NaN;
  if (!Number.isFinite(time)) return null;
  const day = (t: number) => { const l = new Date(t - 3 * 3600_000); return Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()); };
  return Math.round((day(time) - day(now.getTime())) / 86_400_000);
}

export type ProspectShippingFailure = { cheapestOverCost: boolean; matchedOverCost: boolean; fastestDays: number | null };

/** Separates cost and delivery reasons so the search status explains what actually blocked the offer. */
export function prospectShippingFailureReason(mode: ProspectShippingMode | undefined, maxDays: number | undefined, maxCost: number, f: ProspectShippingFailure): string {
  if (f.cheapestOverCost) return `oferta mais barata acima do custo máximo (R$ ${maxCost})`;
  if (mode === "deadline") {
    if (f.matchedOverCost) return `entrega em até ${maxDays} dias só acima do custo máximo (R$ ${maxCost})`;
    if (f.fastestDays !== null) return `entrega mais rápida para o CEP em ${f.fastestDays} dias (limite ${maxDays} dias)`;
    return "sem estimativa de entrega para o CEP dentro do custo";
  }
  if (mode === "full") return f.matchedOverCost ? `frete Full só acima do custo máximo (R$ ${maxCost})` : "frete Full indisponível";
  if (f.matchedOverCost) return `chega amanhã só acima do custo máximo (R$ ${maxCost})`;
  return f.fastestDays !== null ? `não chega amanhã (entrega mais rápida em ${f.fastestDays} dias)` : "não chega amanhã";
}
