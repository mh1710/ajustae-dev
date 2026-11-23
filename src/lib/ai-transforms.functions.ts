import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AI_FEATURES_ENABLED, AI_DISABLED_MESSAGE } from "@/lib/ai-features";

const FIREWORKS_API_URL = "https://api.fireworks.ai/inference/v1/chat/completions";
// DeepSeek-V4-Flash: excelente custo x benefício ($0.14/M input, $0.28/M output, 1M contexto)
// Ideal para tarefas de reescrita de texto e-commerce em PT-BR
const MODEL = "accounts/fireworks/models/deepseek-v4-flash-0731";

async function assertMember(ctx: { supabase: any; userId: string }, companyId: string) {
  const { data, error } = await ctx.supabase
    .from("company_users")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", ctx.userId)
    .eq("ativo", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sem acesso a esta empresa.");
}

const AI_MIN_REQUEST_INTERVAL_MS = 700;
const AI_MAX_REQUEST_INTERVAL_MS = 10_000;
const AI_MAX_ATTEMPTS = 4;
const AI_REQUEST_TIMEOUT_MS = 45_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let aiRequestIntervalMs = AI_MIN_REQUEST_INTERVAL_MS;
let lastAiRequestStartedAt = 0;
let aiRequestQueue: Promise<void> = Promise.resolve();

async function waitForAiRequestSlot(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Processamento interrompido.", "AbortError");
  const waitMs = Math.max(0, lastAiRequestStartedAt + aiRequestIntervalMs - Date.now());
  if (waitMs > 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, waitMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Processamento interrompido.", "AbortError"));
      }, { once: true });
    });
  }
  lastAiRequestStartedAt = Date.now();
}

