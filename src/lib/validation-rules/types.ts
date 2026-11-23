export interface AuditProduct {
  id: string;
  codigo: string | null;
  nome: string | null;
  marca: string | null;
  preco: number | null;
  preco_custo: number | null;
  estoque: number | null;
  descricao_complementar: string | null;
  descricao_curta: string | null;
  peso_liquido: number | null;
  peso_bruto: number | null;
  largura: number | null;
  altura: number | null;
  profundidade: number | null;
  url_imagens_externas: string | null;
  imagem_principal_url: string | null;
  gtin: string | null;
  situacao?: string | null;
}

export type RuleStatus = "pass" | "warning" | "error";

export interface RuleResult {
  status: RuleStatus;
  message?: string;
  details?: Record<string, unknown>;
}

export interface RuleModule {
  slug: string;
  name: string;
  description: string;
  category: "conteudo" | "preco" | "cadastro" | "estoque" | "imagens" | "dimensoes" | "fiscal" | "cadastro";
  defaultSeverity: "error" | "warning";
  defaultConfig?: Record<string, unknown>;
  prepare?: (
    ctx: { companyId: string; supabaseAdmin: SupabaseAdminLike; products: AuditProduct[] },
    config: Record<string, unknown>,
  ) => Promise<unknown>;
  evaluate: (
    product: AuditProduct,
    config: Record<string, unknown>,
    prepared?: unknown,
  ) => Promise<RuleResult> | RuleResult;
}

export type SupabaseAdminLike = {
  from: (table: string) => any;
};