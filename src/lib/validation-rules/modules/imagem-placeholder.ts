import type { RuleModule } from "../types";
import { isPlaceholderImage, PLACEHOLDER_IMAGE_URLS } from "@/lib/placeholder-images";

export const imagemPlaceholderRule: RuleModule = {
  slug: "imagem-placeholder",
  name: "Fotos inválidas: padrão, inacessíveis ou formato não suportado",
  description: "Identifica imagem padrão por comparação visual e fotos inacessíveis ou em formatos não suportados.",
  category: "imagens",
  defaultSeverity: "error",
  defaultConfig: { urls: PLACEHOLDER_IMAGE_URLS },
  prepare: async (ctx) => {
    const urls = ctx.products.flatMap((p) => (p.url_imagens_externas || p.imagem_principal_url || "").split(/[|\n\r]+/));
    const { normalizeImageUrl } = await import("@/lib/placeholder-images");
    const keys = [...new Set(urls.map(normalizeImageUrl))];
    const invalid = new Map<string, { status: string; reason: string | null }>();
    for (let i = 0; i < keys.length; i += 100) {
      const { data, error } = await ctx.supabaseAdmin.from("image_audit_cache").select("url_key,status,reason").in("url_key", keys.slice(i, i + 100)).in("status", ["placeholder", "unknown"]).eq("version", 1);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) invalid.set(row.url_key, { status: row.status, reason: row.reason });
    }
    return invalid;
  },
  evaluate: async (product, config, prepared) => {
    const { normalizeImageUrl } = await import("@/lib/placeholder-images");
    const known = Array.isArray(config.urls) ? config.urls.filter((v): v is string => typeof v === "string") : PLACEHOLDER_IMAGE_URLS;
    const urls = (product.url_imagens_externas || product.imagem_principal_url || "").split(/[|\n\r]+/).map((v) => v.trim()).filter(Boolean);
    const failures = urls.flatMap((url) => {
      const cached = prepared instanceof Map ? prepared.get(normalizeImageUrl(url)) : undefined;
      if (isPlaceholderImage(url, known) || cached?.status === "placeholder" || (prepared instanceof Set && prepared.has(normalizeImageUrl(url)))) {
        return [{ url, status: "placeholder", reason: "Imagem padrão no lugar da foto real." }];
      }
      return cached?.status === "unknown" ? [{ url, status: "unknown", reason: cached.reason || "Foto inacessível ou formato não suportado." }] : [];
    });
    return failures.length ? { status: "error", message: failures.map((f) => f.reason).filter((v, i, all) => all.indexOf(v) === i).join(" "), details: { urls: failures.map((f) => f.url), failures, autofix: true } } : { status: "pass" };
  },
};