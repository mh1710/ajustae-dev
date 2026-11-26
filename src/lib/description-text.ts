const HTML_ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;|&#160;/gi, " "],
  [/&amp;/gi, "&"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/&#39;|&apos;/gi, "'"],
];

/** Texto efetivamente visível ao cliente, sem contar tags HTML como conteúdo. */
export function descriptionPlainText(value: string | null | undefined): string {
  let text = String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|div|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  for (const [pattern, replacement] of HTML_ENTITIES) {
    text = text.replace(pattern, replacement);
  }

  return text.replace(/\s+/g, " ").trim();
}

export function descriptionVisibleLength(value: string | null | undefined): number {
  return descriptionPlainText(value).length;
}
