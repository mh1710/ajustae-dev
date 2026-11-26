/**
 * Motor das transformações de IA em segundo plano.
 *
 * Toda a conversa com a IA acontece aqui, e o progresso é gravado produto por
 * produto na fila `ai_transform_jobs` / `ai_transform_job_items`, para que uma
 * execução interrompida continue exatamente de onde parou.
 */
import { AI_FEATURES_ENABLED, AI_DISABLED_MESSAGE } from "@/lib/ai-features";
import { descriptionPlainText, descriptionVisibleLength } from "@/lib/description-text";

const FIREWORKS_API_URL = "https://api.fireworks.ai/inference/v1/chat/completions";
const MODEL = "accounts/fireworks/models/deepseek-v4p1-flash";

/** Intervalo mínimo entre chamadas à IA (adaptativo a partir daqui). */
export const AI_MIN_REQUEST_INTERVAL_MS = 40;
export const AI_MAX_REQUEST_INTERVAL_MS = 10_000;
const AI_MAX_ATTEMPTS = 4;
const AI_REQUEST_TIMEOUT_MS = 45_000;

/** Quantas chamadas simultâneas à IA são permitidas (adaptativo). */
export const AI_MIN_CONCURRENCY = 2;
export const AI_MAX_CONCURRENCY = 48;
const AI_START_CONCURRENCY = 16;
/** Acertos seguidos necessários para liberar mais chamadas simultâneas. */
const AI_SUCCESSES_TO_SPEED_UP = 3;
/** Quantas vagas a mais são liberadas a cada sequência de acertos. */
const AI_CONCURRENCY_STEP = 4;

let aiRequestIntervalMs = AI_MIN_REQUEST_INTERVAL_MS;
let lastAiRequestStartedAt = 0;
let aiConcurrency = AI_START_CONCURRENCY;
let aiInFlight = 0;
let aiSuccessStreak = 0;
let aiSlotWaiters: Array<() => void> = [];

/** Espera uma vaga entre as chamadas simultâneas permitidas no momento. */
async function acquireAiSlot() {
  while (aiInFlight >= aiConcurrency) {
    await new Promise<void>((resolve) => aiSlotWaiters.push(resolve));
  }
  aiInFlight++;
}

function releaseAiSlot() {
  aiInFlight = Math.max(0, aiInFlight - 1);
  const waiters = aiSlotWaiters;
  aiSlotWaiters = [];
  for (const w of waiters) w();
}

/** Quantos produtos processar em paralelo agora. */
export function currentAiConcurrency() {
  return aiConcurrency;
}

