// Mapeamento canônico da planilha oficial do Bling (layout produtos - export CSV/XLSX).
// A ORDEM e os NOMES aqui são a autoridade — exportação e importação usam esta lista.

export const BLING_SHEET_COLUMNS = [
  "ID",
  "Código",
  "Descrição",
  "Unidade",
  "NCM",
  "Origem",
  "Preço",
  "Valor IPI fixo",
  "Observações",
  "Situação",
  "Estoque",
  "Preço de custo",
  "Cód. no fornecedor",
  "Fornecedor",
  "Localização",
  "Estoque máximo",
  "Estoque mínimo",
  "Peso líquido (Kg)",
  "Peso bruto (Kg)",
  "GTIN/EAN",
  "GTIN/EAN da Embalagem",
  "Largura do produto",
  "Altura do Produto",
  "Profundidade do produto",
  "Data Validade",
  "Descrição do Produto no Fornecedor",
  "Descrição Complementar",
  "Itens p/ caixa",
  "Produto Variação",
  "Tipo Produção",
  "Classe de enquadramento do IPI",
  "Código na Lista de Serviços",
  "Tipo do item",
  "Grupo de Tags/Tags",
  "Tributos",
  "Código Pai",
  "Código Integração",
  "Grupo de produtos",
  "Marca",
  "CEST",
  "Volumes",
  "Descrição Curta",
  "Cross-Docking",
  "URL Imagens Externas",
  "Link Externo",
  "Meses Garantia no Fornecedor",
  "Clonar dados do pai",
  "Condição do Produto",
  "Frete Grátis",
  "Número FCI",
  "Vídeo",
  "Departamento",
  "Unidade de Medida",
  "Preço de Compra",
  "Valor base ICMS ST para retenção",
  "Valor ICMS ST para retenção",
  "Valor ICMS próprio do substituto",
  "Categoria do produto",
  "Informações Adicionais",
] as const;

export type BlingSheetColumn = (typeof BLING_SHEET_COLUMNS)[number];
export type SheetRow = Partial<Record<BlingSheetColumn, string>>;

