import { test } from "node:test";
import { strictEqual } from "node:assert";
import { joinImages } from "./supplier-images";

test("guarda todas as fotos do fornecedor, não só a primeira", () => {
  strictEqual(joinImages(["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg"]), "https://a/1.jpg|https://a/2.jpg|https://a/3.jpg");
});
test("remove fotos repetidas e vazias", () => {
  strictEqual(joinImages(["https://a/1.jpg", "", "https://a/1.jpg", "https://a/2.jpg"]), "https://a/1.jpg|https://a/2.jpg");
  strictEqual(joinImages([]), null);
});
