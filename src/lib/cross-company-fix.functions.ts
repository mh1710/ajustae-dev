import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RULE_REGISTRY } from "@/lib/validation-rules/registry";
import type { AuditProduct } from "@/lib/validation-rules/types";
import { isCorrectImageDonor, correctDonorImages } from "@/lib/cross-company-images";
import type { MlImageSuggestion } from "@/lib/ml-images-suggest.functions";

/**
 * Correção usando outra empresa da mesma conta:
 * quando um produto (mesmo SKU) já está correto em outra empresa para a regra
 * que falhou, copiamos os campos daquela regra para o produto com erro.
 */

const PRODUCT_COLUMNS =
  "id, company_id, codigo, nome, marca, preco, preco_custo, estoque, descricao_complementar, descricao_curta, peso_liquido, peso_bruto, largura, altura, profundidade, url_imagens_externas, imagem_principal_url, gtin, situacao, bling_product_id, last_audit_at, last_audit_errors, last_audit_warnings";

/** Campos copiados por regra. Regras fora deste mapa não têm correção por outra empresa. */
export const CROSS_COMPANY_RULE_FIELDS: Record<string, string[]> = {
  "descricao-complementar-igual-nome": ["descricao_complementar"],
  "garantia-anatel-desc-complementar": ["descricao_curta"],
  "descricao-curta-minima": ["descricao_curta"],
  "garantia-duplicada-desc-curta": ["descricao_curta"],
  "titulo-maximo": ["nome"],
  "ean-obrigatorio": ["gtin"],
  "imagens-maximo": ["url_imagens_externas", "imagem_principal_url"],
  "imagens-extensao": ["url_imagens_externas", "imagem_principal_url"],
  "imagens-minimo": ["url_imagens_externas", "imagem_principal_url"],
  "imagens-obrigatorias": ["url_imagens_externas", "imagem_principal_url"],
  "imagem-placeholder": ["url_imagens_externas", "imagem_principal_url"],
  "dimensoes-peso-obrigatorios": [
    "peso_liquido",
    "peso_bruto",
    "largura",
    "altura",
    "profundidade",
  ],
};

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

async function myCompanyIds(ctx: { supabase: any; userId: string }): Promise<string[]> {
  const { data, error } = await ctx.supabase
    .from("company_users")
    .select("company_id")
    .eq("user_id", ctx.userId)
    .eq("ativo", true);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { company_id: string }) => r.company_id);
}

function isFilled(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  return true;
}

async function evaluateRule(
  slug: string,
  config: Record<string, unknown>,
  product: AuditProduct,
  supabaseAdmin: { from: (t: string) => any },
  companyId: string,
) {
  const mod = RULE_REGISTRY[slug];
  if (!mod) return null;
  let prepared: unknown;
  if (mod.prepare) {
    try {
      prepared = await mod.prepare({ companyId, supabaseAdmin, products: [product] }, config);
    } catch {
      return null;
    }
  }
  try {
    return await mod.evaluate(product, config, prepared);
  } catch {
    return null;
  }
}

const inputSchema = z.object({
  company_id: z.string().uuid(),
  rule_slug: z.string().min(1),
  product_ids: z.array(z.string().uuid()).min(1).max(5000),
  dry_run: z.boolean().default(false),
  /** Empresas de origem escolhidas pelo usuário. Vazio/omitido = todas as outras. */
  source_company_ids: z.array(z.string().uuid()).optional(),
});

/**
 * Procura, nas demais empresas do usuário, o mesmo SKU já correto para a regra
 * informada e copia os campos dessa regra. Com `dry_run` apenas conta quantos
 * produtos poderiam ser corrigidos.
 */
