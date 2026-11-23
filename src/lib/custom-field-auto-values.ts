import { customFieldAnatelValue } from "./custom-field-anatel";
import { CUSTOM_FIELD_FIXED_VALUES } from "./custom-field-fixed-values";
import { customFieldValueAllowed, type CustomFieldLike } from "./custom-field-options";

export type AutoFieldRole = { role: string; cf: string; bid: number; valor: string | null; nome: string; field?: CustomFieldLike | null };
export type AutoFieldValue = { cf: string; bid: number; valor: string; nome: string };

/**
 * Valor automático de cada campo apontado pela empresa: escolha do usuário, senão o valor fixo do papel;
 * Anatel vem do código do produto e Modelo só quando encontrado.
 */
export function autoCustomFieldValues(roles: AutoFieldRole[], ctx: { anatel: unknown; modelo: string | null }): AutoFieldValue[] {
  const anatel = customFieldAnatelValue(ctx.anatel);
  const out: AutoFieldValue[] = [];
  for (const r of roles) {
    let v: string | null = r.valor && r.valor.trim() !== "" ? r.valor.trim() : CUSTOM_FIELD_FIXED_VALUES[r.role] ?? null;
    if (r.role === "anatel" || r.role === "anatel_homologacao") v = anatel;
    if (r.role === "modelo") v = ctx.modelo;
    if (v != null && Number.isFinite(r.bid)) out.push({ cf: r.cf, bid: r.bid, valor: v, nome: r.nome });
  }
  return out;
}

/** No cadastro, só envia o que o campo aceita (listas do Bling), para não recusar o produto inteiro. */
export function creationCustomFieldValues(roles: AutoFieldRole[], ctx: { anatel: unknown; modelo: string | null }): AutoFieldValue[] {
  const byCf = new Map(roles.map((r) => [r.cf, r]));
  return autoCustomFieldValues(roles, ctx).filter((v) => v.valor.trim() !== "" && customFieldValueAllowed(v.valor, byCf.get(v.cf)?.field));
}
