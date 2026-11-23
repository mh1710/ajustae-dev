/**
 * Busca o código de homologação Anatel de um produto na internet (server-only).
 *
 * Fluxo: busca no Google (Serper) pelo nome/marca/modelo → extrai candidatos no
 * formato oficial (NNNNN-NN-NNNNN) dos resultados e das páginas de produto →
 * a IA escolhe qual código pertence exatamente ao produto. Se o produto não
 * tiver rádio/transmissor (case, cabo, suporte...), a IA pode decidir "isento".
 * Se tiver rádio e nenhum código confiável aparecer, devolve null e o produto
 * fica marcado como "a verificar".
 */

import { callAI, serperSearch } from "@/lib/ai-transforms.server";

type Db = { from: (t: string) => any };

const ANATEL_RE = /\b(\d{5})-?(\d{2})-?(\d{5})\b/g;

function normalizeAnatel(m: RegExpMatchArray): string {
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), 12_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
      signal: controller.signal,
    });
    if (!res.ok) return "";
    return stripHtml(await res.text());
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function collectCandidates(text: string, out: Map<string, string>) {
  for (const m of text.matchAll(ANATEL_RE)) {
    const code = normalizeAnatel(m as unknown as RegExpMatchArray);
    if (out.has(code)) continue;
    const start = Math.max(0, (m.index ?? 0) - 90);
    out.set(code, text.slice(start, (m.index ?? 0) + m[0].length + 90).trim());
    if (out.size >= 6) return;
  }
}

const HAS_RADIO_RE =
  /bluetooth|wi-?fi|wireless|celular|smartphone|tablet|smartwatch|fone sem fio|r[áa]dio|transmissor|receptor|roteador|drone|controle remoto|starlink|antena 4g|antena 5g/i;

/**
 * Retorna o código Anatel (NNNNN-NN-NNNNN), "isento" ou null (não encontrado).
 */
export async function searchAnatelCode(
  nome: string,
  marca: string | null,
): Promise<{ code: string | null; isento: boolean }> {
  const base = `${marca ? `${marca} ` : ""}${nome}`.trim().slice(0, 140);
  const found = new Map<string, string>();

  const queries = [
    `${base} código homologação Anatel`,
    `${base} Anatel site:gov.br OR site:anatel.gov.br`,
  ];
  for (const q of queries) {
    const serper = await serperSearch(q);
    if (serper.text) collectCandidates(serper.text, found);
    if (found.size >= 2) break;
    const bodies = await Promise.all(serper.urls.slice(0, 3).map((u) => fetchText(u)));
    for (const b of bodies) if (b) collectCandidates(b, found);
    if (found.size >= 2) break;
  }

  const candidates = [...found.entries()].map(([code, context]) => ({ code, context }));
  const mightHaveRadio = HAS_RADIO_RE.test(base);

  if (candidates.length === 0) {
    if (!mightHaveRadio) return { code: null, isento: true };
    return { code: null, isento: false };
  }

  const answer = await callAI(
    "Você identifica o código de homologação Anatel (formato NNNNN-NN-NNNNN) de um produto. " +
      "Responda SOMENTE com o código no formato NNNNN-NN-NNNNN, a palavra ISENTO, ou a palavra NAO_ENCONTRADO. " +
      "Escolha um código apenas se o trecho indicar claramente o MESMO produto (mesma marca e mesmo modelo). " +
      "Responda ISENTO apenas se o produto claramente não possui rádio/transmissor (ex.: case, cabo, suporte, fonte, HD). " +
      "Na dúvida, responda NAO_ENCONTRADO.",
    `Produto: ${base}\n\nCandidatos encontrados na internet:\n` +
      candidates.map((c) => `- ${c.code}: "${c.context}"`).join("\n"),
  );

  const clean = (answer ?? "").trim();
  const m = clean.match(ANATEL_RE);
  if (m) {
    const parts = m[0].match(/\d+/g) ?? [];
    if (parts.length === 3) return { code: `${parts[0]}-${parts[1]}-${parts[2]}`, isento: false };
  }
  if (/isento/i.test(clean)) return { code: null, isento: true };
  if (!mightHaveRadio && candidates.length > 0) return { code: null, isento: false };
  return { code: null, isento: false };
}

/**
 * Preenche o "Código Anatel: a verificar" dos produtos recém-importados do
 * garimpo. Respeita um orçamento de tempo para a importação não travar; o que
 * faltar fica pendente e pode ser reprocessado.
 */
