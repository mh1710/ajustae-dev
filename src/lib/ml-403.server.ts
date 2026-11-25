/** Verificações do guia "Erro 403" do Mercado Livre para descobrir a causa de uma recusa. */
import { mlFetch } from "./ml-http.server";
import { explainMl403, type Ml403Detail, type Ml403Diagnosis, type Ml403Explanation } from "./ml-403";

const ML_API = "https://api.mercadolibre.com";
const CACHE_MS = 10 * 60_000;
let cached: { at: number; key: string; value: Ml403Diagnosis } | null = null;

async function json(res: Response): Promise<Record<string, unknown> | null> {
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

export async function diagnoseMl403(token: string, detail: Ml403Detail): Promise<Ml403Explanation & { diagnosis: Ml403Diagnosis }> {
  const key = detail.path.replace(/MLB\d+/g, "MLB*");
  let diag = cached && cached.key === key && Date.now() - cached.at < CACHE_MS ? cached.value : null;
  if (!diag) {
    const clientId = process.env["MERCADOLIVRE_CLIENT_ID"] ?? "";
    const [app, user, tokenless] = await Promise.all([
      clientId ? mlFetch(`${ML_API}/applications/${clientId}`, { token, maxRetries: 1 }).then(json).catch(() => null) : null,
      mlFetch(`${ML_API}/users/me`, { token, maxRetries: 1 }).then(json).catch(() => null),
      mlFetch(`${ML_API}${detail.path}`, { maxRetries: 1 }).then(async (r) => { await r.body?.cancel().catch(() => undefined); return r.status; }).catch(() => null),
    ]);
    const status = (user?.["status"] ?? {}) as Record<string, { allow?: boolean; codes?: string[] } | string | undefined>;
    const pending = ["list", "billing", "sell", "buy"].flatMap((k) => {
      const s = status[k];
      return s && typeof s === "object" && s.allow === false ? (s.codes ?? []) : [];
    });
    const partial = (app?.["partial_blocked"] ?? {}) as { blocked?: boolean; blocked_reason?: string };
    diag = {
      app: app
        ? {
            active: app["active"] !== false,
            blocked: app["blocked"] === true,
            disabled: app["disabled"] === true,
            partialBlocked: partial.blocked === true,
            blockedReason: (typeof app["blocked_reason"] === "string" && app["blocked_reason"]) || partial.blocked_reason || null,
          }
        : null,
      user: user ? { siteStatus: typeof status["site_status"] === "string" ? status["site_status"] : null, pendingCodes: pending } : null,
      tokenlessStatus: tokenless,
    };
    cached = { at: Date.now(), key, value: diag };
  }
  return { ...explainMl403(detail, diag), diagnosis: diag };
}
