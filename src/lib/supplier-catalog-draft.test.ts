import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { draftIssues, draftProduct, eligibilityReason, supplierCost, type SupplierDraft } from "./supplier-catalog-draft";

const m = (peso: number | null, maior: number | null) => ({ peso, altura: 5, largura: 5, comprimento: maior });

test("custo precisa ser maior que R$ 10 e menor que R$ 1000", () => {
  ok(eligibilityReason(10, m(1, 10)));
  strictEqual(eligibilityReason(10.01, m(1, 10)), null);
  strictEqual(eligibilityReason(999.99, m(1, 10)), null);
  ok(eligibilityReason(1000, m(1, 10)));
  ok(eligibilityReason(null, m(1, 10)));
});

test("peso precisa ser menor que 30 kg", () => {
  strictEqual(eligibilityReason(50, m(29.99, 10)), null);
  ok(eligibilityReason(50, m(30, 10)));
});

test("maior medida pode ter no máximo 70 cm", () => {
  strictEqual(eligibilityReason(50, m(1, 70)), null);
  ok(eligibilityReason(50, m(1, 70.1)));
});

test("medidas desconhecidas não reprovam na lista (são completadas depois)", () => {
  strictEqual(eligibilityReason(50, { peso: null, altura: null, largura: null, comprimento: null }), null);
});

test("custo usa PR, depois base, ignorando zero", () => {
  strictEqual(supplierCost({ PR: 0, base: 13.78 }), 13.78);
  strictEqual(supplierCost({ PR: 5.41, base: 4.9 }), 5.41);
  strictEqual(supplierCost({}), null);
});

const full: SupplierDraft = {
  sku: "E1", nome: "Produto", marca: "X", ncm: "8536.70.00", gtin: "7898535508060",
  peso: 1, altura: 2, largura: 3, profundidade: 4,
  fotos: ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg"], corpo: "a".repeat(150), anatel: "Não se aplica", origem_fiscal: "0",
};

test("produto completo não tem pendências", () => {
  deepStrictEqual(draftIssues(full), []);
});

test("menos de 3 fotos, sem NCM ou sem peso deixam pendência", () => {
  const issues = draftIssues({ ...full, fotos: full.fotos.slice(0, 2), ncm: null, peso: null });
  ok(issues.includes("NCM"));
  ok(issues.includes("peso"));
  ok(issues.some(i => i.startsWith("3 fotos")));
});

test("descrição recebe o rodapé padrão com garantia de 3 meses", () => {
  ok(draftProduct(full).descricao_curta.endsWith("Garantia: 3 meses | Código Anatel: Não se aplica | Anvisa: Isento"));
});