/** Falta de créditos / chave inválida: interrompe a fila inteira. */
export class AiCreditsError extends Error {}
/** Limite de requisições persistente: estaciona até a próxima rodada. */
export class AiRateLimitError extends Error {
  constructor(
    message: string,
    readonly retryInSeconds: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Espaça as chamadas no tempo. Com várias chamadas simultâneas, o intervalo é
 * dividido entre elas — assim a vazão cresce junto com a simultaneidade, mas
 * qualquer 429 volta a apertar o ritmo (ver callAIExclusive).
 */
async function waitForAiRequestSlot() {
  const spacing = Math.max(5, Math.round(aiRequestIntervalMs / Math.max(1, aiConcurrency)));
  const now = Date.now();
  const startAt = Math.max(now, lastAiRequestStartedAt + spacing);
  lastAiRequestStartedAt = startAt;
  const waitMs = startAt - now;
  if (waitMs > 0) await sleep(waitMs);
}

async function callAIExclusive(system: string, user: string): Promise<string> {
  const key = process.env.FIREWORKS_API_KEY;
  if (!key) throw new AiCreditsError("FIREWORKS_API_KEY ausente no servidor.");

  for (let attempt = 0; attempt < AI_MAX_ATTEMPTS; attempt++) {
    await waitForAiRequestSlot();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), AI_REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(FIREWORKS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          // Modelo de raciocínio: sem isso o orçamento de tokens vai todo para o
          // "reasoning_content" e o texto final volta vazio.
          reasoning_effort: "none",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("A IA demorou mais de 45 segundos neste produto.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 3_000 * 2 ** attempt;
      aiRequestIntervalMs = Math.min(
        AI_MAX_REQUEST_INTERVAL_MS,
        Math.max(
          Math.ceil(aiRequestIntervalMs * 1.5),
          Math.min(waitMs, AI_MAX_REQUEST_INTERVAL_MS),
        ),
      );
      // Menos chamadas simultâneas na hora: é o que realmente faz o 429 parar.
      aiConcurrency = Math.max(
        AI_MIN_CONCURRENCY,
        Math.floor(aiConcurrency / 2) || AI_MIN_CONCURRENCY,
      );
      aiSuccessStreak = 0;
      if (attempt === AI_MAX_ATTEMPTS - 1) {
        throw new AiRateLimitError(
          "Limite de requisições da IA atingido; a fila continua na próxima rodada.",
          Math.ceil(waitMs / 1_000),
        );
      }
      await sleep(waitMs + Math.floor(Math.random() * 400));
      continue;
    }
    if (res.status === 401)
      throw new AiCreditsError("Chave de API da Fireworks inválida ou ausente.");
    if (res.status === 402 || res.status === 403) {
      throw new AiCreditsError("Créditos de IA esgotados ou acesso bloqueado na conta Fireworks.");
    }
    if (!res.ok)
      throw new Error(`Falha na IA (${res.status}): ${(await res.text()).slice(0, 200)}`);

    const json = (await res.json()) as any;
    const msg = json?.choices?.[0]?.message;
    const txt = typeof msg?.content === "string" ? msg.content : "";
    if (!txt.trim()) throw new Error("Resposta vazia da IA (raciocínio consumiu os tokens).");
    // Recupera velocidade rapidamente depois de respostas bem-sucedidas.
    aiRequestIntervalMs = Math.max(AI_MIN_REQUEST_INTERVAL_MS, Math.floor(aiRequestIntervalMs / 2));
    aiSuccessStreak++;
    if (aiSuccessStreak >= AI_SUCCESSES_TO_SPEED_UP && aiConcurrency < AI_MAX_CONCURRENCY) {
      aiConcurrency = Math.min(AI_MAX_CONCURRENCY, aiConcurrency + AI_CONCURRENCY_STEP);
      aiSuccessStreak = 0;
    }
    return txt.trim();
  }
  throw new Error("Não foi possível concluir a solicitação à IA.");
}

/** Chamada à IA respeitando a simultaneidade e o espaçamento adaptativos. */
export async function callAI(system: string, user: string): Promise<string> {
  await acquireAiSlot();
  try {
    return await callAIExclusive(system, user);
  } finally {
    releaseAiSlot();
  }
}

/* ========================= Prompts ========================= */

const SYSTEM_SHORTEN =
  "Você reescreve títulos de produtos de e-commerce em português (Brasil). " +
  "Reduza o título para no máximo {N} caracteres SEM mudar o sentido do título original. " +
  "REGRA PRINCIPAL: o título deve COMEÇAR pelo tipo/nome do produto exatamente como aparece no original " +
  "(ex.: 'Access Point', 'Roteador', 'Fone de Ouvido', 'Cabo HDMI'). Nunca mova o tipo do produto para o final " +
  "nem comece pela marca ou pelo código do modelo. " +
  "Ordem recomendada: tipo do produto + marca + modelo + especificações essenciais (padrão, capacidade, cor, tamanho). " +
  "Para encurtar, remova apenas termos redundantes, genéricos ou de marketing (ex.: 'smb', 'novo', 'original', repetições), " +
  "nunca informações técnicas relevantes. " +
  "Preserve a grafia de marcas, modelos e siglas como no original (ex.: 'MU-MIMO', 'EAP235-Wall', 'AC1200'). " +
  "Nunca invente informações nem traduza termos técnicos. " +
  "Responda APENAS com o novo título, sem aspas, sem comentários, sem prefixos.";

const SYSTEM_REMOVE_WARRANTY =
  "Você edita descrições curtas de produtos em português (Brasil). " +
  "Remova qualquer frase ou expressão que se refira a GARANTIA (ex.: 'garantia de X meses', 'garantia estendida', " +
  "'tempo garantido', 'garantia do fabricante', 'assegurado por X anos', etc.) e qualquer menção ao CÓDIGO ANATEL " +
  "(ex.: 'Código Anatel: xxxx', 'Anatel: isento', 'homologação Anatel xxxx'). " +
  "Preserve TODO o restante do texto sem parafrasear. Ajuste apenas pontuação/espaços após a remoção. " +
  "Se após a remoção não sobrar conteúdo relevante, devolva string vazia. " +
  "Responda APENAS com o texto final, sem aspas, sem comentários.";

const SYSTEM_EXPAND_SHORT_DESC =
  "Você é um redator de e-commerce em português (Brasil) focado em SEO. " +
  "Reescreva a DESCRIÇÃO CURTA do produto para ter NO MÍNIMO {N} caracteres (idealmente entre {N} e {N}+80). " +
  "REGRA PRINCIPAL: a essência do produto não pode se perder — o texto deve COMEÇAR pelo tipo do produto e " +
  "citar marca, modelo e todas as especificações que aparecem no nome ou no texto original (potência, capacidade, " +
  "tamanho, cor, voltagem, padrão técnico, quantidade). Nada disso pode ser omitido nem alterado. " +
  "Preserve integralmente todas as informações e especificações presentes no texto original e no nome do produto. " +
  "Enriqueça com palavras-chave naturais e relevantes para SEO (marca, categoria, uso, benefícios), sem repetir termos artificialmente e sem inventar especificações, medidas, prazos, garantias, códigos, compatibilidades ou dados que não estejam no original. " +
  "PROIBIDO EXPLICAR A FUNÇÃO DO PRODUTO SE ELA NÃO ESTIVER EXPLÍCITA: nunca afirme para que serve, como funciona, onde se instala, o que substitui ou o que o produto faz, a menos que isso esteja escrito no nome ou no texto original. " +
  "Se você não tiver certeza absoluta da finalidade do item, NÃO deduza nem suponha: apenas descreva o que está no nome (tipo, marca, modelo, especificações, compatibilidade citada) e complete o texto com o TEXTO PADRÃO DA EMPRESA, sem atribuir função alguma ao produto. " +
  'O TEXTO PADRÃO DA EMPRESA é exatamente este (use literalmente, sem alterar): "Nossa loja preza pela qualidade dos nossos produtos e serviços, oferecendo itens selecionados de marcas confiáveis. Consulte sempre as especificações técnicas na descrição para garantir a escolha certa para a sua necessidade." ' +
  "Errar a finalidade do produto é uma falha grave; um texto genérico e correto (tipo+marca+modelo+especificações+texto padrão da empresa) é sempre preferível a um texto específico e inventado. " +
  "Escreva em texto puro (sem HTML), tom claro e vendedor, frases completas. " +
  "Responda APENAS com o novo texto da descrição curta, sem aspas, sem comentários, sem prefixos.";

const SYSTEM_FIND_EAN =
  "Você é um especialista em catálogos de produtos e códigos de barras GTIN/EAN do varejo brasileiro. " +
  "Você recebe o produto e uma lista de códigos candidatos extraídos de resultados de busca na web, cada um com o trecho onde apareceu. " +
  "Escolha o código que pertence EXATAMENTE a esse produto (mesma marca, mesmo modelo, mesma variação/cor/capacidade/voltagem). " +
  "Regras rígidas: responda APENAS os dígitos do código escolhido, sem espaços, sem texto, sem explicação. " +
  "Se nenhum candidato corresponder com certeza a esse produto específico, responda exatamente: DESCONHECIDO. " +
  "NUNCA invente, estime, corrija ou gere um código que não esteja na lista de candidatos.";

export const WARRANTY_ANATEL_RX =
  /(?:garant(?:ia|ias|imos|id[oa]s?)|assegurad[oa]s?|anatel|homologa(?:ção|cao))/i;

export function removeWarrantyAnatelFragments(value: string) {
  const text = value.replace(/\r\n/g, "\n");
  const parts = text.split(/([.!?;|\n\r•])/);
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const chunk = parts[i] ?? "";
    const sep = parts[i + 1] ?? "";
    if (!WARRANTY_ANATEL_RX.test(chunk)) kept.push(chunk + sep);
  }
  return kept
    .join("")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?:^\s*[|;,.\-–—]+\s*)|(?:\s*[|;,.\-–—]+\s*$)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Valida dígito verificador de GTIN-8/12/13/14. */
export function isValidGtin(v: string) {
  const d = v.replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(d.length)) return false;
  if (/^0+$/.test(d)) return false;
  const digits = d.split("").map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  for (let i = digits.length - 1, mult = 3; i >= 0; i--, mult = mult === 3 ? 1 : 3) {
    sum += digits[i] * mult;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/* ===================== Busca de EAN na web ===================== */

type EanCandidate = { code: string; context: string };

async function fetchSearchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), 15_000);
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
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function extractEanCandidates(html: string, out: Map<string, string>) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");
  for (const match of text.matchAll(/\b\d{12,14}\b/g)) {
    const code = match[0];
    if (!isValidGtin(code) || out.has(code)) continue;
    const start = Math.max(0, (match.index ?? 0) - 90);
    out.set(code, text.slice(start, (match.index ?? 0) + code.length + 90).trim());
    if (out.size >= 8) return;
  }
}