async function callAIExclusive(system: string, user: string, signal?: AbortSignal): Promise<string> {
  const key = process.env.FIREWORKS_API_KEY;
  if (!key) throw new Error("FIREWORKS_API_KEY ausente no servidor.");
  for (let attempt = 0; attempt < AI_MAX_ATTEMPTS; attempt++) {
    await waitForAiRequestSlot(signal);
    const requestController = new AbortController();
    const timeout = setTimeout(() => requestController.abort("timeout"), AI_REQUEST_TIMEOUT_MS);
    const abortRequest = () => requestController.abort(signal?.reason);
    signal?.addEventListener("abort", abortRequest, { once: true });
    let res: Response;
    try {
      res = await fetch(FIREWORKS_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          // Modelo de raciocínio: sem isso, todo o orçamento de tokens é gasto no
          // "reasoning_content" e o campo content volta vazio ("IA devolveu vazio").
          reasoning_effort: "none",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: requestController.signal,
      });
    } catch (error) {
      if (signal?.aborted) throw new DOMException("Processamento interrompido.", "AbortError");
      if (requestController.signal.aborted) {
        throw new Error("A IA demorou mais de 45 segundos neste produto. Tente novamente.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortRequest);
    }
    if (res.status === 429) {
      if (attempt === AI_MAX_ATTEMPTS - 1) {
        throw new Error("Limite de requisições da IA atingido após novas tentativas. O item ficou pendente.");
      }
      const retryAfter = Number(res.headers.get("Retry-After"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1_000
        : 5_000 * 2 ** attempt;
      aiRequestIntervalMs = Math.min(
        AI_MAX_REQUEST_INTERVAL_MS,
        Math.max(Math.ceil(aiRequestIntervalMs * 1.5), waitMs),
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, waitMs + Math.floor(Math.random() * 500));
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Processamento interrompido.", "AbortError"));
        }, { once: true });
      });
      continue;
    }
    if (res.status === 401) throw new Error("Chave de API da Fireworks inválida ou ausente.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados na conta Fireworks.");
    if (!res.ok) throw new Error(`Falha na IA Fireworks (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as any;
    const msg = j?.choices?.[0]?.message;
    const txt = (typeof msg?.content === "string" && msg.content.trim())
      ? msg.content
      : (typeof msg?.reasoning_content === "string" ? "" : undefined);
    if (typeof txt !== "string" || !txt.trim()) throw new Error("Resposta vazia da IA (raciocínio consumiu os tokens).");
    aiRequestIntervalMs = Math.max(AI_MIN_REQUEST_INTERVAL_MS, aiRequestIntervalMs - 100);
    return txt.trim();
  }
  throw new Error("Não foi possível concluir a solicitação à IA.");

}

async function callAI(system: string, user: string, signal?: AbortSignal): Promise<string> {
  const request = aiRequestQueue.then(() => callAIExclusive(system, user, signal));
  aiRequestQueue = request.then(() => undefined, () => undefined);
  return request;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

const WARRANTY_ANATEL_RX =
  /(?:garant(?:ia|ias|imos|id[oa]s?)|assegurad[oa]s?|anatel|homologa(?:ção|cao))/i;

function removeWarrantyAnatelFragments(value: string) {
  const text = value.replace(/\r\n/g, "\n");
  // Divide o texto por delimitadores fortes (pontuação, |, quebras, bullets)
  // preservando os separadores; depois descarta qualquer fragmento que
  // contenha termos de garantia/Anatel. Muito mais confiável que regex-splice.
  const parts = text.split(/([.!?;|\n\r•])/);
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const chunk = parts[i] ?? "";
    const sep = parts[i + 1] ?? "";
    if (!WARRANTY_ANATEL_RX.test(chunk)) {
      kept.push(chunk + sep);
    }
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

function hasWarrantyAnatelTerms(value: string) {
  return WARRANTY_ANATEL_RX.test(value);
}

/* =========================================================
   1) LISTAR CANDIDATOS
   ========================================================= */



export const aiListLongTitleIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_ids: z.array(z.string().uuid()).optional(),
        max_length: z.number().int().min(20).max(200).default(60),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin;
    const out: string[] = [];
    if (data.product_ids && data.product_ids.length > 0) {
      for (let i = 0; i < data.product_ids.length; i += 500) {
        const chunk = data.product_ids.slice(i, i + 500);
        const { data: rows, error } = await admin
          .from("bling_products")
          .select("id, nome")
          .eq("company_id", data.company_id)
          .in("id", chunk);
        if (error) throw new Error(error.message);
        for (const r of rows ?? []) {
          if (((r as any).nome ?? "").length > data.max_length) out.push((r as any).id);
        }
      }
      return { ids: out };
    }
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error } = await admin
        .from("bling_products")
        .select("id, nome")
        .eq("company_id", data.company_id)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;
      for (const r of rows) {
        if (((r as any).nome ?? "").length > data.max_length) out.push((r as any).id);
      }
      if (rows.length < PAGE) break;
    }
    return { ids: out };

  });

export const aiListWarrantyCandidateIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_ids: z.array(z.string().uuid()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const out: string[] = [];
    const RX = /(garant|anatel)/i;
    if (data.product_ids && data.product_ids.length > 0) {
      for (let i = 0; i < data.product_ids.length; i += 500) {
        const chunk = data.product_ids.slice(i, i + 500);
        const { data: rows, error } = await supabaseAdmin
          .from("bling_products")
          .select("id, descricao_curta")
          .eq("company_id", data.company_id)
          .in("id", chunk);
        if (error) throw new Error(error.message);
        for (const r of rows ?? []) {
          if (RX.test(((r as any).descricao_curta ?? "") as string)) out.push((r as any).id);
        }
      }
      return { ids: out };
    }
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error } = await supabaseAdmin
        .from("bling_products")
        .select("id, descricao_curta")
        .eq("company_id", data.company_id)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;
      for (const r of rows) {
        if (RX.test(((r as any).descricao_curta ?? "") as string)) out.push((r as any).id);
      }
      if (rows.length < PAGE) break;
    }
    return { ids: out };
  });

/* =========================================================
   2) PROCESSAR BATCH via IA
   ========================================================= */

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

export const aiShortenTitlesBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_ids: z.array(z.string().uuid()).min(1).max(30),
        max_length: z.number().int().min(20).max(200).default(60),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const signal = getRequest().signal;
    if (!AI_FEATURES_ENABLED) throw new Error(AI_DISABLED_MESSAGE);
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("bling_products")
      .select("id, codigo, nome")
      .eq("company_id", data.company_id)
      .in("id", data.product_ids);
    if (error) throw new Error(error.message);

    const system = SYSTEM_SHORTEN.replaceAll("{N}", String(data.max_length));
    const items: Array<{ id: string; sku: string; before: string; after: string; ok: boolean; error?: string }> = [];
    let updated = 0;

    await mapLimit(rows ?? [], 1, async (r: any) => {
      const before = (r.nome ?? "").toString();
      if (!before || before.length <= data.max_length) {
        items.push({ id: r.id, sku: r.codigo ?? "", before, after: before, ok: true });
        return;
      }
      try {
        let after = await callAI(
          system,
          `Título atual (${before.length} chars):\n${before}\n\n` +
            `Lembre-se: o novo título deve começar pelo tipo do produto usado no original e manter o mesmo sentido.`,
          signal,
        );
        after = after.replace(/^["'`]|["'`]$/g, "").trim();
        if (after.length > data.max_length) {
          // corta na última palavra completa para não quebrar termos técnicos
          const cut = after.slice(0, data.max_length);
          const sp = cut.lastIndexOf(" ");
          after = (sp > 20 ? cut.slice(0, sp) : cut).trim().replace(/[-–|,]+$/, "").trim();
        }
        if (!after) throw new Error("IA devolveu vazio.");
        const { error: uErr } = await supabaseAdmin
          .from("bling_products")
          .update({ nome: after, dirty: true, updated_at: new Date().toISOString() })
          .eq("id", r.id)
          .eq("company_id", data.company_id);
        if (uErr) throw new Error(uErr.message);
        updated++;
        items.push({ id: r.id, sku: r.codigo ?? "", before, after, ok: true });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        items.push({
          id: r.id,
          sku: r.codigo ?? "",
          before,
          after: before,
          ok: false,
          error: e instanceof Error ? e.message : "erro",
        });
      }
    });

    return { processed: (rows ?? []).length, updated, items };
  });