function s(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

function num(v: unknown): number | null {
  const raw = s(v);
  if (!raw) return null;
  // Bling exporta com vírgula decimal; remove separador de milhar (ponto quando seguido de 3 dígitos)
  const norm = raw.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

function date(v: unknown): string | null {
  const raw = s(v);
  if (!raw) return null;
  // dd/mm/yyyy → ISO date; ignora sentinelas do Bling
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  if (yyyy === "9999") return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** Campos internos comparáveis (base para diff Sistema × Planilha). */
export interface CanonicalProduct {
  bling_product_id: string | null;
  codigo: string | null;
  nome: string | null;
  descricao_complementar: string | null;
  descricao_curta: string | null;
  observacoes: string | null;
  unidade: string | null;
  unidade_medida: string | null;
  ncm: string | null;
  origem_fiscal: string | null;
  situacao: string | null;
  gtin: string | null;
  gtin_embalagem: string | null;
  marca: string | null;
  categoria_produto: string | null;
  fornecedor: string | null;
  cod_fornecedor: string | null;
  localizacao: string | null;
  grupo_produtos: string | null;
  grupo_tags: string | null;
  tipo_item: string | null;
  tipo_producao: string | null;
  produto_variacao: string | null;
  codigo_pai: string | null;
  codigo_integracao: string | null;
  departamento: string | null;
  condicao_produto: string | null;
  frete_gratis: string | null;
  cross_docking: string | null;
  clonar_dados_pai: string | null;
  meses_garantia_fornecedor: string | null;
  numero_fci: string | null;
  cest: string | null;
  classe_ipi: string | null;
  codigo_lista_servicos: string | null;
  tributos: string | null;
  descricao_fornecedor: string | null;
  informacoes_adicionais: string | null;
  url_imagens_externas: string | null;
  link_externo: string | null;
  video: string | null;
  preco: number | null;
  preco_custo: number | null;
  preco_compra: number | null;
  valor_ipi_fixo: number | null;
  icms_st_base: number | null;
  icms_st_retencao: number | null;
  icms_proprio_substituto: number | null;
  estoque: number | null;
  estoque_minimo: number | null;
  estoque_maximo: number | null;
  itens_caixa: number | null;
  volumes: number | null;
  peso_liquido: number | null;
  peso_bruto: number | null;
  largura: number | null;
  altura: number | null;
  profundidade: number | null;
  data_validade: string | null;
}

export function normalizeRow(row: SheetRow): CanonicalProduct {
  return {
    bling_product_id: s(row["ID"]),
    codigo: s(row["Código"]),
    nome: s(row["Descrição"]),
    descricao_complementar: s(row["Descrição Complementar"]),
    descricao_curta: s(row["Descrição Curta"]),
    observacoes: s(row["Observações"]),
    unidade: s(row["Unidade"]),
    unidade_medida: s(row["Unidade de Medida"]),
    ncm: s(row["NCM"]),
    origem_fiscal: s(row["Origem"]),
    situacao: s(row["Situação"]),
    gtin: s(row["GTIN/EAN"]),
    gtin_embalagem: s(row["GTIN/EAN da Embalagem"]),
    marca: s(row["Marca"]),
    categoria_produto: s(row["Categoria do produto"]),
    fornecedor: s(row["Fornecedor"]),
    cod_fornecedor: s(row["Cód. no fornecedor"]),
    localizacao: s(row["Localização"]),
    grupo_produtos: s(row["Grupo de produtos"]),
    grupo_tags: s(row["Grupo de Tags/Tags"]),
    tipo_item: s(row["Tipo do item"]),
    tipo_producao: s(row["Tipo Produção"]),
    produto_variacao: s(row["Produto Variação"]),
    codigo_pai: s(row["Código Pai"]),
    codigo_integracao: s(row["Código Integração"]),
    departamento: s(row["Departamento"]),
    condicao_produto: s(row["Condição do Produto"]),
    frete_gratis: s(row["Frete Grátis"]),
    cross_docking: s(row["Cross-Docking"]),
    clonar_dados_pai: s(row["Clonar dados do pai"]),
    meses_garantia_fornecedor: s(row["Meses Garantia no Fornecedor"]),
    numero_fci: s(row["Número FCI"]),
    cest: s(row["CEST"]),
    classe_ipi: s(row["Classe de enquadramento do IPI"]),
    codigo_lista_servicos: s(row["Código na Lista de Serviços"]),
    tributos: s(row["Tributos"]),
    descricao_fornecedor: s(row["Descrição do Produto no Fornecedor"]),
    informacoes_adicionais: s(row["Informações Adicionais"]),
    url_imagens_externas: s(row["URL Imagens Externas"]),
    link_externo: s(row["Link Externo"]),
    video: s(row["Vídeo"]),
    preco: num(row["Preço"]),
    preco_custo: num(row["Preço de custo"]),
    preco_compra: num(row["Preço de Compra"]),
    valor_ipi_fixo: num(row["Valor IPI fixo"]),
    icms_st_base: num(row["Valor base ICMS ST para retenção"]),
    icms_st_retencao: num(row["Valor ICMS ST para retenção"]),
    icms_proprio_substituto: num(row["Valor ICMS próprio do substituto"]),
    estoque: num(row["Estoque"]),
    estoque_minimo: num(row["Estoque mínimo"]),
    estoque_maximo: num(row["Estoque máximo"]),
    itens_caixa: num(row["Itens p/ caixa"]),
    volumes: num(row["Volumes"]),
    peso_liquido: num(row["Peso líquido (Kg)"]),
    peso_bruto: num(row["Peso bruto (Kg)"]),
    largura: num(row["Largura do produto"]),
    altura: num(row["Altura do Produto"]),
    profundidade: num(row["Profundidade do produto"]),
    data_validade: date(row["Data Validade"]),
  };
}

/** Campos considerados na comparação lado-a-lado. */
export const DIFF_FIELDS: (keyof CanonicalProduct)[] = [
  "nome","descricao_complementar","descricao_curta","preco","preco_custo","estoque",
  "marca","fornecedor","categoria_produto","gtin","gtin_embalagem",
  "peso_liquido","peso_bruto","largura","altura","profundidade","ncm","unidade",
  "url_imagens_externas","situacao","codigo_pai","tipo_item","grupo_produtos",
];

export function computeDiff(sistema: Partial<CanonicalProduct>, planilha: CanonicalProduct) {
  const out: { field: string; sistema: unknown; planilha: unknown }[] = [];
  for (const f of DIFF_FIELDS) {
    const a = (sistema as unknown as Record<string, unknown>)[f as string] ?? null;
    const b = (planilha as unknown as Record<string, unknown>)[f as string] ?? null;
    const aa = typeof a === "number" ? a : a == null ? "" : String(a).trim();
    const bb = typeof b === "number" ? b : b == null ? "" : String(b).trim();
    if (aa !== bb) out.push({ field: f, sistema: a, planilha: b });
  }
  return out;
}

/** Mapeamento CanonicalProduct → colunas do bling_products (para upsert). */
export function toProductRow(p: CanonicalProduct, companyId: string) {
  return {
    company_id: companyId,
    bling_product_id: p.bling_product_id,
    codigo: p.codigo,
    nome: p.nome,
    descricao_complementar: p.descricao_complementar,
    descricao_curta: p.descricao_curta,
    observacoes: p.observacoes,
    unidade: p.unidade,
    unidade_medida: p.unidade_medida,
    ncm: p.ncm,
    origem_fiscal: p.origem_fiscal,
    situacao: p.situacao,
    gtin: p.gtin,
    gtin_embalagem: p.gtin_embalagem,
    marca: p.marca,
    categoria_produto: p.categoria_produto,
    fornecedor: p.fornecedor,
    cod_fornecedor: p.cod_fornecedor,
    localizacao: p.localizacao,
    grupo_produtos: p.grupo_produtos,
    grupo_tags: p.grupo_tags,
    tipo_item: p.tipo_item,
    tipo_producao: p.tipo_producao,
    produto_variacao: p.produto_variacao,
    codigo_pai: p.codigo_pai,
    codigo_integracao: p.codigo_integracao,
    departamento: p.departamento,
    condicao_produto: p.condicao_produto,
    frete_gratis: p.frete_gratis,
    cross_docking: p.cross_docking,
    clonar_dados_pai: p.clonar_dados_pai,
    meses_garantia_fornecedor: p.meses_garantia_fornecedor,
    numero_fci: p.numero_fci,
    cest: p.cest,
    classe_ipi: p.classe_ipi,
    codigo_lista_servicos: p.codigo_lista_servicos,
    tributos: p.tributos,
    descricao_fornecedor: p.descricao_fornecedor,
    informacoes_adicionais: p.informacoes_adicionais,
    url_imagens_externas: p.url_imagens_externas,
    link_externo: p.link_externo,
    video: p.video,
    preco: p.preco,
    preco_custo: p.preco_custo,
    preco_compra: p.preco_compra,
    valor_ipi_fixo: p.valor_ipi_fixo,
    icms_st_base: p.icms_st_base,
    icms_st_retencao: p.icms_st_retencao,
    icms_proprio_substituto: p.icms_proprio_substituto,
    estoque: p.estoque,
    estoque_minimo: p.estoque_minimo,
    estoque_maximo: p.estoque_maximo,
    itens_caixa: p.itens_caixa,
    volumes: p.volumes,
    peso_liquido: p.peso_liquido,
    peso_bruto: p.peso_bruto,
    largura: p.largura,
    altura: p.altura,
    profundidade: p.profundidade,
    data_validade: p.data_validade,
    imagem_principal_url: firstImage(p.url_imagens_externas),
    source: "planilha" as const,
    last_imported_at: new Date().toISOString(),
  };
}

function firstImage(v: string | null): string | null {
  if (!v) return null;
  // Bling separa URLs por "|". Não usar espaço/vírgula como separador porque
  // URLs podem conter espaço (ex: ".../332243 _1.jpg") ou vírgula na query.
  const first = v.split(/[|\n\r]+/).map((s) => s.trim()).find((u) => /^https?:\/\//i.test(u));
  return first ?? null;
}

// ---------------------------------------------------------------------------
// Serialização reversa: bling_products (linha do banco) → SheetRow
// ---------------------------------------------------------------------------

function numToBr(n: unknown): string {
  if (n == null || n === "") return "";
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "";
  return v.toFixed(2).replace(".", ",");
}
function intToBr(n: unknown): string {
  if (n == null || n === "") return "";
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "";
  return String(Math.round(v));
}
function dateBr(v: unknown): string {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}
function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** Converte um registro do bling_products em uma linha compatível com a planilha do Bling. */
export function productToSheetRow(p: Record<string, unknown>): Record<string, string> {
  return {
    "ID": str(p.bling_product_id),
    "Código": str(p.codigo),
    "Descrição": str(p.nome),
    "Unidade": str(p.unidade),
    "NCM": str(p.ncm),
    "Origem": str(p.origem_fiscal),
    "Preço": numToBr(p.preco),
    "Valor IPI fixo": numToBr(p.valor_ipi_fixo),
    "Observações": str(p.observacoes),
    "Situação": str(p.situacao),
    "Estoque": intToBr(p.estoque),
    "Preço de custo": numToBr(p.preco_custo),
    "Cód. no fornecedor": str(p.cod_fornecedor),
    "Fornecedor": str(p.fornecedor),
    "Localização": str(p.localizacao),
    "Estoque máximo": intToBr(p.estoque_maximo),
    "Estoque mínimo": intToBr(p.estoque_minimo),
    "Peso líquido (Kg)": numToBr(p.peso_liquido),
    "Peso bruto (Kg)": numToBr(p.peso_bruto),
    "GTIN/EAN": str(p.gtin),
    "GTIN/EAN da Embalagem": str(p.gtin_embalagem),
    "Largura do produto": numToBr(p.largura),
    "Altura do Produto": numToBr(p.altura),
    "Profundidade do produto": numToBr(p.profundidade),
    "Data Validade": dateBr(p.data_validade),
    "Descrição do Produto no Fornecedor": str(p.descricao_fornecedor),
    "Descrição Complementar": str(p.descricao_complementar),
    "Itens p/ caixa": intToBr(p.itens_caixa),
    "Produto Variação": str(p.produto_variacao),
    "Tipo Produção": str(p.tipo_producao),
    "Classe de enquadramento do IPI": str(p.classe_ipi),
    "Código na Lista de Serviços": str(p.codigo_lista_servicos),
    "Tipo do item": str(p.tipo_item),
    "Grupo de Tags/Tags": str(p.grupo_tags),
    "Tributos": str(p.tributos),
    "Código Pai": str(p.codigo_pai),
    "Código Integração": str(p.codigo_integracao),
    "Grupo de produtos": str(p.grupo_produtos),
    "Marca": str(p.marca),
    "CEST": str(p.cest),
    "Volumes": intToBr(p.volumes),
    "Descrição Curta": str(p.descricao_curta),
    "Cross-Docking": str(p.cross_docking),
    "URL Imagens Externas": str(p.url_imagens_externas),
    "Link Externo": str(p.link_externo),
    "Meses Garantia no Fornecedor": str(p.meses_garantia_fornecedor),
    "Clonar dados do pai": str(p.clonar_dados_pai),
    "Condição do Produto": str(p.condicao_produto),
    "Frete Grátis": str(p.frete_gratis),
    "Número FCI": str(p.numero_fci),
    "Vídeo": str(p.video),
    "Departamento": str(p.departamento),
    "Unidade de Medida": str(p.unidade_medida),
    "Preço de Compra": numToBr(p.preco_compra),
    "Valor base ICMS ST para retenção": numToBr(p.icms_st_base),
    "Valor ICMS ST para retenção": numToBr(p.icms_st_retencao),
    "Valor ICMS próprio do substituto": numToBr(p.icms_proprio_substituto),
    "Categoria do produto": str(p.categoria_produto),
    "Informações Adicionais": str(p.informacoes_adicionais),
  };
}

/** Serializa um array de produtos em CSV compatível com o Bling (UTF-8 BOM + ; + aspas). */
export function serializeBlingCsv(
  products: Record<string, unknown>[],
  opts: { includeHeader?: boolean } = {},
): string {
  const includeHeader = opts.includeHeader !== false;
  const cols = BLING_SHEET_COLUMNS as readonly string[];
  const rows: string[] = includeHeader ? [cols.map(csvCell).join(";")] : [];
  for (const p of products) {
    const line = productToSheetRow(p);
    rows.push(cols.map((c) => csvCell(line[c] ?? "")).join(";"));
  }
  if (rows.length === 0) return "";
  const prefix = includeHeader ? "\uFEFF" : "";
  return prefix + rows.join("\r\n") + "\r\n";
}

function csvCell(v: string): string {
  if (v == null) return "";
  const needsQuote = /[;"\r\n]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}