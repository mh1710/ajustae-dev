import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

export type EanSuggestion = {
  id: string;
  sku: string;
  nome: string;
  ean: string | null;
  /** Título do produto encontrado (ML) ou explicação da origem. */
  match: string | null;
  /** Semelhança entre o título do produto e o título encontrado (0–1). */
  similarity?: number | null;
  error?: string;
};

const SYSTEM_PICK_EAN =
  "Você é um especialista em catálogos de produtos e códigos de barras GTIN/EAN do varejo brasileiro. " +
  "Você recebe o produto e uma lista de códigos candidatos extraídos de resultados de busca na web, cada um com o trecho onde apareceu. " +
  "Escolha o código que pertence EXATAMENTE a esse produto (mesma marca, mesmo modelo, mesma variação). " +
  "Responda APENAS os dígitos do código escolhido. Se nenhum corresponder com certeza, responda exatamente: DESCONHECIDO. " +
  "NUNCA invente um código que não esteja na lista.";

function tokens(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** Pontua semelhança entre títulos; tokens com dígitos (modelo) pesam mais. */
function similarity(a: string, b: string) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  let score = 0;
  let total = 0;
  for (const t of ta) {
    const w = /\d/.test(t) ? 3 : 1;
    total += w;
    if (tb.has(t)) score += w;
  }
  return total ? score / total : 0;
}

export const suggestEanBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_ids: z.array(z.string().uuid()).min(1).max(10),
        mode: z.enum(["ml", "ai"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { isValidGtin } = await import("@/lib/ai-transforms.server");
    const { data: rows, error } = await supabaseAdmin
      .from("bling_products")
      .select("id, codigo, nome, marca, gtin")
      .eq("company_id", data.company_id)
      .in("id", data.product_ids);
    if (error) throw new Error(error.message);

    const { data: supNames } = await supabaseAdmin.rpc("supplier_product_names" as never, {
      _skus: ((rows ?? []) as any[]).map((r) => r.codigo).filter(Boolean),
    } as never);
    const supMap = new Map<string, string>(((supNames ?? []) as any[]).map((x) => [x.sku, x.nome]));

    let token: string | null = null;
    if (data.mode === "ml") {
      const { getMlAccessToken } = await import("@/lib/mercadolivre.server");
      token = await getMlAccessToken();
    }

    const out: EanSuggestion[] = [];
    for (const r of (rows ?? []) as any[]) {
      // Usa o nome do produto no fornecedor (pelo SKU); o nome atual pode ter sido alterado.
      const nome = (supMap.get(r.codigo) ?? r.nome ?? "").toString().trim();
      const base: EanSuggestion = { id: r.id, sku: r.codigo ?? "", nome, ean: null, match: null };
      try {
        if (!nome) throw new Error("Produto sem nome.");
        if (data.mode === "ml") {
          const q = nome.slice(0, 120);
          const res = await fetch(
            `https://api.mercadolibre.com/products/search?site_id=MLB&status=active&q=${encodeURIComponent(q)}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!res.ok) throw new Error(`Mercado Livre respondeu ${res.status}.`);
          const json = (await res.json()) as any;
          const results: any[] = Array.isArray(json?.results) ? json.results.slice(0, 10) : [];
          const scored = results
            .map((x) => {
              const g = (x.attributes ?? []).find((a: any) => a?.id === "GTIN");
              const ean = String(g?.value_name ?? "").split(",")[0].replace(/\D/g, "");
              return { name: String(x.name ?? ""), ean, score: similarity(nome, String(x.name ?? "")) };
            })
            .filter((x) => isValidGtin(x.ean))
            .sort((a, b) => b.score - a.score);
          const best = scored[0];
          if (!best) throw new Error("Nenhum produto com EAN encontrado no Mercado Livre.");
          out.push({ ...base, ean: best.ean, match: `${best.name} (${Math.round(best.score * 100)}% parecido)`, similarity: best.score });
        } else {
          const { searchEanCandidates, callAI } = await import("@/lib/ai-transforms.server");
          const marca = (r.marca ?? "").toString();
          const found = await searchEanCandidates(nome, marca);
          if (!found.length) throw new Error("Nenhum código encontrado na web.");
          const lista = found.map((c, i) => `${i + 1}) ${c.code} — ${c.context}`).join("\n");
          const ans = await callAI(
            SYSTEM_PICK_EAN,
            `Produto: ${nome}${marca ? `\nMarca: ${marca}` : ""}\n\nCandidatos:\n${lista}`,
          );
          const picked = ans.replace(/\D/g, "");
          if (/desconhecido/i.test(ans) || !picked) throw new Error("A IA não teve certeza do EAN.");
          const hit = found.find((c) => c.code === picked);
          if (!hit || !isValidGtin(picked)) throw new Error("A IA devolveu um código inválido.");
          out.push({ ...base, ean: picked, match: hit.context.slice(0, 160), similarity: similarity(nome, hit.context) });
        }
      } catch (e) {
        out.push({ ...base, error: e instanceof Error ? e.message : "erro" });
      }
    }
    return { items: out };
  });

export const applyEanSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        items: z
          .array(z.object({ id: z.string().uuid(), ean: z.string().regex(/^\d{8,14}$/) }))
          .min(1)
          .max(5000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { isValidGtin } = await import("@/lib/ai-transforms.server");
    let updated = 0;
    const now = new Date().toISOString();
    for (const it of data.items) {
      if (!isValidGtin(it.ean)) continue;
      const { error } = await supabaseAdmin
        .from("bling_products")
        .update({ gtin: it.ean, gtin_embalagem: it.ean, dirty: true, updated_at: now })
        .eq("company_id", data.company_id)
        .eq("id", it.id);
      if (!error) updated += 1;
    }
    return { updated };
  });
