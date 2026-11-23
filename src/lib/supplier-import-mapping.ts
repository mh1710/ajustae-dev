import type { CanonicalProduct } from "@/lib/sheet-mapping";

export type SupplierImportFieldType = "text" | "number" | "integer" | "date";

export type SupplierImportMapping = Partial<Record<keyof CanonicalProduct, string>>;

export interface SupplierValueMapping {
  id: string;
  field: keyof CanonicalProduct;
  from: string;
  to: string;
}

export type SupplierRuleOperator =
  | "always"
  | "equals"
  | "not_equals"
  | "one_of"
  | "not_one_of"
  | "contains"
  | "not_contains"
  | "is_empty"
  | "not_empty"
  | "greater_than"
  | "greater_or_equal"
  | "less_than"
  | "less_or_equal";

export const DIMENSIONS_SUM_FIELD = "__sum_dimensions_cm" as const;
export type SupplierConditionField = keyof CanonicalProduct | typeof DIMENSIONS_SUM_FIELD;

export type SupplierRuleAction =
  "set" | "clear" | "multiply" | "divide" | "uppercase" | "lowercase" | "strip_html" | "ignore";

export interface SupplierImportCondition {
  id: string;
  field: SupplierConditionField;
  operator: SupplierRuleOperator;
  value: string;
}

export interface SupplierImportRule {
  id: string;
  name: string;
  enabled: boolean;
  conditionField: SupplierConditionField;
  operator: SupplierRuleOperator;
  conditionValue: string;
  conditionLogic?: "and" | "or";
  conditions?: SupplierImportCondition[];
  targetField: keyof CanonicalProduct;
  action: SupplierRuleAction;
  actionValue: string;
}

export interface SupplierImportField {
  key: keyof CanonicalProduct;
  label: string;
  type: SupplierImportFieldType;
  group: "Identificação" | "Comercial" | "Estoque" | "Fiscal" | "Dimensões" | "Conteúdo" | "Outros";
  aliases?: string[];
}

const text = (
  key: keyof CanonicalProduct,
  label: string,
  group: SupplierImportField["group"],
  aliases: string[] = [],
): SupplierImportField => ({ key, label, type: "text", group, aliases });
const number = (
  key: keyof CanonicalProduct,
  label: string,
  group: SupplierImportField["group"],
  aliases: string[] = [],
): SupplierImportField => ({ key, label, type: "number", group, aliases });

