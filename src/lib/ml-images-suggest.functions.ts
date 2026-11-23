import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pickMlImageUrls, pickSupplierImageUrls, supplierFirstImages, eanMatches, currentImageCorrection, mergeVerifiedImages } from "@/lib/ml-images";

const ML_API = "https://api.mercadolibre.com";

async function assertWriter(context: { supabase: any; userId: string }, companyId: string) {
  const { data: restricted } = await context.supabase.rpc("is_company_restricted");
  if (restricted === true) throw new Error("Acesso restrito por empresa.");
  const { data, error } = await context.supabase.from("company_users").select("id")
    .eq("company_id", companyId).eq("user_id", context.userId).eq("ativo", true).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sem acesso a esta empresa.");
}

export type MlImageSuggestion = {
  id: string;
  sku: string;
  nome: string;
  ean: string | null;
  atuais: number;
  validas: number;
  invalidas: number;
  imagens: string[];
  ml_nome: string | null;
  source: "fornecedor" | "mercado_livre" | "atuais" | "outra_empresa" | null;
  source_name?: string;
  error?: string;
};

// Poucas consultas simultâneas ao ML por servidor; 429/5xx esperam e tentam de novo.
let mlActive = 0;
const mlWaiters: Array<() => void> = [];
async function mlFetch(url: string, token: string): Promise<Response> {
  while (mlActive >= 2) await new Promise<void>((r) => mlWaiters.push(r));
  mlActive++;
  try {
    let last: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      last = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      if (last.status !== 429 && last.status < 500) return last;
      const retryAfter = Number(last.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : 800 * 2 ** attempt + Math.random() * 400;
      await new Promise((r) => setTimeout(r, wait));
    }
    return last!;
  } finally {
    mlActive--;
    mlWaiters.shift()?.();
  }
}

async function findByEan(token: string, ean: string, min: number, max: number) {
  const { withoutVisualPlaceholders } = await import("@/lib/image-fingerprint.server");
  const r = await mlFetch(`${ML_API}/products/search?site_id=MLB&status=active&product_identifier=${ean}`, token);
  if (r.status === 429) throw new Error("Mercado Livre está limitando as consultas agora (429). Busque este produto novamente em alguns minutos.");
  if (!r.ok) throw new Error(`Mercado Livre respondeu ${r.status}`);
  const results = (((await r.json()) as any)?.results ?? []) as any[];
  let best: { nome: string | null; imagens: string[] } | null = null;
  for (const x of results.slice(0, 5)) {
    if (!eanMatches(x?.attributes, ean)) continue;
    let pictures = x?.pictures;
    if (!Array.isArray(pictures) || pictures.length === 0) {
      const d = await mlFetch(`${ML_API}/products/${x.id}`, token);
      if (d.ok) pictures = ((await d.json()) as any)?.pictures;
    }
    const imagens = await withoutVisualPlaceholders(pickMlImageUrls(pictures, max));
    if (!best || imagens.length > best.imagens.length) best = { nome: x?.name ?? null, imagens };
    if (imagens.length >= min) break;
  }
  return best;
}

