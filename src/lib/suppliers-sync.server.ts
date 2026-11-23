import { XMLParser } from "fast-xml-parser";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { joinImages } from "@/lib/supplier-images";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type MappedProduct = {
  fornecedor_id: string;
  codigo: string;
  marca: string | null;
  categoria: string | null;
  titulo: string | null;
  nome_nota: string | null;
  unidade: string | null;
  multiplo: number | null;
  ipi: number | null;
  descricao_tecnica: string | null;
  estoque: string | null;
  qt_estoque: number | null;
  peso: number | null;
  altura: number | null;
  largura: number | null;
  comprimento: number | null;
  ncm: string | null;
  codigobarras: string | null;
  origem: string | null;
  faturamento: string | null;
  ppb: string | null;
  mpdobem: string | null;
  foto: string | null;
  tempo_garantia: string | null;
  precos: Record<string, number | null>;
};

export type SupplierDef = {
  codigo: string;
  nome: string;
  url: string;
  parseAndMap: (xml: string, fornecedorId: string) => MappedProduct[];
};

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const PRECO_UFS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

type OdercoProduto = Record<string, unknown>;

function mapOdercoProduct(fornecedorId: string, p: OdercoProduto): MappedProduct {
  const precos: Record<string, number | null> = {};
  for (const uf of PRECO_UFS) precos[uf] = toNum(p[`preco_${uf}`]);
  return {
    fornecedor_id: fornecedorId,
    codigo: String(p.codigo ?? "").trim(),
    marca: toStr(p.marca),
    categoria: toStr(p.categoria),
    titulo: toStr(p.titulo),
    nome_nota: toStr(p.nome_nota),
    unidade: toStr(p.unidade),
    multiplo: toNum(p.multiplo),
    ipi: toNum(p.ipi),
    descricao_tecnica: toStr(p.descricao_tecnica),
    estoque: toStr(p.estoque),
    qt_estoque: toNum(p.qt_estoque),
    peso: toNum(p.peso),
    altura: toNum(p.altura),
    largura: toNum(p.largura),
    comprimento: toNum(p.comprimento),
    ncm: toStr(p.ncm),
    codigobarras: toStr(p.codigobarras),
    origem: toStr(p.origem),
    faturamento: toStr(p.faturamento),
    ppb: toStr(p.ppb),
    mpdobem: toStr(p.mpdobem),
    foto: toStr(p.foto),
    tempo_garantia: toStr(p.tempo_garantia),
    precos,
  };
}

function parseXml(xml: string): unknown {
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
  return parser.parse(xml);
}

function odercoParseAndMap(xml: string, fornecedorId: string): MappedProduct[] {
  const parsed = parseXml(xml) as { produtos?: { produto?: OdercoProduto | OdercoProduto[] } };
  const raw = parsed?.produtos?.produto;
  const list: OdercoProduto[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const byCodigo = new Map<string, OdercoProduto>();
  for (const p of list) {
    const c = String(p.codigo ?? "").trim();
    if (!c) continue;
    byCodigo.set(c, p);
  }
  return Array.from(byCodigo.values()).map((p) => mapOdercoProduct(fornecedorId, p));
}

type HayamaxProduct = Record<string, unknown> & {
  images?: { image?: unknown };
  information?: Record<string, unknown>;
};

function allImages(images: HayamaxProduct["images"]): string | null {
  return images ? joinImages(images.image) : null;
}

function mapHayamaxProduct(fornecedorId: string, p: HayamaxProduct): MappedProduct {
  const info = (p.information ?? {}) as Record<string, unknown>;
  const precos: Record<string, number | null> = {
    base: toNum(p.price),
    crossdocking: toNum(p.price_crossdocking),
    dropshipping: toNum(p.price_dropshipping),
    revenda: toNum(p.preco_revenda),
    minimo: toNum(p.preco_minimo_venda),
    sugerido: toNum(p.preco_sugerido_venda),
  };
  const qt = toNum(p.stock);
  return {
    fornecedor_id: fornecedorId,
    codigo: String(p.prod_id ?? "").trim(),
    marca: toStr(p.brand),
    categoria: toStr(p.seg_name),
    titulo: toStr(p.prod_name),
    nome_nota: toStr(p.shortname),
    unidade: toStr(p.saleUnit),
    multiplo: toNum(p.saleQuant),
    ipi: toNum(p.IPI),
    descricao_tecnica: toStr(info.description),
    estoque: qt != null ? (qt > 0 ? "disponivel" : "indisponivel") : null,
    qt_estoque: qt,
    peso: toNum(p.weightValue),
    altura: toNum(p.height),
    largura: toNum(p.width),
    comprimento: toNum(p.depth),
    ncm: toStr(p.NBM),
    codigobarras: toStr(p.EAN),
    origem: toStr(p.sourceFat),
    faturamento: null,
    ppb: toStr(p.PPB),
    mpdobem: null,
    foto: allImages(p.images),
    tempo_garantia: toStr(p.warrantyDays),
    precos,
  };
}

function hayamaxParseAndMap(xml: string, fornecedorId: string): MappedProduct[] {
  const parsed = parseXml(xml) as { crossDocking?: { product?: HayamaxProduct | HayamaxProduct[] } };
  const raw = parsed?.crossDocking?.product;
  const list: HayamaxProduct[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const byCodigo = new Map<string, HayamaxProduct>();
  for (const p of list) {
    const c = String(p.prod_id ?? "").trim();
    if (!c) continue;
    byCodigo.set(c, p);
  }
  return Array.from(byCodigo.values()).map((p) => mapHayamaxProduct(fornecedorId, p));
}

const EVOLUSOM_API_URL = "https://api2.evolusom.com.br/v1/produtos/cliente";
const EVOLUSOM_PER_PAGE = 200;

type EvolusomTabela = { preco?: number | null; ipi?: number | null; estoque?: number | null; st?: number | null };
type EvolusomProduto = {
  codigo: number | string;
  nome?: string | null;
  unidade?: string | null;
  multiplo?: number | null;
  categorias?: Array<{ nome?: string; nivel?: number }>;
  cod_ean?: string | null;
  peso?: string | null;
  largura?: string | null;
  altura?: string | null;
  comprimento?: string | null;
  ncm?: string | null;
  marca?: string | null;
  imagens?: string[] | null;
  descricao?: { especificacao?: string | null; descricao?: string | null } | null;
  tabelas?: Record<string, EvolusomTabela | undefined> | null;
};

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)(\S)/g, (_m, a, b) => a + b.toUpperCase());