export const SUPPLIER_IMPORT_FIELDS: SupplierImportField[] = [
  text("codigo", "Código / SKU", "Identificação", [
    "codigo",
    "sku",
    "cod produto",
    "codigo produto",
    "referencia",
  ]),
  text("nome", "Nome", "Identificação", ["nome", "produto", "descricao", "titulo"]),
  text("gtin", "GTIN / EAN", "Identificação", ["gtin", "ean", "codigo de barras", "codigobarras"]),
  text("gtin_embalagem", "GTIN da embalagem", "Identificação", ["gtin embalagem", "ean embalagem"]),
  text("marca", "Marca", "Identificação", ["marca", "fabricante"]),
  text("categoria_produto", "Categoria do produto", "Identificação", [
    "categoria",
    "grupo",
    "familia",
  ]),
  text("fornecedor", "Fornecedor", "Identificação", ["fornecedor"]),
  text("cod_fornecedor", "Código no fornecedor", "Identificação", [
    "codigo fornecedor",
    "cod fornecedor",
    "referencia fornecedor",
  ]),
  text("situacao", "Situação", "Identificação", ["situacao", "status"]),
  text("unidade", "Unidade", "Identificação", ["unidade", "un"]),
  text("unidade_medida", "Unidade de medida", "Identificação"),
  text("descricao_curta", "Descrição curta", "Conteúdo", ["descricao curta", "resumo"]),
  text("descricao_complementar", "Descrição complementar", "Conteúdo", [
    "descricao complementar",
    "descricao completa",
  ]),
  text("descricao_fornecedor", "Descrição no fornecedor", "Conteúdo"),
  text("observacoes", "Observações", "Conteúdo", ["observacoes", "obs"]),
  text("informacoes_adicionais", "Informações adicionais", "Conteúdo"),
  text("url_imagens_externas", "URLs de imagens", "Conteúdo", [
    "imagem",
    "foto",
    "url imagem",
    "imagens",
  ]),
  text("link_externo", "Link externo", "Conteúdo"),
  text("video", "Vídeo", "Conteúdo"),
  number("preco", "Preço de venda", "Comercial", ["preco", "preco venda", "valor venda"]),
  number("preco_custo", "Preço de custo", "Comercial", ["preco custo", "custo"]),
  number("preco_compra", "Preço de compra", "Comercial", ["preco compra", "valor compra"]),
  number("valor_ipi_fixo", "Valor de IPI fixo", "Comercial"),
  number("estoque", "Estoque", "Estoque", ["estoque", "quantidade", "saldo", "qt estoque"]),
  number("estoque_minimo", "Estoque mínimo", "Estoque"),
  number("estoque_maximo", "Estoque máximo", "Estoque"),
  number("itens_caixa", "Itens por caixa", "Estoque"),
  number("volumes", "Volumes", "Estoque"),
  text("ncm", "NCM", "Fiscal", ["ncm"]),
  text("cest", "CEST", "Fiscal", ["cest"]),
  text("origem_fiscal", "Origem fiscal", "Fiscal", ["origem", "origem fiscal"]),
  text("classe_ipi", "Classe de IPI", "Fiscal"),
  text("codigo_lista_servicos", "Código da lista de serviços", "Fiscal"),
  text("tributos", "Tributos", "Fiscal"),
  number("icms_st_base", "Base ICMS ST", "Fiscal"),
  number("icms_st_retencao", "ICMS ST retenção", "Fiscal"),
  number("icms_proprio_substituto", "ICMS próprio do substituto", "Fiscal"),
  number("peso_liquido", "Peso líquido (kg)", "Dimensões", ["peso liquido", "peso", "peso kg"]),
  number("peso_bruto", "Peso bruto (kg)", "Dimensões", ["peso bruto"]),
  number("largura", "Largura", "Dimensões", ["largura"]),
  number("altura", "Altura", "Dimensões", ["altura"]),
  number("profundidade", "Profundidade / comprimento", "Dimensões", [
    "profundidade",
    "comprimento",
  ]),
  text("localizacao", "Localização", "Outros"),
  text("grupo_produtos", "Grupo de produtos", "Outros"),
  text("grupo_tags", "Tags", "Outros"),
  text("tipo_item", "Tipo do item", "Outros"),
  text("tipo_producao", "Tipo de produção", "Outros"),
  text("produto_variacao", "Produto variação", "Outros"),
  text("codigo_pai", "Código pai", "Outros"),
  text("codigo_integracao", "Código de integração", "Outros"),
  text("departamento", "Departamento", "Outros"),
  text("condicao_produto", "Condição do produto", "Outros"),
  text("frete_gratis", "Frete grátis", "Outros"),
  text("cross_docking", "Cross-docking", "Outros"),
  text("clonar_dados_pai", "Clonar dados do pai", "Outros"),
  text("meses_garantia_fornecedor", "Meses de garantia", "Outros", ["garantia", "meses garantia"]),
  text("numero_fci", "Número FCI", "Outros"),
  {
    key: "data_validade",
    label: "Data de validade",
    type: "date",
    group: "Outros",
    aliases: ["validade", "data validade"],
  },
];

