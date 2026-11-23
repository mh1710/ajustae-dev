const IMAGE_RE = /^(?<base>[A-Z0-9]+?)(?:_(?<index>\d+))?\.(?<ext>jpg|jpeg|png|webp|avif)$/i;

export function matchingImageKeys(keys: string[], prefix: string, code: string) {
  const base = `${prefix}${code}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
  return keys
    .filter((key) => {
      const match = IMAGE_RE.exec(key.split("/").pop() ?? "");
      return match?.groups?.base?.replace(/[^A-Z0-9]/gi, "").toUpperCase() === base;
    })
    .sort((left, right) => {
      const a = Number(IMAGE_RE.exec(left.split("/").pop() ?? "")?.groups?.index ?? 0);
      const b = Number(IMAGE_RE.exec(right.split("/").pop() ?? "")?.groups?.index ?? 0);
      return a - b || left.localeCompare(right);
    });
}

export function cdnImageUrls(keys: string[], signature: string) {
  const base = (process.env.CDN_BASE_URL ?? "").replace(/\/$/, "");
  const bucket = process.env.R2_BUCKET_NAME ?? process.env.CLOUDFLARE_R2_BUCKET ?? "ajustae";
  if (!base) throw new Error("CDN_BASE_URL não configurado no servidor.");
  return keys.map(
    (key) =>
      `${base}/${signature}/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`,
  );
}

export async function cdnImageUrlsForIntegration(
  keys: string[],
  integration: {
    id: string;
    cdn_signature?: string | null;
    cdn_signature_active?: boolean | null;
    key_version?: { public_id: string; format: "v1" | "v2"; status: string } | null;
  },
) {
  if (integration.key_version?.format === "v2" && integration.key_version.status === "active") {
    const { signCdnObjectUrls } = await import("@/lib/cdn-worker.server");
    const signed = await signCdnObjectUrls(integration.id, integration.key_version.public_id, keys);
    return keys.map((key) => {
      const url = signed.get(key);
      if (!url) throw new Error(`O Worker não assinou a imagem ${key}.`);
      return url;
    });
  }
  if (integration.cdn_signature && integration.cdn_signature_active) {
    return cdnImageUrls(keys, integration.cdn_signature);
  }
  throw new Error("Ative uma versão CDN antes de aprovar produtos com imagens.");
}
