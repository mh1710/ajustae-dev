import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listSuppliers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ensureSuppliersExist } = await import("@/lib/suppliers-sync.server");
    await ensureSuppliersExist();

    const { data: rows, error } = await context.supabase
      .from("fornecedores")
      .select("id, codigo, nome, source_type, source_url, last_sync_at, last_sync_status, last_sync_error, product_count, created_at, preco_embalagem, preco_transporte, taxa_devolucao, taxa_promocao, stock_cap")
      .order("nome", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const updateSupplierFees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      id: z.string().uuid(),
      preco_embalagem: z.number().min(0),
      preco_transporte: z.number().min(0),
      taxa_devolucao: z.number().min(0).max(100),
      taxa_promocao: z.number().min(0).max(100),
      stock_cap: z.number().int().min(0).nullable().optional(),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, stock_cap, ...rest } = data;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = { ...rest };
    if (stock_cap !== undefined) patch.stock_cap = stock_cap;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabaseAdmin.from("fornecedores").update(patch as any).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ codigo: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { refreshSupplier } = await import("@/lib/suppliers-sync.server");
    return await refreshSupplier(data.codigo);
  });


export const listSupplierProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      fornecedor_id: z.string().uuid(),
      search: z.string().trim().optional(),
      page: z.number().int().min(1).optional(),
      page_size: z.number().int().min(1).max(200).optional(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const page = data.page ?? 1;
    const pageSize = data.page_size ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let q = context.supabase
      .from("fornecedor_produtos")
      .select("id, codigo, titulo, marca, qt_estoque, codigobarras, precos, foto", { count: "exact" })
      .eq("fornecedor_id", data.fornecedor_id)
      .eq("ativo", true)
      .order("titulo", { ascending: true })
      .range(from, to);
    if (data.search) {
      const s = data.search.replace(/[%_]/g, "");
      q = q.or(`titulo.ilike.%${s}%,codigo.ilike.%${s}%,codigobarras.ilike.%${s}%`);
    }
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0 };
  });

// ============ Gap analysis: supplier vs company ============

const PREFIX_BY_SUPPLIER: Record<string, string[]> = {
  oderco: ["ODS", "O"],
  hayamax: ["HX", "HA"],
  evolusom: ["EV", "E"],
};

function parseSku(sku: string): { prefix: string; numeric: string } | null {
  const m = (sku ?? "").trim().match(/^([A-Za-z]+)(.*)$/);
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), numeric: (m[2] ?? "").trim() };
}

type SupaLike = { from: (t: string) => any };

async function fetchAllBlingByPrefixes(
  supabase: SupaLike,
  companyId: string,
  prefixes: string[],
): Promise<{ codigo: string; situacao: string | null }[]> {
  if (prefixes.length === 0) return [];
  const firstLetters = Array.from(new Set(prefixes.map((p) => p[0].toUpperCase())));
  const orExpr = firstLetters.map((l) => `codigo.ilike.${l}%`).join(",");
  const out: { codigo: string; situacao: string | null }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("bling_products")
      .select("codigo, situacao")
      .eq("company_id", companyId)
      .or(orExpr)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { codigo: string; situacao: string | null }[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchAllSupplierCodes(
  supabase: SupaLike,
  fornecedorId: string,
): Promise<Set<string>> {
  const set = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("fornecedor_produtos")
      .select("codigo")
      .eq("fornecedor_id", fornecedorId)
      .eq("ativo", true)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { codigo: string }[];
    for (const r of rows) {
      const c = String(r.codigo ?? "").trim();
      if (c) set.add(c);
    }
    if (rows.length < PAGE) break;
  }
  return set;
}

async function computeGap(
  supabase: SupaLike,
  fornecedorId: string,
  companyId: string,
) {
  const { data: sup, error: se } = await supabase
    .from("fornecedores")
    .select("codigo, nome")
    .eq("id", fornecedorId)
    .maybeSingle();
  if (se) throw new Error(se.message);
  if (!sup) throw new Error("Fornecedor não encontrado");
  const prefixes = PREFIX_BY_SUPPLIER[sup.codigo as string] ?? [];
  const [supCodes, blingRows] = await Promise.all([
    fetchAllSupplierCodes(supabase, fornecedorId),
    fetchAllBlingByPrefixes(supabase, companyId, prefixes),
  ]);
  const activeNumerics = new Set<string>();
  const inactiveNumerics = new Set<string>();
  for (const r of blingRows) {
    const parsed = parseSku(r.codigo);
    if (!parsed || !prefixes.includes(parsed.prefix) || !parsed.numeric) continue;
    const s = String(r.situacao ?? "").trim().toUpperCase();
    const isActive = s === "A" || s === "ATIVO";
    if (isActive) activeNumerics.add(parsed.numeric);
    else inactiveNumerics.add(parsed.numeric);
  }
  const missingCodes: string[] = [];
  const inactiveCodes: string[] = [];
  for (const code of supCodes) {
    if (activeNumerics.has(code)) continue;
    if (inactiveNumerics.has(code)) inactiveCodes.push(code);
    else missingCodes.push(code);
  }
  return {
    supplierCodigo: sup.codigo as string,
    supplierNome: sup.nome as string,
    total: supCodes.size,
    missingCodes,
    inactiveCodes,
  };
}

export const getSupplierGapStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      fornecedor_id: z.string().uuid(),
      company_id: z.string().uuid(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const r = await computeGap(context.supabase, data.fornecedor_id, data.company_id);
    return { total: r.total, missing: r.missingCodes.length, inactive: r.inactiveCodes.length };
  });

