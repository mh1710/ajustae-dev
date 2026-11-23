
-- =========================================================
-- 1) Ampliação de bling_products com campos da planilha
-- =========================================================
ALTER TABLE public.bling_products
  ADD COLUMN IF NOT EXISTS ncm text,
  ADD COLUMN IF NOT EXISTS origem_fiscal text,
  ADD COLUMN IF NOT EXISTS valor_ipi_fixo numeric(14,4),
  ADD COLUMN IF NOT EXISTS observacoes text,
  ADD COLUMN IF NOT EXISTS estoque numeric(14,4),
  ADD COLUMN IF NOT EXISTS cod_fornecedor text,
  ADD COLUMN IF NOT EXISTS fornecedor text,
  ADD COLUMN IF NOT EXISTS localizacao text,
  ADD COLUMN IF NOT EXISTS data_validade date,
  ADD COLUMN IF NOT EXISTS descricao_fornecedor text,
  ADD COLUMN IF NOT EXISTS itens_caixa numeric(14,4),
  ADD COLUMN IF NOT EXISTS produto_variacao text,
  ADD COLUMN IF NOT EXISTS tipo_producao text,
  ADD COLUMN IF NOT EXISTS classe_ipi text,
  ADD COLUMN IF NOT EXISTS codigo_lista_servicos text,
  ADD COLUMN IF NOT EXISTS tipo_item text,
  ADD COLUMN IF NOT EXISTS grupo_tags text,
  ADD COLUMN IF NOT EXISTS tributos text,
  ADD COLUMN IF NOT EXISTS codigo_pai text,
  ADD COLUMN IF NOT EXISTS codigo_integracao text,
  ADD COLUMN IF NOT EXISTS grupo_produtos text,
  ADD COLUMN IF NOT EXISTS cest text,
  ADD COLUMN IF NOT EXISTS volumes numeric(14,4),
  ADD COLUMN IF NOT EXISTS cross_docking text,
  ADD COLUMN IF NOT EXISTS url_imagens_externas text,
  ADD COLUMN IF NOT EXISTS link_externo text,
  ADD COLUMN IF NOT EXISTS meses_garantia_fornecedor text,
  ADD COLUMN IF NOT EXISTS clonar_dados_pai text,
  ADD COLUMN IF NOT EXISTS condicao_produto text,
  ADD COLUMN IF NOT EXISTS frete_gratis text,
  ADD COLUMN IF NOT EXISTS numero_fci text,
  ADD COLUMN IF NOT EXISTS video text,
  ADD COLUMN IF NOT EXISTS departamento text,
  ADD COLUMN IF NOT EXISTS unidade_medida text,
  ADD COLUMN IF NOT EXISTS preco_compra numeric(14,4),
  ADD COLUMN IF NOT EXISTS icms_st_base numeric(14,4),
  ADD COLUMN IF NOT EXISTS icms_st_retencao numeric(14,4),
  ADD COLUMN IF NOT EXISTS icms_proprio_substituto numeric(14,4),
  ADD COLUMN IF NOT EXISTS categoria_produto text,
  ADD COLUMN IF NOT EXISTS informacoes_adicionais text,
  ADD COLUMN IF NOT EXISTS sheet_data_json jsonb,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bling_api',
  ADD COLUMN IF NOT EXISTS dirty boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_imported_at timestamptz;

-- integration_id agora precisa ser opcional (produtos criados só via planilha)
ALTER TABLE public.bling_products ALTER COLUMN integration_id DROP NOT NULL;
ALTER TABLE public.bling_products ALTER COLUMN bling_product_id DROP NOT NULL;

-- SKU único por empresa (quando presente)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bling_products_company_codigo
  ON public.bling_products (company_id, codigo)
  WHERE codigo IS NOT NULL;

-- =========================================================
-- 2) import_batches
-- =========================================================
CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'em_upload', -- em_upload, processando, aguardando_revisao, aplicada, cancelada, erro
  files jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{name, size, rows}]
  total_files int NOT NULL DEFAULT 0,
  processed_files int NOT NULL DEFAULT 0,
  total_rows int NOT NULL DEFAULT 0,
  processed_rows int NOT NULL DEFAULT 0,
  new_count int NOT NULL DEFAULT 0,
  existing_count int NOT NULL DEFAULT 0,
  updated_count int NOT NULL DEFAULT 0,
  ignored_count int NOT NULL DEFAULT 0,
  error_count int NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  applied_at timestamptz,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_import_batches_company ON public.import_batches(company_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batches TO authenticated;
GRANT ALL ON public.import_batches TO service_role;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "batches_members_all" ON public.import_batches
  FOR ALL TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()))
  WITH CHECK (app_private.is_company_member(company_id, auth.uid()));
CREATE TRIGGER trg_import_batches_updated_at BEFORE UPDATE ON public.import_batches
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================
-- 3) product_sheet_rows — staging por importação
-- =========================================================
CREATE TABLE IF NOT EXISTS public.product_sheet_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  file_name text,
  row_number int,
  sku text,            -- Código
  bling_id text,       -- ID
  gtin text,           -- GTIN/EAN
  raw jsonb NOT NULL,  -- linha crua, chaves = nomes exatos das colunas
  parsed jsonb NOT NULL, -- normalizada para o schema interno
  match_type text,     -- sku | bling_id | gtin | none
  match_product_id uuid,
  action text NOT NULL DEFAULT 'pending', -- pending | import | update_changed | update_all | ignore | applied
  diff jsonb,          -- lista de campos alterados (para existentes)
  applied_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sheet_rows_batch ON public.product_sheet_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_sheet_rows_company_sku ON public.product_sheet_rows(company_id, sku);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_sheet_rows TO authenticated;