export const suggestMlImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    product_ids: z.array(z.string().uuid()).min(1).max(20),
    min: z.number().int().min(1).max(50),
    max: z.number().int().min(1).max(50),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.company_id);
    const { data: rows, error } = await context.supabase.from("bling_products")
      .select("id,codigo,nome,gtin,url_imagens_externas,imagem_principal_url")
      .eq("company_id", data.company_id).in("id", data.product_ids);
    if (error) throw new Error(error.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { withoutVisualPlaceholders } = await import("@/lib/image-fingerprint.server");
    const { loadSupplierPrefixMap, parseSkuPrefix } = await import("@/lib/supplier-prefix-map");
    const prefixMap = await loadSupplierPrefixMap(supabaseAdmin);
    const { data: suppliers } = await supabaseAdmin.from("fornecedores").select("id,codigo");
    const supplierIds = new Map((suppliers ?? []).map((s) => [s.codigo, s.id]));
    // Prefetch supplier photos for the whole batch in one query per supplier.
    const wanted = new Map<string, Set<string>>();
    for (const p of (rows ?? []) as any[]) {
      const parsed = parseSkuPrefix(p.codigo);
      const supplierId = parsed ? supplierIds.get(prefixMap[parsed.prefix]) : undefined;
      if (supplierId && parsed?.numeric) {
        if (!wanted.has(supplierId)) wanted.set(supplierId, new Set());
        wanted.get(supplierId)!.add(parsed.numeric);
      }
    }
    const supplierPhotos = new Map<string, unknown>();
    await Promise.all([...wanted].map(async ([supplierId, codes]) => {
      const { data: list, error: listError } = await supabaseAdmin.from("fornecedor_produtos")
        .select("codigo,foto").eq("fornecedor_id", supplierId).eq("ativo", true).in("codigo", [...codes]);
      if (listError) return;
      for (const r of (list ?? []) as any[]) {
        const key = `${supplierId}:${r.codigo}`;
        if (!supplierPhotos.has(key)) supplierPhotos.set(key, r.foto);
      }
    }));
    let tokenPromise: Promise<string> | undefined;
    const getToken = () => {
      if (!tokenPromise) tokenPromise = import("@/lib/mercadolivre.server").then((m) => m.getMlAccessToken());
      return tokenPromise;
    };
    const { mapLimited } = await import("@/lib/image-apply-batch");
    const items: MlImageSuggestion[] = await mapLimited((rows ?? []) as any[], async (p): Promise<MlImageSuggestion> => {
      const raw = (p.url_imagens_externas || p.imagem_principal_url || "") as string;
      const atuais = raw.split(/[|\n\r]+/).filter((u) => u.trim()).length;
      const ean = String(p.gtin ?? "").replace(/\D/g, "");
      const currentUrls = raw.split(/[|\n\r]+/).map((u) => u.trim()).filter(Boolean);
      const base = { id: p.id, sku: p.codigo, nome: p.nome, ean: ean || null, atuais, validas: 0, invalidas: 0, imagens: [] as string[], ml_nome: null as string | null, source: null as MlImageSuggestion["source"] };
      try {
        const verified = await withoutVisualPlaceholders(currentUrls);
        const correction = currentImageCorrection(currentUrls, verified, data.min, data.max);
        const validCurrent = correction.valid;
        base.validas = validCurrent.length; base.invalidas = correction.invalid.length;
        if (correction.skip) return { ...base, error: "Produto já tem o mínimo de fotos válidas e nenhuma foto inválida." };
        if (correction.cleanupOnly) return { ...base, source: "atuais", imagens: validCurrent };
        const parsed = parseSkuPrefix(p.codigo);
        const supplierId = parsed ? supplierIds.get(prefixMap[parsed.prefix]) : undefined;
        let supplierImages: string[] = [];
        if (supplierId && parsed?.numeric) {
          supplierImages = await withoutVisualPlaceholders(pickSupplierImageUrls(supplierPhotos.get(`${supplierId}:${parsed.numeric}`), data.max));
        }
        const result = await supplierFirstImages(mergeVerifiedImages(validCurrent, supplierImages, data.max), data.min, async () => {
          if (ean.length < 8) throw new Error("Fornecedor sem imagens suficientes e produto sem EAN para buscar no Mercado Livre.");
          const found = await findByEan(await getToken(), ean, data.min, data.max);
          return found ? { ...found, imagens: mergeVerifiedImages(validCurrent, found.imagens, data.max) } : null;
        });
        if (result.source === "fornecedor") return { ...base, source: "fornecedor", imagens: result.imagens };
        const found = result.result;
        if (!found) return { ...base, error: "Fornecedor sem imagens suficientes e EAN não encontrado no Mercado Livre." };
        if (found.imagens.length < data.min) return { ...base, source: "mercado_livre", ml_nome: found.nome, imagens: found.imagens, error: `Fornecedor e ML sem imagens suficientes: ML tem ${found.imagens.length} (mínimo ${data.min}).` };
        return { ...base, source: "mercado_livre", ml_nome: found.nome, imagens: found.imagens };
      } catch (e) {
        return { ...base, error: e instanceof Error ? e.message : "Erro na busca." };
      }
    }, 3);
    return { items };
  });

export const applyMlImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    company_id: z.string().uuid(),
    items: z.array(z.object({ id: z.string().uuid(), imagens: z.array(z.string().url().max(500)).min(1).max(18) })).min(1).max(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { inspectImage } = await import("@/lib/image-fingerprint.server");
    const { mapLimited } = await import("@/lib/image-apply-batch");
    let updated = 0;
    let skipped = 0;
    for (const item of data.items) {
      const candidates = pickSupplierImageUrls(item.imagens, 50);
      const checks = await mapLimited(candidates, (url) => inspectImage(url, true));
      const imagens = candidates.filter((_, i) => checks[i] === "valid");
      // A bad photo skips only its own product; the rest of the batch is still applied.
      if (imagens.length !== item.imagens.length) { skipped++; continue; }
      const { data: changed, error } = await supabaseAdmin.from("bling_products")
        .update({ url_imagens_externas: imagens.join("|"), imagem_principal_url: imagens[0], dirty: true, updated_at: new Date().toISOString() } as any)
        .eq("company_id", data.company_id).eq("id", item.id).select("id");
      if (error) throw new Error(error.message);
      updated += changed?.length ?? 0;
    }
    return { updated, skipped };
  });