export const listSupplierGapProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      fornecedor_id: z.string().uuid(),
      company_id: z.string().uuid(),
      kind: z.enum(["missing", "inactive"]),
      search: z.string().trim().optional(),
      page: z.number().int().min(1).optional(),
      page_size: z.number().int().min(1).max(500).optional(),
      all: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const gap = await computeGap(context.supabase, data.fornecedor_id, data.company_id);
    const target = data.kind === "missing" ? gap.missingCodes : gap.inactiveCodes;
    if (target.length === 0) return { rows: [], count: 0, supplierCodigo: gap.supplierCodigo };
    const detailsMap = new Map<string, any>();
    const CHUNK = 200;
    for (let i = 0; i < target.length; i += CHUNK) {
      const slice = target.slice(i, i + CHUNK);
      const { data: rows, error } = await context.supabase
        .from("fornecedor_produtos")
        .select("id, codigo, titulo, marca, qt_estoque, codigobarras, precos, foto, ncm, peso, altura, largura, comprimento, categoria, tempo_garantia")
        .eq("fornecedor_id", data.fornecedor_id)
        .eq("ativo", true)
        .in("codigo", slice);
      if (error) throw new Error(error.message);
      for (const r of (rows ?? []) as any[]) detailsMap.set(String(r.codigo), r);
    }
    let all = Array.from(detailsMap.values());
    const search = data.search?.replace(/[%_]/g, "").trim();
    if (search) {
      const s = search.toLowerCase();
      all = all.filter((r) =>
        String(r.titulo ?? "").toLowerCase().includes(s) ||
        String(r.codigo ?? "").toLowerCase().includes(s) ||
        String(r.codigobarras ?? "").toLowerCase().includes(s),
      );
    }
    all.sort((a, b) => String(a.titulo ?? "").localeCompare(String(b.titulo ?? "")));
    const count = all.length;
    if (data.all) return { rows: all, count, supplierCodigo: gap.supplierCodigo };
    const page = data.page ?? 1;
    const pageSize = data.page_size ?? 50;
    const from = (page - 1) * pageSize;
    const rows = all.slice(from, from + pageSize);
    return { rows, count, supplierCodigo: gap.supplierCodigo };
  });
// ============ Fornecedores alternativos (consulta por EAN) ============

const PREFIX_TO_SUPPLIER: Record<string, string> = {
  ODS: "oderco", O: "oderco", HX: "hayamax", HA: "hayamax", EV: "evolusom", E: "evolusom",
};