/** URLs dos resultados de uma página de busca do DuckDuckGo. */
function extractResultUrls(html: string, limit: number) {
  const urls: string[] = [];
  for (const m of html.matchAll(/uddg=([^"&]+)/g)) {
    try {
      const u = decodeURIComponent(m[1]);
      if (/^https?:\/\//.test(u) && !urls.includes(u)) urls.push(u);
    } catch {
      /* ignora link inválido */
    }
    if (urls.length >= limit) break;
  }
  return urls;
}

/** Procura códigos marcados como EAN/GTIN dentro de uma página de produto. */
function extractEanFromProductPage(html: string, out: Map<string, string>) {
  for (const m of html.matchAll(/gtin1?[2348]?"?\s*[:=]\s*"?(\d{12,14})/gi)) {
    const code = m[1];
    if (isValidGtin(code) && !out.has(code)) out.set(code, "campo GTIN da página do produto");
  }
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const m of text.matchAll(/(?:ean|gtin|c[oó]digo de barras)[^0-9]{0,40}(\d{12,14})/gi)) {
    const code = m[1];
    if (!isValidGtin(code) || out.has(code)) continue;
    const start = Math.max(0, (m.index ?? 0) - 90);
    out.set(code, text.slice(start, (m.index ?? 0) + m[0].length + 60).trim());
  }
}

/**
 * Busca no Google via Serper (quando a chave está configurada). Devolve o texto
 * dos resultados e os links das páginas de produto.
 */
export async function serperSearch(query: string): Promise<{ text: string; urls: string[] }> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return { text: "", urls: [] };
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "br", hl: "pt-br", num: 10 }),
    });
    if (!res.ok) return { text: "", urls: [] };
    const json = (await res.json()) as any;
    const organic: any[] = Array.isArray(json?.organic) ? json.organic : [];
    return {
      text: organic.map((o) => `${o?.title ?? ""} ${o?.snippet ?? ""}`).join(" \n "),
      urls: organic.map((o) => String(o?.link ?? "")).filter((u) => /^https?:\/\//.test(u)),
    };
  } catch {
    return { text: "", urls: [] };
  }
}