export const aiRemoveWarrantyBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_ids: z.array(z.string().uuid()).min(1).max(30),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const signal = getRequest().signal;
    if (!AI_FEATURES_ENABLED) throw new Error(AI_DISABLED_MESSAGE);
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("bling_products")
      .select("id, codigo, descricao_curta")
      .eq("company_id", data.company_id)
      .in("id", data.product_ids);
    if (error) throw new Error(error.message);

    const items: Array<{ id: string; sku: string; before: string; after: string; ok: boolean; error?: string }> = [];
    let updated = 0;

    await mapLimit(rows ?? [], 1, async (r: any) => {
      const before = (r.descricao_curta ?? "").toString();
      if (!before || !WARRANTY_ANATEL_RX.test(before)) {
        items.push({ id: r.id, sku: r.codigo ?? "", before, after: before, ok: true });
        return;
      }
      try {
        // 1) Primeira passada determinística: rápida e confiável.
        let after = removeWarrantyAnatelFragments(before);

        // 2) Se ainda restou algo (frase sem delimitador claro), pede pra IA
        //    reescrever e re-aplica a limpeza determinística no retorno.
        if (hasWarrantyAnatelTerms(after)) {
          try {
            const aiOut = await callAI(SYSTEM_REMOVE_WARRANTY, `Descrição curta atual:\n${before}`, signal);
            const cleaned = removeWarrantyAnatelFragments(
              aiOut.replace(/^["'`]|["'`]$/g, "").trim(),
            );
            if (!hasWarrantyAnatelTerms(cleaned) && cleaned.length > 0) {
              after = cleaned;
            }
          } catch {
            if (signal.aborted) throw new DOMException("Processamento interrompido.", "AbortError");
            // Segue com o melhor esforço determinístico.
          }
        }

        if (hasWarrantyAnatelTerms(after)) {
          throw new Error("Não foi possível remover todas as menções a garantia/Anatel.");
        }
        if (after === before) {
          items.push({ id: r.id, sku: r.codigo ?? "", before, after, ok: true });
          return;
        }
        const { error: uErr } = await supabaseAdmin
          .from("bling_products")
          .update({ descricao_curta: after, dirty: true, updated_at: new Date().toISOString() })
          .eq("id", r.id)
          .eq("company_id", data.company_id);
        if (uErr) throw new Error(uErr.message);
        updated++;
        items.push({ id: r.id, sku: r.codigo ?? "", before, after, ok: true });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        items.push({
          id: r.id,
          sku: r.codigo ?? "",
          before,
          after: before,
          ok: false,
          error: e instanceof Error ? e.message : "erro",
        });
      }
    });

    return { processed: (rows ?? []).length, updated, items };
  });

/* =========================================================
   3) EXPANDIR DESCRIÇÕES CURTAS (< 150 chars) com SEO
   ========================================================= */