function supplierPrice(precos: unknown): number | null {
  const p = (precos ?? {}) as Record<string, unknown>;
  for (const k of ["PR", "base", "dropshipping", "crossdocking"]) {
    const n = Number(p[k]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export type AlternativeSupplierRow = {
  fornecedor_id: string;
  fornecedor_codigo: string;
  fornecedor_nome: string;
  primary: boolean;
  found: boolean;
  matched_by: "ean" | "codigo" | null;
  codigo: string | null;
  titulo: string | null;
  marca: string | null;
  preco: number | null;
  qt_estoque: number | null;
  estoque: string | null;
  foto: string | null;
  last_sync_at: string | null;
};

/**
 * Para um produto, procura o mesmo EAN em todos os fornecedores cadastrados.
 * O fornecedor "1" é o do produto (pelo prefixo do SKU); nele também tentamos
 * pelo código numérico do SKU caso o EAN não bata.
 */
export const getAlternativeSuppliers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sku: z.string().optional().nullable(), ean: z.string().optional().nullable() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ean: string | null; rows: AlternativeSupplierRow[] }> => {
    const ean = (data.ean ?? "").replace(/\D/g, "") || null;
    const parsed = parseSku(data.sku ?? "");
    const primaryCodigo = parsed ? PREFIX_TO_SUPPLIER[parsed.prefix] ?? null : null;

    const { data: sups, error } = await context.supabase
      .from("fornecedores")
      .select("id, codigo, nome, last_sync_at")
      .order("nome", { ascending: true });
    if (error) throw new Error(error.message);

    const cols = "fornecedor_id, codigo, titulo, marca, precos, qt_estoque, estoque, foto, codigobarras";
    const byEan = new Map<string, any>();
    if (ean) {
      const { data: hits, error: e2 } = await context.supabase
        .from("fornecedor_produtos")
        .select(cols)
        .eq("codigobarras", ean)
        .eq("ativo", true);
      if (e2) throw new Error(e2.message);
      for (const h of hits ?? []) if (!byEan.has(h.fornecedor_id)) byEan.set(h.fornecedor_id, h);
    }

    const rows: AlternativeSupplierRow[] = [];
    for (const s of sups ?? []) {
      const primary = s.codigo === primaryCodigo;
      let hit = byEan.get(s.id) ?? null;
      let matched: "ean" | "codigo" | null = hit ? "ean" : null;
      if (!hit && primary && parsed?.numeric) {
        const { data: h2 } = await context.supabase
          .from("fornecedor_produtos")
          .select(cols)
          .eq("fornecedor_id", s.id)
          .eq("codigo", parsed.numeric)
          .eq("ativo", true)
          .maybeSingle();
        if (h2) { hit = h2; matched = "codigo"; }
      }
      rows.push({
        fornecedor_id: s.id,
        fornecedor_codigo: s.codigo,
        fornecedor_nome: s.nome,
        primary,
        found: !!hit,
        matched_by: matched,
        codigo: hit?.codigo ?? null,
        titulo: hit?.titulo ?? null,
        marca: hit?.marca ?? null,
        preco: hit ? supplierPrice(hit.precos) : null,
        qt_estoque: hit?.qt_estoque ?? null,
        estoque: hit?.estoque ?? null,
        foto: hit?.foto ?? null,
        last_sync_at: s.last_sync_at ?? null,
      });
    }
    rows.sort((a, b) => Number(b.primary) - Number(a.primary) || Number(b.found) - Number(a.found));
    return { ean, rows };
  });

/** Todos os produtos de um fornecedor com todos os dados, para planilha. */
export const exportSupplierProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ fornecedor_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error } = await context.supabase
        .from("fornecedor_produtos")
        .select("codigo, titulo, nome_nota, marca, categoria, codigobarras, ncm, unidade, multiplo, ipi, qt_estoque, estoque, precos, peso, altura, largura, comprimento, origem, tempo_garantia, foto, descricao_tecnica, updated_at")
        .eq("fornecedor_id", data.fornecedor_id)
        .eq("ativo", true)
        .order("codigo", { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      rows.push(...((page ?? []) as Record<string, unknown>[]));
      if (!page || page.length < 1000) break;
    }
    return rows.map((r) => {
      const precos = (r.precos ?? {}) as Record<string, number | null>;
      const { precos: _p, ...rest } = r;
      void _p;
      return { ...rest, preco_custo: precos.PR ?? precos.base ?? precos.crossdocking ?? precos.dropshipping ?? null } as Record<string, string | number | null>;
    });
  });
