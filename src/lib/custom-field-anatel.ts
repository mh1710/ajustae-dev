/** Normaliza apenas o valor automático dos campos customizados de Anatel. */
export function customFieldAnatelValue(code: unknown): string {
  const value = String(code ?? "").trim();
  return !value || /^isento$/i.test(value) ? "Não se aplica" : value;
}