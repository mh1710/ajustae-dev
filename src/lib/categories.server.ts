/** Consulta de categoria do catálogo do Mercado Livre; não altera cadastro no Bling. */
import { mlFetch, mlHttpError } from "./ml-http.server";

const API = "https://api.mercadolibre.com";

async function read(token: string | null, path: string): Promise<Record<string, unknown> | null> {
  const response = await mlFetch(`${API}${path}`, { token });
  if (response.status === 404) return null;
  if (!response.ok) throw await mlHttpError(response, "Mercado Livre recusou a consulta de categoria");
  return await response.json() as Record<string, unknown>;
}

function tokens(s: string) {
  return new Set(s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/).filter((t) => t.length > 1));
}

function similarity(a: string, b: string) {
  const left = tokens(a), right = tokens(b);
  if (!left.size) return 0;
  return [...left].filter((t) => right.has(t)).length / left.size;
}

type Candidate = { id: string; name: string; category_id: string | null };
async function search(token: string, query: string, ean = false): Promise<Candidate[]> {
  const param = ean ? `product_identifier=${encodeURIComponent(query)}` : `q=${encodeURIComponent(query)}`;
  const response = await read(token, `/products/search?site_id=MLB&status=active&${param}&limit=10`);
  const results = (response?.["results"] ?? []) as Array<Record<string, unknown>>;
  return results.filter((r) => typeof r.id === "string")
    .map((r) => ({ id: String(r.id), name: String(r.name ?? ""), category_id: typeof r.category_id === "string" ? r.category_id : null }));
}

const pathCache = new Map<string, string | null>();
async function categoryPath(id: string, fallback?: string) {
  if (!pathCache.has(id)) {
    const category = await read(null, `/categories/${encodeURIComponent(id)}`);
    const path = ((category?.["path_from_root"] as Array<{ name?: string }> | undefined) ?? [])
      .map((p) => p.name).filter(Boolean).join(" > ") || (category?.["name"] as string | undefined) || null;
    pathCache.set(id, path);
  }
  return pathCache.get(id) || fallback || null;
}

/** Classificador oficial do ML: devolve categorias (folha) para um texto. */
export async function discoverCategories(query: string) {
  const q = query.trim();
  if (q.length < 3) return [];
  const res = await read(null, `/sites/MLB/domain_discovery/search?q=${encodeURIComponent(q.slice(0, 120))}&limit=5`);
  const options = (Array.isArray(res) ? res : []) as Array<{ category_id?: string; category_name?: string }>;
  const out: { category_id: string; category_path: string }[] = [];
  for (const o of options) {
    const id = o.category_id;
    if (!id || !/^MLB\d+$/.test(id) || out.some((x) => x.category_id === id)) continue;
    const path = await categoryPath(id, o.category_name);
    if (path) out.push({ category_id: id, category_path: path });
  }
  return out;
}

export async function suggestMlCategory(token: string | null, ean: string | null, title: string | null) {
  const empty = { category_id: null, category_path: null, ml_product_id: null, ml_product_title: null,
    match_by: null, error: "Nenhum produto confiável encontrado." };
  const digits = (ean ?? "").replace(/\D/g, "");
  let candidate: Candidate | undefined;
  let matchBy: "ean" | "titulo" = "ean";
  if (token && digits.length >= 8) {
    try {
      const results = await search(token, digits, true);
      candidate = results.find((r) => r.id && (!title || similarity(title, r.name) >= 0.45));
    } catch { /* Catálogo indisponível: tentar classificação por título. */ }
  }
  const cleanTitle = (title ?? "").trim();
  if (!candidate && token && cleanTitle.length >= 4) {
    matchBy = "titulo";
    const query = cleanTitle.split(/\s+/).slice(0, 10).join(" ");
    try {
      const results = await search(token, query);
      candidate = results.sort((a, b) => similarity(cleanTitle, b.name) - similarity(cleanTitle, a.name))[0];
      if (candidate && similarity(cleanTitle, candidate.name) < 0.6) candidate = undefined;
    } catch { /* Catálogo indisponível: tentar classificação por título. */ }
  }
  if (!candidate && cleanTitle.length >= 4) {
    // O título completo às vezes não retorna nada; tenta versões mais curtas.
    const words = cleanTitle.split(/\s+/);
    const queries = [...new Set([cleanTitle.slice(0, 120), words.slice(0, 6).join(" "), words.slice(0, 3).join(" ")])];
    for (const q of queries) {
      const top = (await discoverCategories(q))[0];
      if (top) return { category_id: top.category_id, category_path: top.category_path, ml_product_id: null,
        ml_product_title: null, match_by: "categoria" as const, error: null };
    }
  }
  if (!candidate) return empty;
  const product = await read(token, `/products/${encodeURIComponent(candidate.id)}`);
  const id = (product?.["category_id"] as string | undefined) ?? candidate.category_id;
  if (!id) return { ...empty, error: "Produto encontrado sem categoria." };
  const category = await read(token, `/categories/${encodeURIComponent(id)}`);
  const path = ((category?.["path_from_root"] as Array<{name?: string}> | undefined) ?? [])
    .map((p) => p.name).filter(Boolean).join(" > ") || (category?.["name"] as string | undefined);
  if (!path) return { ...empty, error: "Categoria sem nome no Mercado Livre." };
  return { category_id: id, category_path: path, ml_product_id: candidate.id,
    ml_product_title: (product?.["name"] as string | undefined) ?? candidate.name,
    match_by: matchBy, error: null };
}