export async function fillAnatelForProducts(
  admin: Db,
  companyId: string,
  productIds: string[],
  budgetMs = 35_000,
): Promise<{ resolved: number; isento: number; pending: number }> {
  if (productIds.length === 0) return { resolved: 0, isento: 0, pending: 0 };
  const deadline = Date.now() + budgetMs;

  const { data: rows } = await admin
    .from("bling_products")
    .select("id, codigo, nome, marca, descricao_curta")
    .eq("company_id", companyId)
    .in("id", productIds)
    .ilike("descricao_curta", "%Código Anatel: a verificar%");

  const products = (rows ?? []) as Array<{
    id: string;
    codigo: string | null;
    nome: string | null;
    marca: string | null;
    descricao_curta: string | null;
  }>;

  let resolved = 0;
  let isentoCount = 0;
  let pending = 0;
  const queue = [...products];

  async function worker() {
    while (queue.length > 0 && Date.now() < deadline) {
      const p = queue.shift();
      if (!p) return;
      try {
        const result = await searchAnatelCode(p.nome ?? p.codigo ?? "", p.marca);
        const value = result.code ?? (result.isento ? "isento" : null);
        if (!value) {
          pending += 1;
          continue;
        }
        const nova = (p.descricao_curta ?? "").replace(
          /Código Anatel:\s*a verificar/i,
          `Código Anatel: ${value}`,
        );
        await admin
          .from("bling_products")
          .update({ descricao_curta: nova, dirty: true, updated_at: new Date().toISOString() })
          .eq("id", p.id);
        if (result.code) resolved += 1;
        else isentoCount += 1;
      } catch {
        pending += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: 6 }, () => worker()));
  pending += queue.length;
  return { resolved, isento: isentoCount, pending };
}

/**
 * Encurta para no máximo 60 caracteres, com IA, apenas os títulos que passam
 * desse limite. Títulos com 60 ou menos ficam exatamente como vieram do
 * Mercado Livre.
 */
export async function shortenTitlesForProducts(
  admin: Db,
  companyId: string,
  productIds: string[],
  maxLength = 60,
  budgetMs = 20_000,
): Promise<{ shortened: number; kept: number; failed: number }> {
  if (productIds.length === 0) return { shortened: 0, kept: 0, failed: 0 };
  const deadline = Date.now() + budgetMs;

  const { data: rows } = await admin
    .from("bling_products")
    .select("id, nome")
    .eq("company_id", companyId)
    .in("id", productIds);

  const all = (rows ?? []) as Array<{ id: string; nome: string | null }>;
  const queue = all.filter((p) => (p.nome ?? "").length > maxLength);
  const kept = all.length - queue.length;
  let shortened = 0;
  let failed = 0;

  const { callAI: ai, SYSTEM_SHORTEN_TITLE } = await import("@/lib/ai-transforms.server").then(
    (m) => ({
      callAI: m.callAI,
      SYSTEM_SHORTEN_TITLE:
        "Você reescreve títulos de produtos de e-commerce em português (Brasil). " +
        `Reduza o título para no máximo ${maxLength} caracteres SEM mudar o sentido do título original. ` +
        "O título deve COMEÇAR pelo tipo/nome do produto exatamente como aparece no original. " +
        "Ordem recomendada: tipo do produto + marca + modelo + especificações essenciais. " +
        "Remova apenas termos redundantes, genéricos ou de marketing; nunca informações técnicas. " +
        "Responda SOMENTE com o novo título.",
    }),
  );

  async function worker() {
    while (queue.length > 0 && Date.now() < deadline) {
      const p = queue.shift();
      if (!p) return;
      const before = (p.nome ?? "").trim();
      try {
        let after = await ai(
          SYSTEM_SHORTEN_TITLE,
          `Título atual (${before.length} caracteres):\n${before}`,
        );
        after = after.replace(/^["'`]|["'`]$/g, "").trim();
        if (after.length > maxLength) {
          const cut = after.slice(0, maxLength);
          const sp = cut.lastIndexOf(" ");
          after = (sp > 20 ? cut.slice(0, sp) : cut).trim().replace(/[-–|,]+$/, "").trim();
        }
        if (!after || after === before) {
          failed += 1;
          continue;
        }
        await admin
          .from("bling_products")
          .update({
            nome: after,
            descricao_complementar: after,
            dirty: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", p.id);
        shortened += 1;
      } catch {
        failed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: 6 }, () => worker()));
  failed += queue.length;
  return { shortened, kept, failed };
}