/**
 * Converte um produto da API Evolusom no mesmo formato que o XML antigo gravava:
 * preço e estoque sempre da tabela PR, preço por embalagem (preço unitário × múltiplo),
 * estoque em embalagens (unidades ÷ múltiplo) e medidas em centímetros.
 */
export function mapEvolusomApiProduct(fornecedorId: string, p: EvolusomProduto) {
  const mult = Math.max(1, Number(p.multiplo) || 1);
  const pr = p.tabelas?.PR ?? null;
  const es = p.tabelas?.ES ?? null;
  const unitPr = toNum(pr?.preco);
  const precoPr = unitPr != null ? Math.round(unitPr * mult * 100) / 100 : null;
  const unitEs = toNum(es?.preco);
  const unidadesPr = toNum(pr?.estoque);
  const qt = unidadesPr != null ? Math.max(0, Math.floor(unidadesPr / mult)) : 0;
  const cm = (v: unknown) => { const n = toNum(v); return n == null ? null : Math.round(n * 100 * 100) / 100; };
  const cats = (p.categorias ?? []).slice().sort((a, b) => (a.nivel ?? 0) - (b.nivel ?? 0))
    .map((c) => (c.nome ? titleCase(c.nome) : "")).filter(Boolean);
  return {
    fornecedor_id: fornecedorId,
    codigo: String(p.codigo ?? "").trim(),
    marca: toStr(p.marca),
    categoria: cats.length ? cats.join("/ ") : null,
    titulo: toStr(p.nome) ? titleCase(String(p.nome)) : null,
    nome_nota: toStr(p.nome) ? titleCase(String(p.nome)) : null,
    unidade: toStr(p.unidade),
    multiplo: mult,
    ipi: toNum(pr?.ipi),
    descricao_tecnica: toStr(p.descricao?.especificacao) ?? toStr(p.descricao?.descricao),
    estoque: qt > 0 ? "disponivel" : "indisponivel",
    qt_estoque: qt,
    peso: toNum(p.peso),
    altura: cm(p.altura),
    largura: cm(p.largura),
    comprimento: cm(p.comprimento),
    ncm: toStr(p.ncm),
    codigobarras: toStr(p.cod_ean),
    origem: "PR",
    foto: joinImages(p.imagens),
    precos: {
      PR: precoPr,
      base: precoPr,
      crossdocking: precoPr,
      ES: unitEs != null ? Math.round(unitEs * mult * 100) / 100 : null,
    } as Record<string, number | null>,
  };
}

