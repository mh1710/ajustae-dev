type CustomFieldModule = { id: string | number; nome?: string; modulo?: string };

export const CUSTOM_FIELD_ACCESS_MESSAGE = "O Bling não disponibilizou os campos customizados de Produtos desta empresa para esta conexão. Confira no Bling as permissões do usuário e do aplicativo para Campos Customizados de Produtos; depois reconecte a empresa e busque a lista novamente.";

export function productCustomFieldModules(payload: unknown): CustomFieldModule[] {
  const data = payload && typeof payload === "object" && "data" in payload ? payload.data : undefined;
  if (!Array.isArray(data)) throw new Error("O Bling retornou uma lista de módulos inválida. Tente buscar novamente.");
  const products = data.filter((value): value is CustomFieldModule =>
    value && typeof value === "object" && value.id != null &&
    (/produto/i.test(String(value.modulo ?? "")) || /produto/i.test(String(value.nome ?? ""))),
  );
  if (products.length === 0) throw new Error(CUSTOM_FIELD_ACCESS_MESSAGE);
  return products;
}