/**
 * Procura códigos EAN/GTIN reais na web a partir do título do produto: primeiro
 * nos resultados da busca, depois dentro das páginas de produto encontradas.
 * Só devolve códigos com dígito verificador válido, junto do trecho onde
 * apareceram — quem decide qual pertence ao produto é a IA.
 */
export async function searchEanCandidates(nome: string, marca: string): Promise<EanCandidate[]> {
  const base = `${marca ? `${marca} ` : ""}${nome}`.trim().slice(0, 140);
  const queries = [`${base} EAN código de barras`, `${base} GTIN EAN-13`];
  const found = new Map<string, string>();
  for (const q of queries) {
    const encoded = encodeURIComponent(q);
    const serper = await serperSearch(q);
    if (serper.text) extractEanCandidates(serper.text, found);
    if (found.size >= 2) break;

    const pages = serper.urls.length
      ? []
      : await Promise.all([
          fetchSearchHtml(`https://html.duckduckgo.com/html/?q=${encoded}`),
          fetchSearchHtml(`https://lite.duckduckgo.com/lite/?q=${encoded}`),
        ]);
    for (const page of pages) if (page) extractEanCandidates(page, found);
    if (found.size >= 2) break;

    // Nada nos resumos: abre as primeiras páginas de produto e procura lá.
    const urls = (
      serper.urls.length
        ? serper.urls
        : pages.flatMap((page) => (page ? extractResultUrls(page, 3) : []))
    ).slice(0, 4);
    const bodies = await Promise.all(urls.map((u) => fetchSearchHtml(u)));
    for (const body of bodies) if (body) extractEanFromProductPage(body, found);
    if (found.size >= 2) break;
  }
  return [...found.entries()].slice(0, 8).map(([code, context]) => ({ code, context }));
}