async function fetchEvolusomPage(page: number, token: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${EVOLUSOM_API_URL}?page=${page}&per_page=${EVOLUSOM_PER_PAGE}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(55_000),
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 7_000)); continue; }
    if (res.status === 401 || res.status === 403) throw new Error("Token da Evolusom recusado. Atualize o token.");
    if (!res.ok) { if (attempt === 2) throw new Error(`Evolusom HTTP ${res.status}`); continue; }
    return (await res.json()) as { data: EvolusomProduto[]; meta: { current_page: number; last_page: number; total: number } };
  }
  throw new Error("Evolusom limitou as consultas; tente novamente em instantes.");
}

/**
 * Lê a API da Evolusom em partes (cada chamada processa páginas até o orçamento de tempo)
 * e guarda a próxima página em fornecedores.sync_cursor. Status "parcial" até terminar.
 */
export async function refreshEvolusomApi(supplierId: string, budgetMs = 45_000) {
  const token = process.env.EVOLUSOM_API_TOKEN;
  if (!token) throw new Error("Token da Evolusom não configurado.");
  const started = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = supabaseAdmin as any;
  const { data: row } = await admin.from("fornecedores").select("sync_cursor, sync_started_at").eq("id", supplierId).maybeSingle();
  let page = Math.max(1, Number(row?.sync_cursor) || 1);
  // Marca de tempo do início da leitura: quem não for atualizado nela é desativado ao concluir.
  let watermark: string | null = (row?.sync_started_at as string | null) ?? null;
  if (!row?.sync_cursor) {
    watermark = new Date().toISOString();
    await admin.from("fornecedores").update({
      sync_cursor: page, sync_started_at: watermark, last_sync_status: "parcial", last_sync_error: null,
    }).eq("id", supplierId);
  }
  let lastPage = page;
  let total = 0;
  try {
    while (true) {
      const r = await fetchEvolusomPage(page, token);
      lastPage = r.meta.last_page;
      total = r.meta.total;
      const mapped = new Map<string, ReturnType<typeof mapEvolusomApiProduct>>();
      for (const p of r.data ?? []) {
        const m = mapEvolusomApiProduct(supplierId, p);
        if (m.codigo) mapped.set(m.codigo, m);
      }
      const rows = Array.from(mapped.values());
      for (let i = 0; i < rows.length; i += 500) {
        const payload = rows.slice(i, i + 500).map((r) => ({ ...r, ativo: true }));
        const { error } = await supabaseAdmin.from("fornecedor_produtos")
          .upsert(payload as never, { onConflict: "fornecedor_id,codigo" });
        if (error) throw new Error(`Falha ao gravar produtos: ${error.message}`);
      }
      page++;
      if (page > lastPage) {
        // Leitura completa: apaga quem não apareceu mais na fonte.
        if (watermark && total > 0) {
          await admin.from("fornecedor_produtos").delete()
            .eq("fornecedor_id", supplierId).eq("ativo", true)
            .lt("updated_at", watermark);
        }
        await admin.from("fornecedores").update({
          sync_cursor: null, sync_started_at: null, last_sync_at: new Date().toISOString(), last_sync_status: "ok",
          last_sync_error: null, product_count: total,
        }).eq("id", supplierId);
        return { ok: true as const, total, done: true, page: lastPage, lastPage };
      }
      await admin.from("fornecedores").update({
        sync_cursor: page, last_sync_status: "parcial", last_sync_error: null,
      }).eq("id", supplierId);
      // Limite da Evolusom: 10 consultas por minuto.
      if (Date.now() - started > budgetMs - 20_000) {
        return { ok: true as const, total, done: false, page: page - 1, lastPage };
      }
      await new Promise((r) => setTimeout(r, 6_500));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("fornecedores").update({
      last_sync_at: new Date().toISOString(), last_sync_status: "erro", last_sync_error: msg.slice(0, 500),
    }).eq("id", supplierId);
    throw new Error(msg);
  }
}

export const SUPPLIERS: Record<string, SupplierDef> = {
  oderco: {
    codigo: "oderco",
    nome: "Oderço",
    url: "https://www.oderco.com.br/pages/integracao/intermediaria/codigo_pessoa/59336",
    parseAndMap: odercoParseAndMap,
  },
  hayamax: {
    codigo: "hayamax",
    nome: "Hayamax",
    url: "https://app.dslite.com.br/modules/admin/Empresa/getXMLCrossdocking/2/e0743a7eb7c9d9862de4204d1aed960d",
    parseAndMap: hayamaxParseAndMap,
  },
  evolusom: {
    codigo: "evolusom",
    nome: "Evolusom",
    url: EVOLUSOM_API_URL,
    // Lido pela API oficial em partes (refreshEvolusomApi); o XML antigo não é mais usado.
    parseAndMap: hayamaxParseAndMap,
  },
};

/** Ensures every registered supplier exists as a global row. */
export async function ensureSuppliersExist(): Promise<void> {
  for (const def of Object.values(SUPPLIERS)) {
    const { data: existing } = await supabaseAdmin
      .from("fornecedores")
      .select("id")
      .eq("codigo", def.codigo)
      .maybeSingle();
    if (!existing) {
      await supabaseAdmin.from("fornecedores").insert({
        company_id: null,
        codigo: def.codigo,
        nome: def.nome,
        source_type: def.codigo === "evolusom" ? "api" : "xml_url",
        source_url: def.url,
      });
    }
  }
}

/** Downloads the supplier XML feed and upserts its products. */
export async function refreshSupplier(
  codigo: string,
  opts?: { untilDone?: boolean },
): Promise<{ ok: true; total: number; done?: boolean; page?: number; lastPage?: number }> {
  const def = SUPPLIERS[codigo];
  if (!def) throw new Error(`Fornecedor não suportado: ${codigo}`);

  let { data: supplier } = await supabaseAdmin
    .from("fornecedores")
    .select("id, source_url")
    .eq("codigo", def.codigo)
    .maybeSingle();
  if (!supplier) {
    const ins = await supabaseAdmin
      .from("fornecedores")
      .insert({
        company_id: null,
        codigo: def.codigo,
        nome: def.nome,
        source_type: "xml_url",
        source_url: def.url,
      })
      .select("id, source_url")
      .single();
    supplier = ins.data;
  }
  if (!supplier) throw new Error(`Falha ao registrar fornecedor ${def.nome}`);

  const supplierId = supplier.id;
  if (def.codigo === "evolusom") {
    // Automações chamam até concluir (status "parcial" conta como desatualizado).
    void opts;
    return await refreshEvolusomApi(supplierId);
  }
  const url = supplier.source_url || def.url;

  try {
    const download = async () => {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/xml,text/xml,*/*" },
        // O XML do Oderço passou a demorar mais de 25 s; 90 s cobre o site lento
        // sem passar do tempo de espera da automação.
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`);
      return res.text();
    };
    let xml: string;
    try {
      xml = await download();
    } catch {
      xml = await download();
    }
    // Marca de tempo antes da gravação: quem não vier no XML é desativado ao final.
    const watermark = new Date().toISOString();

    const mapped = def.parseAndMap(xml, supplierId);

    const CHUNK = 500;
    for (let i = 0; i < mapped.length; i += CHUNK) {
      const chunk = mapped.slice(i, i + CHUNK).map((r) => ({ ...r, ativo: true }));
      const { error } = await supabaseAdmin
        .from("fornecedor_produtos")
        .upsert(chunk as never, { onConflict: "fornecedor_id,codigo" });
      if (error) throw new Error(`Falha ao gravar produtos: ${error.message}`);
    }
    if (mapped.length > 0) {
      await supabaseAdmin.from("fornecedor_produtos").delete()
        .eq("fornecedor_id", supplierId).eq("ativo", true).lt("updated_at", watermark);
    }

    await supabaseAdmin
      .from("fornecedores")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "ok",
        last_sync_error: null,
        product_count: mapped.length,
      })
      .eq("id", supplierId);

    return { ok: true, total: mapped.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseAdmin
      .from("fornecedores")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "erro",
        last_sync_error: msg.slice(0, 500),
      })
      .eq("id", supplierId);
    throw new Error(msg);
  }
}

/** Um passo da leitura contínua da Evolusom (chamado a cada minuto pelo agendador). */
export async function evolusomTick() {
  const { data: sup } = await supabaseAdmin.from("fornecedores")
    .select("id, last_sync_at, last_sync_status").eq("codigo", "evolusom").maybeSingle();
  if (!sup) return { skipped: "sem fornecedor" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cur } = await (supabaseAdmin as any).from("fornecedores").select("sync_cursor").eq("id", sup.id).maybeSingle();
  const age = sup.last_sync_at ? Date.now() - new Date(sup.last_sync_at).getTime() : Infinity;
  if (!cur?.sync_cursor && sup.last_sync_status === "ok" && age < 20 * 60 * 1000) return { skipped: "recente" };
  const holder = `evolusom:${Math.random().toString(36).slice(2)}`;
  const { data: got } = await supabaseAdmin.rpc("acquire_worker_lease", {
    _pool: "evolusom-refresh", _key: "evolusom-refresh", _holder: holder, _ttl_seconds: 90, _max_concurrent: 1,
  } as never);
  if (got !== true) return { skipped: "em andamento" };
  try {
    return await refreshEvolusomApi(sup.id);
  } finally {
    await supabaseAdmin.rpc("release_worker_lease", { _key: "evolusom-refresh", _holder: holder } as never);
  }
}
