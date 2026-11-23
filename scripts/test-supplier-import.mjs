import assert from "node:assert/strict";
import { createRequire } from "node:module";
import process from "node:process";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const filePath = process.argv[2];
const supplierCode = process.argv[3] ?? "evolusom";

if (!filePath) {
  console.error(
    'Uso: npm run test:supplier-import -- "C:\\caminho\\planilha.xlsx" [codigo-fornecedor]',
  );
  process.exit(1);
}

const vite = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const importer = await vite.ssrLoadModule("/src/lib/supplier-import-mapping.ts");
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  assert(firstSheet, "A planilha precisa ter ao menos uma aba legível.");

  const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: true });
  assert(rows.length > 0, "A planilha não possui linhas de dados.");
  const headers = Array.from(
    new Set(rows.slice(0, 50).flatMap((row) => Object.keys(row).filter(Boolean))),
  );
  const detection = importer.detectSupplierSheet(headers, supplierCode, rows);
  const mapping = importer.suggestSupplierMapping(headers, supplierCode);

  let defaultId = 0;
  const valueMappings =
    detection.kind === "evolusom"
      ? importer.createEvolusomDefaultValueMappings(() => `default-${++defaultId}`)
      : [];
  const rules =
    detection.kind === "evolusom"
      ? importer.createEvolusomDefaultRules(() => `default-${++defaultId}`)
      : [];

  const mapped = rows.map((row, index) =>
    importer.mapSupplierRow(row, mapping, index + 2, valueMappings, rules),
  );
  const compoundRule = {
    id: "filter-kg-price",
    name: "Peso em KG e preço acima de 100",
    enabled: true,
    conditionField: "unidade_medida",
    operator: "equals",
    conditionValue: "KG",
    conditionLogic: "and",
    conditions: [
      {
        id: "condition-kg",
        field: "unidade_medida",
        operator: "equals",
        value: "KG",
      },
      {
        id: "condition-price",
        field: "preco_custo",
        operator: "greater_than",
        value: "100",
      },
    ],
    targetField: "codigo",
    action: "ignore",
    actionValue: "",
  };
  const compoundMapped = rows.map((row, index) =>
    importer.mapSupplierRow(row, mapping, index + 2, [], [compoundRule]),
  );
  let eligibilityId = 0;
  const eligibilityRules = importer.createEligibilityFilterRules(
    () => `eligibility-${++eligibilityId}`,
  );
  const eligibilityMapped = rows.map((row, index) =>
    importer.mapSupplierRow(row, mapping, index + 2, [], eligibilityRules),
  );
  const orRule = {
    ...compoundRule,
    id: "filter-or",
    conditionLogic: "or",
    conditions: [
      { id: "condition-unit", field: "unidade_medida", operator: "equals", value: "KG" },
      {
        id: "condition-price-or",
        field: "preco_custo",
        operator: "greater_than",
        value: "100",
      },
    ],
  };
  const syntheticRows = [
    { sku: "A", unit: "KG", price: "50" },
    { sku: "B", unit: "G", price: "150" },
    { sku: "C", unit: "G", price: "50" },
  ];
  const syntheticOrFiltered = syntheticRows.filter(
    (row, index) =>
      importer.mapSupplierRow(
        row,
        { codigo: "sku", unidade_medida: "unit", preco_custo: "price" },
        index + 2,
        [],
        [orRule],
      ).filtered_reason,
  ).length;
  assert.equal(syntheticOrFiltered, 2, "A combinação OU não produziu o resultado esperado.");
  const filtered = mapped.filter((row) => row.filtered_reason).length;
  const compoundFiltered = compoundMapped.filter((row) => row.filtered_reason).length;
  const eligibilityFiltered = eligibilityMapped.filter((row) => row.filtered_reason).length;
  const issueRows = mapped.filter((row) => row.issues.length > 0);
  const scientificEans = mapped.filter((row) => /[eE][+-]?\d+/.test(String(row.parsed.gtin ?? "")));

  assert(mapping.codigo, "O campo Código / SKU não foi identificado.");
  assert.equal(issueRows.length, 0, `Foram encontradas ${issueRows.length} linhas inválidas.`);
  assert.equal(scientificEans.length, 0, "Existem EANs em notação científica.");
  if (detection.kind === "evolusom") {
    const expectedFiltered = rows.length - rows.filter((row) => {
      const dimensions = [row.width, row.height, row.depth].map((value) =>
        String(value ?? "").trim() === "" ? Number.NaN : Number(value),
      );
      return (
        String(row.Situacao ?? "").trim().toLocaleLowerCase("pt-BR") !== "inativo" &&
        Number(row.weightValue) < 30 &&
        dimensions.every(Number.isFinite) &&
        dimensions[0] + dimensions[1] + dimensions[2] < 200 &&
        Number(row.price) < 1000 &&
        ["PC", "UN"].includes(String(row.saleUnit).trim()) &&
        String(row.sourceFat).trim() === "PR"
      );
    }).length;
    assert.equal(filtered, expectedFiltered, "As regras padrão da Evolusom divergiram da origem.");
    const expectedCompoundFiltered = rows.filter(
      (row) =>
        String(row.weightUnit ?? "")
          .trim()
          .toLocaleUpperCase("pt-BR") === "KG" && Number(row.price) > 100,
    ).length;
    assert.equal(
      compoundFiltered,
      expectedCompoundFiltered,
      "O filtro composto por KG e preço divergiu da origem.",
    );
    const expectedEligible = rows.filter((row) => {
      const dimensions = [row.width, row.height, row.depth].map((value) =>
        String(value ?? "").trim() === "" ? Number.NaN : Number(value),
      );
      return (
        Number(row.weightValue) < 30 &&
        dimensions.every(Number.isFinite) &&
        dimensions[0] + dimensions[1] + dimensions[2] < 200 &&
        Number(row.price) < 1000 &&
        ["PC", "UN"].includes(String(row.saleUnit).trim()) &&
        String(row.sourceFat).trim() === "PR"
      );
    }).length;
    assert.equal(
      eligibilityFiltered,
      rows.length - expectedEligible,
      "O modelo de elegibilidade divergiu dos limites configurados.",
    );
  }

  console.log(
    JSON.stringify(
      {
        file: filePath,
        sheet: workbook.SheetNames[0],
        detection,
        rows: mapped.length,
        mappedFields: Object.keys(mapping).length,
        filtered,
        compoundFilter: {
          expression: "unidade_medida = KG E preco_custo > 100",
          filtered: compoundFiltered,
        },
        eligibilityFilter: {
          expression: "peso < 30 kg, L+A+P < 200 cm, preço < 1000, unidade PC/UN, origem PR",
          eligible: rows.length - eligibilityFiltered,
          filtered: eligibilityFiltered,
        },
        issueRows: issueRows.length,
        scientificEans: scientificEans.length,
        sample: mapped.slice(0, 3).map((row) => ({
          row: row.row_number,
          codigo: row.parsed.codigo,
          gtin: row.parsed.gtin,
          unidade: row.parsed.unidade,
          multiplo: row.parsed.itens_caixa,
          peso: row.parsed.peso_liquido,
          largura: row.parsed.largura,
          altura: row.parsed.altura,
          profundidade: row.parsed.profundidade,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await vite.close();
}
