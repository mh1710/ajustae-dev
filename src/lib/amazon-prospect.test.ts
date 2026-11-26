import { describe, expect, it } from "vitest";
import { advanceAmazonDiscovery, amazonInitialDiscovery, amazonItemEan, amazonSku, pickPrimeOffer, prospectSku, AMAZON_DEPARTMENTS } from "./amazon-prospect";

const offer = (price: number, extra: Record<string, unknown> = {}) => ({
  IsFulfilledByAmazon: true, PrimeInformation: { IsPrime: true }, SubCondition: "new",
  ListingPrice: { Amount: price }, Shipping: { Amount: 0 }, SellerId: `S${price}`,
  ShippingTime: { availabilityType: "NOW" }, ...extra,
});

describe("Amazon garimpo", () => {
  it("uses only Prime offers fulfilled by Amazon, cheapest first", () => {
    const best = pickPrimeOffer({ Offers: [
      offer(90, { IsFulfilledByAmazon: false }),
      offer(95, { PrimeInformation: { IsPrime: false } }),
      offer(120), offer(105.89),
    ] });
    expect(best).toMatchObject({ price: 105.89, total: 105.89, prime_offers: 2 });
  });

  it("returns null when there is no Prime offer", () => {
    expect(pickPrimeOffer({ Offers: [offer(50, { IsFulfilledByAmazon: false })] })).toBeNull();
  });

  it("adds shipping to the cost", () => {
    expect(pickPrimeOffer({ Offers: [offer(100, { Shipping: { Amount: 9.9 } })] })?.total).toBe(109.9);
  });

  it("SKU is AMZ + EAN", () => {
    expect(amazonSku("7891040091027")).toBe("AMZ7891040091027");
    expect(prospectSku({ raw: { source: "amazon" }, ean: "7891040091027" })).toBe("AMZ7891040091027");
    expect(prospectSku({ raw: {}, catalog_product_id: "MLB123" })).toBe("ML123");
  });

  it("takes only a check-digit-valid EAN", () => {
    const item = (e: string) => ({ identifiers: [{ identifiers: [{ identifierType: "EAN", identifier: e }] }] });
    expect(amazonItemEan(item("7891040091027"))).toBe("7891040091027");
    expect(amazonItemEan(item("7891040091028"))).toBeNull();
  });

  it("department-only searches use seed keywords in every chosen department", () => {
    const d = amazonInitialDiscovery([], [AMAZON_DEPARTMENTS[0]!.id]);
    expect(d.queue.every(q => q.classificationId === AMAZON_DEPARTMENTS[0]!.id)).toBe(true);
    expect(amazonInitialDiscovery(["furadeira"], []).queue).toEqual([{ keyword: "furadeira", classificationId: null, label: "furadeira" }]);
  });

  it("moves to the next search after the last page", () => {
    const d = amazonInitialDiscovery(["a", "b"], []);
    expect(advanceAmazonDiscovery(d, "tok").pageToken).toBe("tok");
    expect(advanceAmazonDiscovery(d, null).queue.map(q => q.keyword)).toEqual(["b"]);
  });
});
