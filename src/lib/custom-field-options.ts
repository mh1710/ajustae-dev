/**
 * Leitura das opções de um campo customizado do tipo lista suspensa (Bling tipoCampo.id = 3).
 * Módulo puro: usado pela tela e pelos testes, sem chamadas ao Bling.
 */
export type CustomFieldOption = { id: number; nome: string };

export type CustomFieldLike = {
  tipo_campo_id?: number | null;
  opcoes?: CustomFieldOption[] | null;
};

export const CUSTOM_FIELD_TIPO_LISTA = 3;

export const CUSTOM_FIELD_TIPO_NOMES: Record<number, string> = {
  1: "Inteiro",
  2: "Decimal",
  3: "Lista",
  4: "Texto",
  5: "Texto longo",
  6: "Lógico",
  7: "Data",
};

/** Só campos de lista têm opções; os demais aceitam qualquer texto. */
export function isCustomFieldList(field?: CustomFieldLike | null): boolean {
  return Number(field?.tipo_campo_id) === CUSTOM_FIELD_TIPO_LISTA;
}

/** Nomes das opções reais, sem o aviso "Selecione uma opção". */
export function customFieldOptions(field?: CustomFieldLike | null): string[] {
  if (!isCustomFieldList(field)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of field?.opcoes ?? []) {
    const nome = String(o?.nome ?? "").trim();
    if (!nome || /selecione/i.test(nome)) continue;
    if (seen.has(nome.toLowerCase())) continue;
    seen.add(nome.toLowerCase());
    out.push(nome);
  }
  return out;
}

/** Valor vazio limpa o campo; nos demais, a lista do Bling precisa conter o valor. */
export function customFieldValueAllowed(value: string, field?: CustomFieldLike | null): boolean {
  const opts = customFieldOptions(field);
  if (opts.length === 0) return true;
  const v = (value ?? "").trim();
  if (!v) return true;
  return opts.some((o) => o.toLowerCase() === v.toLowerCase());
}
