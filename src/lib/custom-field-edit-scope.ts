export function customFieldEditScope(
  individualId: string | null,
  scope: "selected" | "filtered",
  selected: Set<string>,
  filter: { search?: string; field_id?: string; field_mode?: "vazio" | "preenchido" },
) {
  if (individualId) return { product_ids: [individualId] };
  if (scope === "selected") {
    if (selected.size === 0) throw new Error("Selecione ao menos um produto.");
    return { product_ids: [...selected] };
  }
  return { filter };
}