const SYSTEM_EXPAND_SHORT_DESC =
  "Você é um redator de e-commerce em português (Brasil) focado em SEO. " +
  "Reescreva a DESCRIÇÃO CURTA do produto para ter NO MÍNIMO N caracteres (idealmente entre N e N+80). " +
  "Preserve integralmente todas as informações e especificações presentes no texto original e no nome do produto. " +
  "Enriqueça com palavras-chave naturais e relevantes para SEO (marca, categoria, uso, benefícios), sem repetir termos artificialmente e sem inventar especificações, medidas, prazos, garantias, códigos, compatibilidades ou dados que não estejam no original. " +
  "Escreva em texto puro (sem HTML), tom claro e vendedor, frases completas. " +
  "Responda APENAS com o novo texto da descrição curta, sem aspas, sem comentários, sem prefixos.";

export const aiListShortDescriptionIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_ids: z.array(z.string().uuid()).optional(),
        min_length: z.number().int().min(50).max(1000).default(150),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const out: string[] = [];
    const isShort = (v: string | null | undefined) => (v ?? "").trim().length < data.min_length;
    if (data.product_ids && data.product_ids.length > 0) {
      for (let i = 0; i < data.product_ids.length; i += 500) {
        const chunk = data.product_ids.slice(i, i + 500);
        const { data: rows, error } = await supabaseAdmin
          .from("bling_products")
          .select("id, descricao_curta")
          .eq("company_id", data.company_id)
          .in("id", chunk);
        if (error) throw new Error(error.message);
        for (const r of rows ?? []) {
          if (isShort((r as any).descricao_curta)) out.push((r as any).id);
        }
      }
      return { ids: out };
    }
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error } = await supabaseAdmin
        .from("bling_products")
        .select("id, descricao_curta")
        .eq("company_id", data.company_id)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;
      for (const r of rows) {
        if (isShort((r as any).descricao_curta)) out.push((r as any).id);
      }
      if (rows.length < PAGE) break;
    }
    return { ids: out };
  });

export const aiExpandShortDescriptionsBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_ids: z.array(z.string().uuid()).min(1).max(30),
        min_length: z.number().int().min(50).max(1000).default(150),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const signal = getRequest().signal;
    if (!AI_FEATURES_ENABLED) throw new Error(AI_DISABLED_MESSAGE);
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("bling_products")
      .select("id, codigo, nome, descricao_curta")
      .eq("company_id", data.company_id)
      .in("id", data.product_ids);
    if (error) throw new Error(error.message);

    const system = SYSTEM_EXPAND_SHORT_DESC.replaceAll("N", String(data.min_length));
    const items: Array<{ id: string; sku: string; before: string; after: string; ok: boolean; error?: string }> = [];
    let updated = 0;

    await mapLimit(rows ?? [], 1, async (r: any) => {
      const before = (r.descricao_curta ?? "").toString();
      const nome = (r.nome ?? "").toString();
      if (before.trim().length >= data.min_length) {
        items.push({ id: r.id, sku: r.codigo ?? "", before, after: before, ok: true });
        return;
      }
      try {
        const userMsg =
          `Nome do produto:\n${nome}\n\n` +
          `Descrição curta atual (${before.trim().length} chars):\n${before || "(vazia)"}`;
        const clean = (t: string) =>
          t.replace(/^["'`]|["'`]$/g, "").trim().replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
        let after = clean(await callAI(system, userMsg, signal));
        // 2ª tentativa quando o modelo devolve vazio ou curto demais
        if (!after || after.length < Math.floor(data.min_length * 0.9)) {
          after = clean(
            await callAI(
              system,
              userMsg +
                `\n\nATENÇÃO: o texto anterior tinha ${after.length} caracteres e foi rejeitado. ` +
                `Escreva um texto NOVO com NO MÍNIMO ${data.min_length} caracteres (conte os caracteres).`,
              signal,
            ),
          );
        }
        if (!after) throw new Error("IA devolveu vazio.");
        if (after.length < Math.floor(data.min_length * 0.9)) {
          throw new Error(`IA devolveu texto curto (${after.length} chars).`);
        }

        const { error: uErr } = await supabaseAdmin
          .from("bling_products")
          .update({ descricao_curta: after, dirty: true, updated_at: new Date().toISOString() })
          .eq("id", r.id)
          .eq("company_id", data.company_id);
        if (uErr) throw new Error(uErr.message);
        updated++;
        items.push({ id: r.id, sku: r.codigo ?? "", before, after, ok: true });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        items.push({
          id: r.id,
          sku: r.codigo ?? "",
          before,
          after: before,
          ok: false,
          error: e instanceof Error ? e.message : "erro",
        });
      }
    });

    return { processed: (rows ?? []).length, updated, items };
  });

/* =========================================================
   4) BUSCAR EAN/GTIN AUSENTE COM IA (pelo nome do produto)
   ========================================================= */