function comparable(v: string) {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fieldByKey(key: keyof CanonicalProduct) {
  return SUPPLIER_IMPORT_FIELDS.find((field) => field.key === key);
}

function mappedValue(value: unknown, field: keyof CanonicalProduct, maps: SupplierValueMapping[]) {
  if (value == null) return { value, changed: false };
  const source = comparable(String(value));
  const match = maps.find((item) => item.field === field && comparable(item.from) === source);
  return match ? { value: match.to, changed: true } : { value, changed: false };
}

export interface SupplierSheetDetection {
  kind: "evolusom" | "generic";
  label: string;
  confidence: number;
  matchedHeaders: string[];
  missingRequiredHeaders: string[];
  evidence: string[];
  supplierMismatch: boolean;
}

const EVOLUSOM_MAPPING: SupplierImportMapping = {
  codigo: "prod_id",
  nome: "prod_name",
  descricao_curta: "shortname",
  descricao_complementar: "description",
  descricao_fornecedor: "prod_name",
  informacoes_adicionais: "characteristics",
  observacoes: "info",
  gtin: "EAN",
  marca: "brand",
  categoria_produto: "seg_name",
  cod_fornecedor: "prod_id",
  situacao: "Situacao",
  unidade: "saleUnit",
  unidade_medida: "weightUnit",
  preco_custo: "price",
  estoque: "stock",
  estoque_minimo: "QTDEMIN",
  itens_caixa: "saleQuant",
  ncm: "NBM",
  origem_fiscal: "sourceFat",
  valor_ipi_fixo: "IPI",
  peso_liquido: "weightValue",
  peso_bruto: "weightValue",
  largura: "width",
  altura: "height",
  profundidade: "depth",
  url_imagens_externas: "images",
  video: "youtube",
  meses_garantia_fornecedor: "warrantyDays",
};

const EVOLUSOM_REQUIRED_HEADERS = [
  "prod_id",
  "prod_name",
  "saleUnit",
  "saleQuant",
  "weightValue",
  "EAN",
];
const EVOLUSOM_OPTIONAL_HEADERS = [
  "brand",
  "seg_name",
  "NBM",
  "weightUnit",
  "width",
  "height",
  "depth",
  "price",
  "stock",
  "forn_id",
  "Situacao",
];

export function detectSupplierSheet(
  headers: string[],
  selectedSupplierCode?: string,
  sampleRows: Array<Record<string, unknown>> = [],
): SupplierSheetDetection {
  const byNormalized = new Map(headers.map((header) => [comparable(header), header]));
  const matchedRequired = EVOLUSOM_REQUIRED_HEADERS.filter((header) =>
    byNormalized.has(comparable(header)),
  );
  const matchedOptional = EVOLUSOM_OPTIONAL_HEADERS.filter((header) =>
    byNormalized.has(comparable(header)),
  );
  const missingRequiredHeaders = EVOLUSOM_REQUIRED_HEADERS.filter(
    (header) => !byNormalized.has(comparable(header)),
  );
  const weightedTotal = EVOLUSOM_REQUIRED_HEADERS.length * 2 + EVOLUSOM_OPTIONAL_HEADERS.length;
  const weightedMatches = matchedRequired.length * 2 + matchedOptional.length;
  const supplierMatches = comparable(selectedSupplierCode ?? "") === "evolusom";
  const providerHeader = headers.find((header) => comparable(header) === comparable("forn_id"));
  const providerIds = new Set(
    providerHeader
      ? sampleRows
          .slice(0, 100)
          .map((row) => String(row[providerHeader] ?? "").trim())
          .filter(Boolean)
      : [],
  );
  const contentMatches = providerIds.has("133");
  const recognized =
    matchedRequired.length >= 5 &&
    byNormalized.has(comparable("prod_id")) &&
    byNormalized.has(comparable("prod_name"));
  if (recognized) {
    return {
      kind: "evolusom",
      label: "Evolusom",
      confidence: Math.min(
        1,
        weightedMatches / weightedTotal + (supplierMatches || contentMatches ? 0.05 : 0),
      ),
      matchedHeaders: [...matchedRequired, ...matchedOptional],
      missingRequiredHeaders,
      evidence: [
        `${matchedRequired.length}/${EVOLUSOM_REQUIRED_HEADERS.length} cabeçalhos obrigatórios`,
        ...(supplierMatches ? ["fornecedor selecionado: Evolusom"] : []),
        ...(contentMatches ? ["forn_id 133 encontrado nos dados"] : []),
      ],
      supplierMismatch:
        contentMatches && !!selectedSupplierCode && comparable(selectedSupplierCode) !== "evolusom",
    };
  }
  return {
    kind: "generic",
    label: "Layout genérico",
    confidence: 0,
    matchedHeaders: [],
    missingRequiredHeaders: [],
    evidence: [],
    supplierMismatch: false,
  };
}

export function suggestSupplierMapping(
  headers: string[],
  selectedSupplierCode?: string,
): SupplierImportMapping {
  const normalized = headers.map((header) => ({ header, normalized: comparable(header) }));
  const detection = detectSupplierSheet(headers, selectedSupplierCode);
  const mapping: SupplierImportMapping = {};
  if (detection.kind === "evolusom") {
    for (const [key, expectedHeader] of Object.entries(EVOLUSOM_MAPPING)) {
      const actual = normalized.find((header) => header.normalized === comparable(expectedHeader));
      if (actual) mapping[key as keyof CanonicalProduct] = actual.header;
    }
  }
  const used = new Set(Object.values(mapping).filter(Boolean));
  for (const field of SUPPLIER_IMPORT_FIELDS) {
    if (mapping[field.key]) continue;
    const options = [field.label, field.key, ...(field.aliases ?? [])].map((v) =>
      comparable(String(v)),
    );
    const exact = normalized.find((h) => !used.has(h.header) && options.includes(h.normalized));
    if (exact) {
      mapping[field.key] = exact.header;
      used.add(exact.header);
    }
  }
  return mapping;
}

function parseNumber(value: unknown): number | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : "invalid";
  const original = String(value).trim();
  if (!original) return null;
  if (/[a-z]/i.test(original.replace(/R\$/gi, ""))) return "invalid";
  let raw = original
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/[^0-9,.\-+]/g, "");
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const thousands = decimal === "," ? /\./g : /,/g;
    raw = raw.replace(thousands, "").replace(decimal, ".");
  } else if (comma >= 0) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(raw)) {
    raw = raw.replace(/\./g, "");
  } else if ((raw.match(/\./g) ?? []).length > 1) {
    const parts = raw.split(".");
    const decimal = parts.pop();
    raw = `${parts.join("")}.${decimal}`;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : "invalid";
}

