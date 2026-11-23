import { test } from "node:test";
import { strictEqual, deepStrictEqual } from "node:assert";
import { isCorrectImageDonor, correctDonorImages } from "./cross-company-images";

const donor = { situacao: "A", bling_product_id: 123, last_audit_at: "2026-10-28", last_audit_errors: 0, last_audit_warnings: 0 };
test("fotos de outra empresa exigem produto ativo, vinculado e auditado sem problemas", () => {
  strictEqual(isCorrectImageDonor(donor), true);
  for (const change of [{ situacao: "I" }, { bling_product_id: null }, { last_audit_at: null }, { last_audit_errors: 1 }, { last_audit_warnings: 1 }]) {
    strictEqual(isCorrectImageDonor({ ...donor, ...change }), false);
  }
});
test("exige ao menos três fotos válidas e recusa foto inacessível mesmo com três boas", () => {
  const urls = ["https://photos.test/1.jpg", "https://photos.test/2.jpg", "https://photos.test/3.jpg"];
  deepStrictEqual(correctDonorImages(urls, urls), urls);
  strictEqual(correctDonorImages(urls.slice(0, 2), urls), null);
  strictEqual(correctDonorImages([...urls, "https://photos.test/broken.jpg"], urls), null);
});