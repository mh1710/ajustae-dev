/** Category/domain evidence is authoritative; titles only catch explicit ingestible products. */
function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_-]/g, " ");
}

export function excludedProspectType(domain: string | null, category: string | null, title: string | null): boolean {
  const classification = normalize(`${domain ?? ""} ${category ?? ""}`);
  const name = normalize(title ?? "");
  const ingestibleClass = /\b(medicamentos?|remedios?|medicines?|drugs?|suplementos?|supplements?|alimentos?|foods?|groceries|bebidas?|beverages?|drinks?|vitaminas?|vitamins?|racoes?|pet food|cigarettes?|cigarros?|tabaco|tobacco|e liquids?|e liquidos?)\b/;
  const nonObjectClass = /\b(servicos?|services?|imoveis|real estate|ingressos|tickets)\b/;
  const explicitProduct = /\b(medicamentos?|remedios?|suplementos?|whey|creatina|multivitaminicos?|capsulas?|comprimidos?|racao|cerveja|vinho|vodka|whisky|refrigerante|energetico|chocolate|biscoitos?|cigarros?|tabaco)\b/;
  const accessory = /\b(organizador|porta|suporte|dispenser|maquina|cafeteira|adega|abridor|garrafa|copo)\b/.test(name);
  return ingestibleClass.test(classification) || nonObjectClass.test(classification) || (!accessory && explicitProduct.test(name));
}

export function usesAllProspectCategories(categories: string[], keywords: string[], allCategories = false) {
  return allCategories || (categories.length === 0 && keywords.length === 0);
}