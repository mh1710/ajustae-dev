import { describe, expect, it } from "vitest";
import { pickAmazonProduct, toCm, toKg } from "./amazon-catalog";
import { fillFromAmazon, measureLimitIssue, prospectLimits } from "./ml-prospect-prepare";

const BR = "A2Q3Y263D00KWC";
const item = (asin: string, ean: string, extra: Record<string, unknown> = {}) => ({
  asin,
  identifiers: [{ marketplaceId: BR, identifiers: [{ identifierType: "EAN", identifier: ean }] }],
  summaries: [{ marketplaceId: BR, brand: "3M", itemName: "Bloco" }],
  images: [{ marketplaceId: BR, images: [
    { variant: "PT01", link: "https://m.media-amazon.com/images/I/b.jpg", width: 500, height: 500 },
    { variant: "MAIN", link: "https://m.media-amazon.com/images/I/a-small.jpg", width: 75, height: 75 },
    { variant: "MAIN", link: "https://m.media-amazon.com/images/I/a.jpg", width: 1500, height: 1500 },
  ] }],
  attributes: {
    item_package_dimensions: [{ length: { unit: "centimeters", value: 10 }, width: { unit: "millimeters", value: 76 }, height: { unit: "inches", value: 1 }, marketplace_id: BR }],
    item_package_weight: [{ unit: "grams", value: 600, marketplace_id: BR }],
    ncm_code: [{ value: "4820.10.00", marketplace_id: BR }],
    ...extra,
  },
});

describe("Amazon catalog by EAN", () => {
  it("uses only items with the exact same EAN", () => {
    expect(pickAmazonProduct("7891040091027", [item("X", "7891040091028")])).toBeNull();
    expect(pickAmazonProduct("7891040091027", [item("X", "07891040091027")])?.asin).toBe("X");
  });

  it("converts package measures to kg/cm, NCM digits and MAIN photo first at largest size", () => {
    const p = pickAmazonProduct("7891040091027", [item("X", "7891040091027")])!;
    expect(p.measures).toEqual({ length_cm: 10, width_cm: 7.6, height_cm: 2.54, weight_kg: 0.6, kind: "embalagem" });
    expect(p.ncm).toBe("48201000");
    expect(p.pictures).toEqual(["https://m.media-amazon.com/images/I/a.jpg", "https://m.media-amazon.com/images/I/b.jpg"]);
  });

  it("ignores measures of multi-unit packs", () => {
    const p = pickAmazonProduct("7891040091027", [item("X", "7891040091027", { item_package_quantity: [{ value: 6, marketplace_id: BR }] })])!;
    expect(p.measures.weight_kg).toBeNull();
    expect(p.measures.length_cm).toBeNull();
  });

  it("unit conversions", () => {
    expect(toKg({ unit: "pounds", value: 1 })).toBe(0.454);
    expect(toCm({ unit: "meters", value: 0.5 })).toBe(50);
    expect(toKg({ unit: "kilograms", value: 0 })).toBeNull();
  });
});

describe("Garimpo fill and limits", () => {
  const amazon = { measures: { weight_kg: 2, length_cm: 10, width_cm: 20, height_cm: 30 } };
  it("keeps ML values and fills only empty ones; box sides come together", () => {
    expect(fillFromAmazon({ weight_kg: 1, length_cm: null, width_cm: null, height_cm: null }, amazon).measures)
      .toEqual({ weight_kg: 1, length_cm: 10, width_cm: 20, height_cm: 30 });
    expect(fillFromAmazon({ weight_kg: null, length_cm: 5, width_cm: null, height_cm: null }, amazon).measures)
      .toEqual({ weight_kg: 2, length_cm: 5, width_cm: null, height_cm: null });
  });

  it("caps any job limit at 30 kg and 70 cm", () => {
    expect(prospectLimits({ max_weight_kg: 50, max_length_cm: 120 })).toEqual({ maxWeightKg: 30, maxLengthCm: 70 });
    expect(prospectLimits({})).toEqual({ maxWeightKg: 30, maxLengthCm: 70 });
    const l = prospectLimits({ max_weight_kg: 50, max_length_cm: 120 });
    expect(measureLimitIssue({ weight_kg: 31, length_cm: 10, width_cm: 10, height_cm: 10 }, l.maxWeightKg, l.maxLengthCm)).toMatch(/Peso/);
    expect(measureLimitIssue({ weight_kg: 5, length_cm: 71, width_cm: 10, height_cm: 10 }, l.maxWeightKg, l.maxLengthCm)).toMatch(/medida/);
    expect(measureLimitIssue({ weight_kg: 5, length_cm: 60, width_cm: 10, height_cm: 10 }, l.maxWeightKg, l.maxLengthCm)).toBeNull();
  });
});