const SYSTEM_FIND_EAN =
  "Você é um especialista em catálogos de produtos e códigos de barras GTIN/EAN do varejo brasileiro. " +
  "Dado o nome (e marca/modelo) de um produto, informe o código EAN-13 (ou UPC-12) oficial do produto. " +
  "Regras rígidas: responda APENAS os dígitos do código, sem espaços, sem texto, sem explicação. " +
  "Se você não tiver certeza absoluta do código real desse produto específico, responda exatamente: DESCONHECIDO. " +
  "NUNCA invente, estime ou gere um código aleatório.";

/** Valida dígito verificador de GTIN-8/12/13/14. */
function isValidGtin(v: string) {
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

export const aiListMissingEanIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_ids: z.array(z.string().uuid()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const out: string[] = [];
    const empty = (v: unknown) => !((v ?? "").toString().trim());
    if (data.product_ids && data.product_ids.length > 0) {
      for (let i = 0; i < data.product_ids.length; i += 500) {
        const chunk = data.product_ids.slice(i, i + 500);
        const { data: rows, error } = await supabaseAdmin
          .from("bling_products")
          .select("id, gtin")
          .eq("company_id", data.company_id)
          .in("id", chunk);
        if (error) throw new Error(error.message);
        for (const r of rows ?? []) if (empty((r as any).gtin)) out.push((r as any).id);
      }
      return { ids: out };
    }
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error } = await supabaseAdmin
        .from("bling_products")
        .select("id, gtin")
        .eq("company_id", data.company_id)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;
      for (const r of rows) if (empty((r as any).gtin)) out.push((r as any).id);
      if (rows.length < PAGE) break;
    }
    return { ids: out };
  });

export const aiFindEanBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_ids: z.array(z.string().uuid()).min(1).max(30),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const signal = getRequest().signal;
    if (!AI_FEATURES_ENABLED) throw new Error(AI_DISABLED_MESSAGE);
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("bling_products")
      .select("id, codigo, nome, marca, gtin")
      .eq("company_id", data.company_id)
      .in("id", data.product_ids);
    if (error) throw new Error(error.message);

    const items: Array<{ id: string; sku: string; before: string; after: string; ok: boolean; error?: string }> = [];
    let updated = 0;

    await mapLimit(rows ?? [], 1, async (r: any) => {
      const before = (r.gtin ?? "").toString();
      const nome = (r.nome ?? "").toString();
      if (before.trim()) {
        items.push({ id: r.id, sku: r.codigo ?? "", before, after: before, ok: true });
        return;
      }
      try {
        if (!nome.trim()) throw new Error("Produto sem nome para pesquisar o EAN.");
        // 1) Tenta reaproveitar EAN de outro produto com o mesmo nome na base.
        const { data: twin } = await supabaseAdmin
          .from("bling_products")
          .select("gtin")
          .eq("company_id", data.company_id)
          .eq("nome", nome)
          .not("gtin", "is", null)
          .neq("gtin", "")
          .limit(1);
        let candidate = (twin?.[0] as any)?.gtin?.toString().replace(/\D/g, "") ?? "";

        // 2) Caso contrário, pergunta à IA.
        if (!isValidGtin(candidate)) {
          const marca = (r.marca ?? "").toString();
          const out = await callAI(
            SYSTEM_FIND_EAN,
            `Produto: ${nome}${marca ? `\nMarca: ${marca}` : ""}${r.codigo ? `\nSKU interno: ${r.codigo}` : ""}`,
            signal,
          );
          candidate = out.replace(/\D/g, "");
          if (/desconhecido/i.test(out) || !candidate) throw new Error("IA não encontrou o EAN deste produto.");
        }
        if (!isValidGtin(candidate)) throw new Error("Código retornado é inválido (dígito verificador).");

        const { error: uErr } = await supabaseAdmin
          .from("bling_products")
          .update({ gtin: candidate, dirty: true, updated_at: new Date().toISOString() })
          .eq("id", r.id)
          .eq("company_id", data.company_id);
        if (uErr) throw new Error(uErr.message);
        updated++;
        items.push({ id: r.id, sku: r.codigo ?? "", before, after: candidate, ok: true });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        items.push({
          id: r.id,
          sku: r.codigo ?? "",
          before,
          after: before,
          ok: false,
          error: e instanceof Error ? e.message : "erro",
        });
      }
    });

    return { processed: (rows ?? []).length, updated, items };
  });