function parseDate(value: unknown): string | null | "invalid" {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 0) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return Number.isNaN(date.getTime()) ? "invalid" : date.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  let match = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(raw);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return "invalid";
}

function normalizeImageUrls(value: unknown): string | null {
  if (value == null) return null;
  const urls = String(value)
    .replace(/[\r\n\t]+/g, "|")
    .replace(/\s*\|\s*/g, "|")
    .split(/[|;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return urls.length ? Array.from(new Set(urls)).join("|") : null;
}

export interface SupplierMappedRow {
  row_number: number;
  raw: Record<string, unknown>;
  parsed: Partial<CanonicalProduct>;
  issues: string[];
  transformations: string[];
  cleared_fields: Array<keyof CanonicalProduct>;
  filtered_reason: string | null;
}

function asComparableValue(value: unknown) {
  return comparable(value == null ? "" : String(value));
}

function matchesCondition(
  condition: Omit<SupplierImportCondition, "id">,
  parsed: Record<string, unknown>,
) {
  if (condition.operator === "always") return true;
  const current =
    condition.field === DIMENSIONS_SUM_FIELD ? dimensionSum(parsed) : parsed[condition.field];
  const currentText = asComparableValue(current);
  const expected = asComparableValue(condition.value);
  if (!["is_empty", "not_empty"].includes(condition.operator) && condition.value.trim() === "")
    return false;
  switch (condition.operator) {
    case "equals":
      return currentText === expected;
    case "not_equals":
      return currentText !== expected;
    case "one_of":
      return condition.value
        .split(";")
        .map(asComparableValue)
        .filter(Boolean)
        .includes(currentText);
    case "not_one_of":
      return !condition.value
        .split(";")
        .map(asComparableValue)
        .filter(Boolean)
        .includes(currentText);
    case "contains":
      return currentText.includes(expected);
    case "not_contains":
      return !currentText.includes(expected);
    case "is_empty":
      return current == null || String(current).trim() === "";
    case "not_empty":
      return current != null && String(current).trim() !== "";
    case "greater_than":
    case "greater_or_equal":
    case "less_than":
    case "less_or_equal": {
      const currentNumber = parseNumber(current);
      const expectedNumber = parseNumber(condition.value);
      if (
        currentNumber === "invalid" ||
        currentNumber == null ||
        expectedNumber === "invalid" ||
        expectedNumber == null
      )
        return false;
      switch (condition.operator) {
        case "greater_than":
          return currentNumber > expectedNumber;
        case "greater_or_equal":
          return currentNumber >= expectedNumber;
        case "less_than":
          return currentNumber < expectedNumber;
        default:
          return currentNumber <= expectedNumber;
      }
    }
  }
}

function dimensionSum(parsed: Record<string, unknown>): number | null {
  const dimensions = [parsed.largura, parsed.altura, parsed.profundidade].map(parseNumber);
  if (dimensions.some((value) => value == null || value === "invalid")) return null;
  return (dimensions[0] as number) + (dimensions[1] as number) + (dimensions[2] as number);
}

export function createEligibilityFilterRules(createId: () => string): SupplierImportRule[] {
  const filter = (
    name: string,
    field: SupplierConditionField,
    operator: SupplierRuleOperator,
    value: string,
  ): SupplierImportRule => ({
    id: createId(),
    name,
    enabled: true,
    conditionField: field,
    operator,
    conditionValue: value,
    conditionLogic: "and",
    conditions: [{ id: createId(), field, operator, value }],
    targetField: "codigo",
    action: "ignore",
    actionValue: "",
  });

  return [
    filter("Peso não informado", "peso_liquido", "is_empty", ""),
    filter("Peso igual ou acima de 30 kg", "peso_liquido", "greater_or_equal", "30"),
    filter("Medidas incompletas", DIMENSIONS_SUM_FIELD, "is_empty", ""),
    filter(
      "Soma de L+A+P igual ou acima de 200 cm",
      DIMENSIONS_SUM_FIELD,
      "greater_or_equal",
      "200",
    ),
    filter("Preço não informado", "preco_custo", "is_empty", ""),
    filter("Preço igual ou acima de R$ 1.000", "preco_custo", "greater_or_equal", "1000"),
    filter("Unidade fora de PC ou UN", "unidade", "not_one_of", "PC;UN"),
    filter("Origem diferente de PR", "origem_fiscal", "not_equals", "PR"),
  ];
}

export function createEvolusomDefaultValueMappings(
  createId: () => string,
): SupplierValueMapping[] {
  return [
    { id: createId(), field: "situacao", from: "Ativo", to: "A" },
    { id: createId(), field: "situacao", from: "Inativo", to: "I" },
  ];
}

export function createEvolusomDefaultRules(createId: () => string): SupplierImportRule[] {
  const rule = (
    name: string,
    field: SupplierConditionField,
    operator: SupplierRuleOperator,
    value: string,
    targetField: keyof CanonicalProduct,
    action: SupplierRuleAction,
    actionValue = "",
  ): SupplierImportRule => ({
    id: createId(),
    name,
    enabled: true,
    conditionField: field,
    operator,
    conditionValue: value,
    conditionLogic: "and",
    conditions: [{ id: createId(), field, operator, value }],
    targetField,
    action,
    actionValue,
  });

  return [
    rule("Não importar produtos inativos", "situacao", "equals", "I", "codigo", "ignore"),
    rule(
      "Remover HTML da descrição complementar",
      "descricao_complementar",
      "not_empty",
      "",
      "descricao_complementar",
      "strip_html",
    ),
    rule(
      "Converter garantia de dias para meses",
      "meses_garantia_fornecedor",
      "not_empty",
      "",
      "meses_garantia_fornecedor",
      "divide",
      "30",
    ),
    ...createEligibilityFilterRules(createId),
  ];
}

export function conditionsForRule(rule: SupplierImportRule): SupplierImportCondition[] {
  if (rule.conditions?.length) return rule.conditions;
  return [
    {
      id: `${rule.id}-condition-1`,
      field: rule.conditionField,
      operator: rule.operator,
      value: rule.conditionValue,
    },
  ];
}

function matchesRule(rule: SupplierImportRule, parsed: Record<string, unknown>) {
  const results = conditionsForRule(rule).map((condition) => matchesCondition(condition, parsed));
  return rule.conditionLogic === "or" ? results.some(Boolean) : results.every(Boolean);
}

function parseFieldValue(field: SupplierImportField, value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  if (field.type === "number" || field.type === "integer") return parseNumber(value);
  if (field.type === "date") return parseDate(value);
  return String(value).trim() || null;
}

function applyRules(
  parsed: Record<string, unknown>,
  rules: SupplierImportRule[],
  issues: string[],
) {
  const transformations: string[] = [];
  const clearedFields = new Set<keyof CanonicalProduct>();
  let filteredReason: string | null = null;
  for (const rule of rules) {
    if (!rule.enabled || !matchesRule(rule, parsed)) continue;
    if (rule.action === "ignore") {
      filteredReason = rule.name || "Linha ignorada por regra de filtro.";
      transformations.push(`Filtro: ${filteredReason}`);
      break;
    }
    const field = fieldByKey(rule.targetField);
    if (!field) continue;
    const before = parsed[rule.targetField];
    if (rule.action === "clear") {
      parsed[rule.targetField] = null;
      clearedFields.add(rule.targetField);
    } else if (rule.action === "set") {
      const converted = parseFieldValue(field, rule.actionValue);
      if (converted === "invalid") {
        issues.push(`${rule.name || "Regra"}: valor inválido para ${field.label}.`);
        continue;
      }
      parsed[rule.targetField] = converted;
      clearedFields.delete(rule.targetField);
    } else if (rule.action === "multiply" || rule.action === "divide") {
      const factor = parseNumber(rule.actionValue);
      const current = parseNumber(before);
      if (factor === "invalid" || factor == null || current === "invalid" || current == null) {
        issues.push(`${rule.name || "Regra"}: não foi possível calcular ${field.label}.`);
        continue;
      }
      if (rule.action === "divide" && factor === 0) {
        issues.push(`${rule.name || "Regra"}: divisão por zero em ${field.label}.`);
        continue;
      }
      parsed[rule.targetField] = rule.action === "multiply" ? current * factor : current / factor;
      clearedFields.delete(rule.targetField);
    } else {
      const current = before == null ? "" : String(before);
      parsed[rule.targetField] =
        rule.action === "uppercase"
          ? current.toLocaleUpperCase("pt-BR")
          : rule.action === "lowercase"
            ? current.toLocaleLowerCase("pt-BR")
            : current
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;|&#160;/gi, " ")
                .replace(/\s+\n/g, "\n")
                .replace(/[ \t]+/g, " ")
                .trim();
      clearedFields.delete(rule.targetField);
    }
    transformations.push(
      `${rule.name || "Regra"}: ${field.label} (${before ?? "vazio"} → ${parsed[rule.targetField] ?? "vazio"})`,
    );
  }
  return {
    transformations,
    clearedFields: Array.from(clearedFields),
    filteredReason,
  };
}

export function mapSupplierRow(
  raw: Record<string, unknown>,
  mapping: SupplierImportMapping,
  rowNumber: number,
  valueMappings: SupplierValueMapping[] = [],
  rules: SupplierImportRule[] = [],
): SupplierMappedRow {
  const parsed: Record<string, unknown> = {};
  const issues: string[] = [];
  const valueTransformations: string[] = [];
  for (const field of SUPPLIER_IMPORT_FIELDS) {
    const source = mapping[field.key];
    if (!source) continue;
    const convertedValue = mappedValue(raw[source], field.key, valueMappings);
    const value = convertedValue.value;
    if (convertedValue.changed)
      valueTransformations.push(
        `De/Para: ${field.label} (${String(raw[source] ?? "vazio")} → ${String(value || "vazio")})`,
      );
    if (field.key === "url_imagens_externas") {
      parsed[field.key] = normalizeImageUrls(value);
      if (parsed[field.key]) valueTransformations.push("Imagens: URLs normalizadas e separadas por |.");
      continue;
    }
    if (value == null || String(value).trim() === "") {
      parsed[field.key] = null;
      continue;
    }
    if (field.type === "number" || field.type === "integer") {
      const converted = parseNumber(value);
      if (
        converted === "invalid" ||
        (field.type === "integer" && converted != null && !Number.isInteger(converted))
      ) {
        issues.push(`${field.label}: esperado número, recebido "${String(value).slice(0, 60)}".`);
        parsed[field.key] = null;
      } else parsed[field.key] = converted;
    } else if (field.type === "date") {
      const converted = parseDate(value);
      if (converted === "invalid") {
        issues.push(`${field.label}: data inválida "${String(value).slice(0, 60)}".`);
        parsed[field.key] = null;
      } else parsed[field.key] = converted;
    } else {
      const converted = String(value).trim();
      parsed[field.key] = converted || null;
    }
  }
  if (parsed.gtin != null && String(parsed.gtin).trim() !== "") {
    parsed.gtin_embalagem = parsed.gtin;
    valueTransformations.push("EAN: clonado para GTIN da embalagem.");
  }
  const ruleResult = applyRules(parsed, rules, issues);
  if (!String(parsed.codigo ?? "").trim())
    issues.push("Código / SKU não informado ou não mapeado.");
  return {
    row_number: rowNumber,
    raw,
    parsed: parsed as Partial<CanonicalProduct>,
    issues,
    transformations: [...valueTransformations, ...ruleResult.transformations],
    cleared_fields: ruleResult.clearedFields,
    filtered_reason: ruleResult.filteredReason,
  };
}
