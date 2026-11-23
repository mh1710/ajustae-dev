export type EmailCodeMessage = {
  subject?: string | null;
  body?: string | null;
  snippet?: string | null;
};

const WEBCONTINENTAL_TOKEN_SUBJECT = "webcontinental marketplace - token de acesso";

function normalizeSubject(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function htmlToText(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesAllowedEmailSender(email: string, rules: string[]): boolean {
  const normalized = email.trim().toLowerCase();
  const domain = normalized.split("@")[1] ?? "";
  return rules.some((rule) => {
    const normalizedRule = rule.trim().toLowerCase();
    const clean = normalizedRule.replace(/^@/, "");
    return normalizedRule.includes("@")
      ? normalized === normalizedRule
      : domain === clean || domain.endsWith(`.${clean}`);
  });
}

export function matchesWebContinentalTokenSubject(subject?: string | null): boolean {
  return normalizeSubject(String(subject ?? "")).includes(WEBCONTINENTAL_TOKEN_SUBJECT);
}

export function extractWebContinentalCode(message: EmailCodeMessage): string | null {
  if (!matchesWebContinentalTokenSubject(message.subject)) return null;
  const text = htmlToText(`${message.body ?? ""} ${message.snippet ?? ""}`);
  const labelled = [
    /(?:o\s+seu\s+)?token\s+de\s+acesso\s+(?:[ée]|:)\s*[^A-Z0-9]{0,20}([A-Z0-9]{4,16})\b/i,
    /(?:c[oó]digo|token|senha\s+tempor[aá]ria|verification\s+code|security\s+code)\s*(?::|-|[ée])\s*[^A-Z0-9]{0,20}([A-Z0-9]{4,16})\b/i,
    /([A-Z0-9]{4,16})[^A-Z0-9]{0,20}(?:[ée]\s+seu\s+c[oó]digo|is\s+your\s+code)/i,
  ];
  for (const pattern of labelled) {
    const match = text.match(pattern)?.[1]?.toUpperCase();
    if (match) return match;
  }
  return null;
}
