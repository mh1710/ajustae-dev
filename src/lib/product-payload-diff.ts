/**
 * Compara o payload completo do produto com o último estado enviado ao Bling
 * e devolve somente os campos que mudaram (para envio parcial via PATCH).
 */

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const k of keys) {
      if (!deepEqual(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Retorna os campos de `full` que diferem de `lastSent`.
 * Se `lastSent` for nulo (produto nunca enviado), devolve `full` inteiro.
 * Sub-objetos (dimensoes, estoque, tributacao, midia) são comparados como um
 * todo: se qualquer valor interno mudou, o sub-objeto inteiro é enviado.
 */
export function diffProductPayload(
  full: Record<string, unknown>,
  lastSent: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!lastSent) return { ...full };
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(full)) {
    if (!deepEqual(value, lastSent[key])) changed[key] = value;
  }
  return changed;
}