/* ========================= Processamento por produto ========================= */

export type AiJobKind = "shorten_title" | "remove_warranty" | "expand_short_desc" | "find_ean";

type ProductRow = {
  id: string;
  codigo: string | null;
  nome: string | null;
  descricao_curta: string | null;
  gtin: string | null;
  marca: string | null;
};

const clean = (t: string) =>
  t
    .replace(/^["'`]|["'`]$/g, "")
    .trim()
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Processa um produto; devolve se o produto foi realmente alterado. */
async function processProduct(
  admin: any,
  kind: AiJobKind,
  params: Record<string, unknown>,
  companyId: string,
  row: ProductRow,
): Promise<boolean> {
  const patch = async (fields: Record<string, unknown>) => {
    const { error } = await admin
      .from("bling_products")
      .update({ ...fields, dirty: true, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
  };

  if (kind === "shorten_title") {
    const maxLength = Number(params.max_length ?? 60);
    const before = (row.nome ?? "").toString();
    if (!before || before.length <= maxLength) return false;
    let after = await callAI(
      SYSTEM_SHORTEN.replaceAll("{N}", String(maxLength)),
      `Título atual (${before.length} chars):\n${before}\n\n` +
        "Lembre-se: o novo título deve começar pelo tipo do produto usado no original e manter o mesmo sentido.",
    );
    after = after.replace(/^["'`]|["'`]$/g, "").trim();
    if (after.length > maxLength) {
      const cut = after.slice(0, maxLength);
      const sp = cut.lastIndexOf(" ");
      after = (sp > 20 ? cut.slice(0, sp) : cut)
        .trim()
        .replace(/[-–|,]+$/, "")
        .trim();
    }
    if (!after) throw new Error("IA devolveu vazio.");
    await patch({ nome: after });
    return true;
  }

  if (kind === "remove_warranty") {
    const before = (row.descricao_curta ?? "").toString();
    if (!before || !WARRANTY_ANATEL_RX.test(before)) return false;
    let after = removeWarrantyAnatelFragments(before);
    if (WARRANTY_ANATEL_RX.test(after)) {
      const aiOut = await callAI(SYSTEM_REMOVE_WARRANTY, `Descrição curta atual:\n${before}`);
      const cleaned = removeWarrantyAnatelFragments(clean(aiOut));
      if (cleaned && !WARRANTY_ANATEL_RX.test(cleaned)) after = cleaned;
    }
    if (WARRANTY_ANATEL_RX.test(after)) {
      throw new Error("Não foi possível remover todas as menções a garantia/Anatel.");
    }
    if (after === before) return false;
    await patch({ descricao_curta: after });
    return true;
  }

  if (kind === "expand_short_desc") {
    const minLength = Number(params.min_length ?? 150);
    const beforeRaw = (row.descricao_curta ?? "").toString();
    const before = descriptionPlainText(beforeRaw);
    if (descriptionVisibleLength(beforeRaw) >= minLength) return false;
    const nome = (row.nome ?? "").toString();
    const system = SYSTEM_EXPAND_SHORT_DESC.replaceAll("{N}", String(minLength));
    const userMsg =
      `Nome do produto:\n${nome}\n\n` +
      `Descrição curta atual (${before.length} chars):\n${before || "(vazia)"}`;
    let after = clean(await callAI(system, userMsg));
    if (!after || after.length < Math.floor(minLength * 0.9)) {
      after = clean(
        await callAI(
          system,
          `${userMsg}\n\nATENÇÃO: o texto anterior tinha ${after.length} caracteres e foi rejeitado. ` +
            `Escreva um texto NOVO com NO MÍNIMO ${minLength} caracteres (conte os caracteres).`,
        ),
      );
    }
    if (!after) throw new Error("IA devolveu vazio.");
    if (after.length < Math.floor(minLength * 0.9)) {
      throw new Error(`IA devolveu texto curto (${after.length} chars).`);
    }
    await patch({ descricao_curta: after });
    return true;
  }

  // find_ean
  const before = (row.gtin ?? "").toString();
  if (before.trim()) return false;
  const nome = (row.nome ?? "").toString();
  if (!nome.trim()) throw new Error("Produto sem nome para pesquisar o EAN.");

  const { data: twin } = await admin
    .from("bling_products")
    .select("gtin")
    .eq("company_id", companyId)
    .eq("nome", nome)
    .not("gtin", "is", null)
    .neq("gtin", "")
    .limit(1);
  let candidate = (twin?.[0]?.gtin ?? "").toString().replace(/\D/g, "");

  if (!isValidGtin(candidate)) {
    const marca = (row.marca ?? "").toString();
    const found = await searchEanCandidates(nome, marca);
    if (!found.length) throw new Error("Nenhum código encontrado na web para este produto.");
    const lista = found.map((c, i) => `${i + 1}) ${c.code} — ${c.context}`).join("\n");
    const out = await callAI(
      SYSTEM_FIND_EAN,
      `Produto: ${nome}${marca ? `\nMarca: ${marca}` : ""}${row.codigo ? `\nSKU interno: ${row.codigo}` : ""}\n\n` +
        `Candidatos encontrados na web:\n${lista}`,
    );
    const picked = out.replace(/\D/g, "");
    if (/desconhecido/i.test(out) || !picked) {
      throw new Error("Nenhum dos códigos encontrados na web corresponde a este produto.");
    }
    if (!found.some((c) => c.code === picked)) {
      throw new Error("A IA devolveu um código fora da lista encontrada na web.");
    }
    candidate = picked;
  }

  if (!isValidGtin(candidate)) throw new Error("Código retornado é inválido (dígito verificador).");
  await patch({ gtin: candidate });
  return true;
}

/* ========================= Worker ========================= */

const LEASE_SECONDS = 120;
const ITEMS_PER_QUERY = 240;
/** Quantos limites temporários são tolerados antes de estacionar a tarefa. */
const RATE_LIMIT_TOLERANCE = 6;

type TickResult = {
  job_id: string | null;
  processed: number;
  updated: number;
  errors: number;
  remaining: number;
  status: string | null;
  paused_reason?: string;
};

async function loadProducts(
  admin: any,
  companyId: string,
  ids: string[],
): Promise<Map<string, ProductRow>> {
  const { data, error } = await admin
    .from("bling_products")
    .select("id, codigo, nome, descricao_curta, gtin, marca")
    .eq("company_id", companyId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r: ProductRow) => [r.id, r]));
}

/**
 * Processa uma rodada limitada de uma tarefa de IA.
 * Sempre encerra dentro do prazo, gravando cada produto concluído.
 */
export async function processAiTransformTick(
  jobId: string | null,
  deadline: number,
): Promise<TickResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as any;

  await admin.rpc("reclaim_stuck_ai_transform_jobs");

  const worker = `ai-tick-${Math.random().toString(36).slice(2, 10)}`;
  const { data: claimed, error: claimError } = await admin.rpc("claim_next_ai_transform_job", {
    _worker: worker,
    _lease_seconds: LEASE_SECONDS,
    _job_id: jobId,
  });
  if (claimError) throw new Error(claimError.message);

  const job = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!job) {
    return { job_id: null, processed: 0, updated: 0, errors: 0, remaining: 0, status: null };
  }

  if (!AI_FEATURES_ENABLED) {
    await admin.rpc("pause_ai_transform_job", {
      _job_id: job.id,
      _status: "pausado_creditos",
      _erro: AI_DISABLED_MESSAGE,
    });
    return {
      job_id: job.id,
      processed: 0,
      updated: 0,
      errors: 0,
      remaining: 0,
      status: "pausado_creditos",
      paused_reason: AI_DISABLED_MESSAGE,
    };
  }

  let processed = 0;
  let updated = 0;
  let errors = 0;
  let status: string | null = "executando";
  let pausedReason: string | undefined;
  let rateLimitHits = 0;

  try {
    while (Date.now() < deadline) {
      // Renova a trava e confirma que a tarefa não foi cancelada/pausada.
      const { data: currentStatus } = await admin.rpc("touch_ai_transform_job", {
        _job_id: job.id,
        _lease_seconds: LEASE_SECONDS,
      });
      status = (currentStatus as string) ?? null;
      if (status !== "executando") break;

      const { data: items, error: itemsError } = await admin.rpc("next_ai_transform_items", {
        _job_id: job.id,
        _limit: ITEMS_PER_QUERY,
      });
      if (itemsError) throw new Error(itemsError.message);
      const list = (items ?? []) as Array<{
        item_id: string;
        product_id: string;
        tentativas: number;
      }>;
      if (list.length === 0) break;

      const products = await loadProducts(
        admin,
        job.company_id,
        list.map((i) => i.product_id),
      );

      // Vários produtos ao mesmo tempo: a simultaneidade se ajusta sozinha
      // conforme a IA aceita (ou reclama do) ritmo.
      let stop = false;
      const processItem = async (item: { item_id: string; product_id: string }) => {
        if (stop || Date.now() >= deadline) return;
        const row = products.get(item.product_id);
        if (!row) {
          await admin.rpc("finish_ai_transform_item", {
            _item_id: item.item_id,
            _outcome: "erro",
            _changed: false,
            _erro: "Produto não encontrado.",
            _sku: null,
          });
          processed++;
          errors++;
          return;
        }
        try {
          const changed = await processProduct(
            admin,
            job.kind as AiJobKind,
            (job.params ?? {}) as Record<string, unknown>,
            job.company_id,
            row,
          );
          await admin.rpc("finish_ai_transform_item", {
            _item_id: item.item_id,
            _outcome: "ok",
            _changed: changed,
            _erro: null,
            _sku: row.codigo,
          });
          processed++;
          if (changed) updated++;
        } catch (e) {
          if (e instanceof AiCreditsError) {
            // Disjuntor: para a fila inteira e avisa o dono do app.
            stop = true;
            await admin.rpc("finish_ai_transform_item", {
              _item_id: item.item_id,
              _outcome: "retry",
              _changed: false,
              _erro: e.message,
              _sku: row.codigo,
              _retry_in_seconds: 60,
            });
            await admin.rpc("pause_ai_transform_job", {
              _job_id: job.id,
              _status: "pausado_creditos",
              _erro: e.message,
            });
            status = "pausado_creditos";
            pausedReason = e.message;
            return;
          }
          if (e instanceof AiRateLimitError) {
            // Item volta para a fila. Só estaciona a tarefa se o limite insistir:
            // avisos isolados não podem travar a fila inteira.
            rateLimitHits++;
            await admin.rpc("finish_ai_transform_item", {
              _item_id: item.item_id,
              _outcome: "retry",
              _changed: false,
              _erro: e.message,
              _sku: row.codigo,
              _retry_in_seconds: Math.min(e.retryInSeconds, 15),
            });
            if (rateLimitHits >= RATE_LIMIT_TOLERANCE) {
              stop = true;
              await admin.rpc("pause_ai_transform_job", {
                _job_id: job.id,
                _status: "pausado_limite",
                _erro: e.message,
              });
              status = "pausado_limite";
              pausedReason = e.message;
            }
            return;
          }
          await admin.rpc("finish_ai_transform_item", {
            _item_id: item.item_id,
            _outcome: "erro",
            _changed: false,
            _erro: e instanceof Error ? e.message : "erro",
            _sku: row.codigo,
          });
          processed++;
          errors++;
        }
      };

      let cursor = 0;
      const lanes = Math.max(1, Math.min(currentAiConcurrency(), list.length));
      await Promise.all(
        Array.from({ length: lanes }, async () => {
          while (!stop && Date.now() < deadline) {
            const item = list[cursor++];
            if (!item) return;
            await processItem(item);
          }
        }),
      );

      if (status !== "executando") break;
    }
  } finally {
    if (status === "executando") {
      await admin.rpc("release_ai_transform_job", { _job_id: job.id });
    }
  }

  const { count } = await admin
    .from("ai_transform_job_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", job.id)
    .eq("status", "pendente");

  return {
    job_id: job.id,
    processed,
    updated,
    errors,
    remaining: count ?? 0,
    status,
    paused_reason: pausedReason,
  };
}

/**
 * Tarefas pausadas por limite temporário voltam sozinhas na rodada seguinte.
 * Pausas por créditos/bloqueio ficam paradas até uma ação do dono do app.
 */
export async function resumeRateLimitedAiJobs(): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .from("ai_transform_jobs")
    .update({ status: "pendente", lease_expires_at: null, updated_at: new Date().toISOString() })
    .eq("status", "pausado_limite")
    .select("id");
  return (data ?? []).length;
}