GRANT ALL ON public.product_sheet_rows TO service_role;
ALTER TABLE public.product_sheet_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sheet_rows_members_all" ON public.product_sheet_rows
  FOR ALL TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()))
  WITH CHECK (app_private.is_company_member(company_id, auth.uid()));

-- =========================================================
-- 4) validation_rules + seeds das 8 regras
-- =========================================================
CREATE TABLE IF NOT EXISTS public.validation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, -- NULL = global (compartilhada)
  slug text NOT NULL, -- id do módulo em src/lib/validation-rules
  name text NOT NULL,
  description text,
  category text NOT NULL, -- titulo, descricao, preco, imagem, marca, peso, dimensoes, estoque, fornecedor, gtin
  severity text NOT NULL DEFAULT 'erro', -- erro | aviso | info
  active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_validation_rules_company_slug
  ON public.validation_rules (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.validation_rules TO authenticated;
GRANT ALL ON public.validation_rules TO service_role;
ALTER TABLE public.validation_rules ENABLE ROW LEVEL SECURITY;
-- regras globais (company_id null) são visíveis a todos autenticados; regras próprias por empresa somente aos membros
CREATE POLICY "rules_select" ON public.validation_rules
  FOR SELECT TO authenticated
  USING (company_id IS NULL OR app_private.is_company_member(company_id, auth.uid()));
CREATE POLICY "rules_insert" ON public.validation_rules
  FOR INSERT TO authenticated
  WITH CHECK (company_id IS NOT NULL AND app_private.is_company_member(company_id, auth.uid()));
CREATE POLICY "rules_update" ON public.validation_rules
  FOR UPDATE TO authenticated
  USING (company_id IS NOT NULL AND app_private.is_company_member(company_id, auth.uid()))
  WITH CHECK (company_id IS NOT NULL AND app_private.is_company_member(company_id, auth.uid()));
CREATE POLICY "rules_delete" ON public.validation_rules
  FOR DELETE TO authenticated
  USING (company_id IS NOT NULL AND app_private.is_company_member(company_id, auth.uid()));
CREATE TRIGGER trg_validation_rules_updated_at BEFORE UPDATE ON public.validation_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Seeds globais
INSERT INTO public.validation_rules (company_id, slug, name, description, category, severity, config) VALUES
  (NULL, 'marca_obrigatoria', 'Marca obrigatória', 'A marca não poderá ser vazia.', 'marca', 'erro', '{}'::jsonb),
  (NULL, 'preco_minimo', 'Preço mínimo', 'Preço mínimo permitido.', 'preco', 'erro', '{"min": 5}'::jsonb),
  (NULL, 'estoque_positivo', 'Estoque maior que zero', 'Estoque deve ser maior que zero.', 'estoque', 'aviso', '{"min": 0}'::jsonb),
  (NULL, 'descricao_minima', 'Descrição mínima', 'Descrição deverá possuir no mínimo caracteres definidos.', 'descricao', 'erro', '{"min_chars": 150}'::jsonb),
  (NULL, 'titulo_maximo', 'Título máximo', 'Título deverá possuir no máximo caracteres definidos.', 'titulo', 'aviso', '{"max_chars": 100}'::jsonb),
  (NULL, 'peso_obrigatorio', 'Peso obrigatório', 'Peso deverá ser informado (em gramas).', 'peso', 'erro', '{}'::jsonb),
  (NULL, 'dimensoes_obrigatorias', 'Dimensões obrigatórias', 'Altura, largura e profundidade obrigatórias (cm).', 'dimensoes', 'erro', '{}'::jsonb),
  (NULL, 'imagens_padrao', 'Imagens no padrão', 'PNG/JPG entre 500x500 e 2500x2500.', 'imagem', 'erro', '{"min":500,"max":2500,"formats":["png","jpg","jpeg"]}'::jsonb)
ON CONFLICT DO NOTHING;

-- =========================================================
-- 5) audit_runs + audit_results
-- =========================================================
CREATE TABLE IF NOT EXISTS public.audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pendente', -- pendente, executando, concluida, cancelada, erro
  rule_ids uuid[] NOT NULL DEFAULT '{}',
  product_ids uuid[] NOT NULL DEFAULT '{}',
  total_products int NOT NULL DEFAULT 0,
  processed_products int NOT NULL DEFAULT 0,
  errors_count int NOT NULL DEFAULT 0,
  warnings_count int NOT NULL DEFAULT 0,
  passed_count int NOT NULL DEFAULT 0,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_runs_company ON public.audit_runs(company_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_runs TO authenticated;
GRANT ALL ON public.audit_runs TO service_role;
ALTER TABLE public.audit_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "runs_members_all" ON public.audit_runs
  FOR ALL TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()))
  WITH CHECK (app_private.is_company_member(company_id, auth.uid()));
CREATE TRIGGER trg_audit_runs_updated_at BEFORE UPDATE ON public.audit_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.audit_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.bling_products(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.validation_rules(id) ON DELETE CASCADE,
  rule_slug text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL, -- pass | fail | skip
  message text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_results_run ON public.audit_results(run_id);
CREATE INDEX IF NOT EXISTS idx_audit_results_product ON public.audit_results(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_results_company_status ON public.audit_results(company_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_results TO authenticated;
GRANT ALL ON public.audit_results TO service_role;
ALTER TABLE public.audit_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "results_members_all" ON public.audit_results
  FOR ALL TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()))
  WITH CHECK (app_private.is_company_member(company_id, auth.uid()));

-- Coluna resumo no produto (última auditoria)
ALTER TABLE public.bling_products
  ADD COLUMN IF NOT EXISTS last_audit_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_audit_errors int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_audit_warnings int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_audit_passed int NOT NULL DEFAULT 0;