export const applyCrossCompanyFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: restricted, error: restrictedError } = await (context.supabase as any).rpc("is_company_restricted");
    if (restrictedError) throw new Error(restrictedError.message);
    if (restricted === true) throw new Error("Acesso restrito por empresa.");
    await assertMember(context, data.company_id);
    const fields = CROSS_COMPANY_RULE_FIELDS[data.rule_slug];
    if (!fields) throw new Error("Esta regra não pode ser corrigida com dados de outra empresa.");
    const isImages = fields.includes("url_imagens_externas");
    if (isImages && !data.dry_run) throw new Error("Revise e aplique as fotos pela janela de correção de imagens.");
    const items: MlImageSuggestion[] = [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const chosen0 = new Set(data.source_company_ids ?? []);
    const otherCompanies = (await myCompanyIds(context)).filter(
      (id) => id !== data.company_id && (chosen0.size === 0 || chosen0.has(id)),
    );
    if (otherCompanies.length === 0) {
      return { total: data.product_ids.length, matched: 0, updated: 0, sources: [] as string[], items };
    }

    const { data: ruleRow } = await supabaseAdmin
      .from("validation_rules")
      .select("slug, config")
      .eq("slug", data.rule_slug)
      .or(`company_id.is.null,company_id.eq.${data.company_id}`)
      .limit(1)
      .maybeSingle();
    const config = (ruleRow?.config ?? {}) as Record<string, unknown>;

    // Alvos (produtos com erro na empresa atual).
    const targets: any[] = [];
    for (let i = 0; i < data.product_ids.length; i += 200) {
      const { data: rows, error } = await supabaseAdmin
        .from("bling_products")
        .select(PRODUCT_COLUMNS)
        .eq("company_id", data.company_id)
        .in("id", data.product_ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      targets.push(...(rows ?? []));
    }

    // Equivalência de SKU pelo mapa de prefixos: HX1821 ≡ HAY1821 ≡ HA1821
    // (mesmo fornecedor + mesmo número). SKUs sem prefixo mapeado casam só exatos.
    const { loadSupplierPrefixMap, parseSkuPrefix } = await import("@/lib/supplier-prefix-map");
    const prefixMap = await loadSupplierPrefixMap(supabaseAdmin);
    const prefixesBySupplier = new Map<string, string[]>();
    for (const [p, s] of Object.entries(prefixMap)) {
      const list = prefixesBySupplier.get(s) ?? [];
      list.push(p);
      prefixesBySupplier.set(s, list);
    }
    const matchKey = (sku: string): string => {
      const code = String(sku ?? "").trim().toUpperCase();
      const parsed = parseSkuPrefix(code);
      if (parsed && parsed.numeric && prefixMap[parsed.prefix]) {
        return `${prefixMap[parsed.prefix]}:${parsed.numeric}`;
      }
      return `=${code}`;
    };
    const variantsOf = (sku: string): string[] => {
      const code = String(sku ?? "").trim();
      const parsed = parseSkuPrefix(code);
      const supplier = parsed ? prefixMap[parsed.prefix] : undefined;
      if (!parsed || !parsed.numeric || !supplier) return [code];
      const out = new Set<string>([code]);
      for (const p of prefixesBySupplier.get(supplier) ?? []) {
        out.add(`${p}${parsed.numeric}`);
        out.add(`${p.toLowerCase()}${parsed.numeric}`);
      }
      return Array.from(out);
    };

    const codes = Array.from(
      new Set(
        targets.flatMap((t) => variantsOf(String(t.codigo ?? "").trim())).filter(Boolean),
      ),
    );
    if (codes.length === 0) {
      return { total: targets.length, matched: 0, updated: 0, sources: [] as string[], items };
    }

    // Candidatos nas outras empresas com SKU equivalente.
    // Importante: paginar sempre, pois cada SKU pode existir em várias empresas
    // e o limite padrão de linhas cortaria silenciosamente os últimos códigos.
    const donorsByCode = new Map<string, any[]>();
    const PAGE = 500;
    for (let i = 0; i < codes.length; i += 50) {
      const slice = codes.slice(i, i + 50);
      let from = 0;
      for (;;) {
        const { data: rows, error } = await supabaseAdmin
          .from("bling_products")
          .select(PRODUCT_COLUMNS)
          .in("company_id", otherCompanies)
          .in("codigo", slice)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const list0 = rows ?? [];
        for (const row of list0) {
          const key = matchKey(String((row as any).codigo ?? ""));
          const list = donorsByCode.get(key) ?? [];
          if (!list.some((r) => r.id === (row as any).id)) list.push(row);
          donorsByCode.set(key, list);
        }
        if (list0.length < PAGE) break;
        from += PAGE;
      }
    }

    // Nome das empresas de origem (para o relatório).
    const { data: companyRows } = await supabaseAdmin
      .from("companies")
      .select("id, nome")
      .in("id", otherCompanies);
    const companyNames = new Map<string, string>(
      (companyRows ?? []).map((c: any) => [String(c.id), String(c.nome ?? "")]),
    );

    let matched = 0;
    let updated = 0;
    const sources = new Set<string>();
    const evaluationCache = new Map<string, boolean>();
    const photoCache = new Map<string, string[] | null>();

    for (const target of targets) {
      const code = String(target.codigo ?? "").trim();
      const all = donorsByCode.get(matchKey(code)) ?? [];
      // Prioriza SKU idêntico; depois os equivalentes por prefixo.
      const donors = [
        ...all.filter((d) => String(d.codigo ?? "").trim() === code),
        ...all.filter((d) => String(d.codigo ?? "").trim() !== code),
      ];
      let chosen: any = null;
      for (const donor of donors) {
        if (isImages) {
          if (!isCorrectImageDonor(donor)) continue;
          if (!photoCache.has(donor.id)) {
            const { withoutVisualPlaceholders } = await import("@/lib/image-fingerprint.server");
            const urls = String(donor.url_imagens_externas || donor.imagem_principal_url || "").split(/[|\n\r]+/).map(u => u.trim()).filter(Boolean);
            photoCache.set(donor.id, urls.length < 3 || urls.length > 18 ? null : correctDonorImages(urls, await withoutVisualPlaceholders(urls)));
          }
          if (!photoCache.get(donor.id)) continue;
        }
        // Basta que o doador tenha ao menos um dos campos da regra preenchido;
        // a garantia real é a avaliação da regra logo abaixo. Exigir todos
        // impedia a correção de imagens (url_imagens_externas e
        // imagem_principal_url raramente estão preenchidos ao mesmo tempo).
        if (!fields.some((f) => isFilled(donor[f]))) continue;
        const cacheKey = `${donor.id}`;
        let ok = evaluationCache.get(cacheKey);
        if (ok === undefined) {
          const result = await evaluateRule(
            data.rule_slug,
            config,
            donor as AuditProduct,
            supabaseAdmin,
            String(donor.company_id),
          );
          ok = result?.status === "pass";
          evaluationCache.set(cacheKey, ok);
        }
        if (ok) {
          chosen = donor;
          break;
        }
      }
      if (isImages) {
        const { withoutVisualPlaceholders } = await import("@/lib/image-fingerprint.server");
        const urls = String(target.url_imagens_externas || target.imagem_principal_url || "").split(/[|\n\r]+/).map(u => u.trim()).filter(Boolean);
        const valid = await withoutVisualPlaceholders(urls);
        items.push({ id: target.id, sku: target.codigo, nome: target.nome, ean: target.gtin,
          atuais: urls.length, validas: valid.length, invalidas: urls.length - valid.length,
          imagens: chosen ? photoCache.get(chosen.id) ?? [] : [], ml_nome: null,
          source: chosen ? "outra_empresa" : null,
          source_name: chosen ? companyNames.get(String(chosen.company_id)) : undefined,
          ...(!chosen ? { error: "Nenhum produto correspondente ativo, auditado sem problemas e com fotos válidas na empresa de origem." } : {}),
        });
      }
      if (!chosen) continue;
      matched++;
      sources.add(companyNames.get(String(chosen.company_id)) ?? "Outra empresa");
      if (data.dry_run) continue;

      const patch: Record<string, unknown> = { dirty: true };
      for (const f of fields) patch[f] = chosen[f];
      const { error } = await supabaseAdmin
        .from("bling_products")
        .update(patch as any)
        .eq("id", target.id)
        .eq("company_id", data.company_id);
      if (error) throw new Error(error.message);
      updated++;
    }

    return {
      total: targets.length,
      matched,
      updated,
      sources: Array.from(sources).sort(),
      items,
    };
  });
