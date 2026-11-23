-- Perfis reutilizaveis para mapear planilhas de fornecedores para o cadastro interno.
CREATE TABLE IF NOT EXISTS public.supplier_import_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fornecedor_id uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  name text NOT NULL,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  value_mappings jsonb NOT NULL DEFAULT '[]'::jsonb,
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  header_signature jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, fornecedor_id, name)
);

CREATE INDEX IF NOT EXISTS idx_supplier_import_profiles_scope
  ON public.supplier_import_profiles(company_id, fornecedor_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_import_profiles_default
  ON public.supplier_import_profiles(company_id, fornecedor_id)
  WHERE is_default;

ALTER TABLE public.supplier_import_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_import_profiles TO authenticated;
GRANT ALL ON public.supplier_import_profiles TO service_role;

CREATE POLICY "supplier_import_profiles_members_all"
  ON public.supplier_import_profiles
  FOR ALL TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()))
  WITH CHECK (app_private.is_company_member(company_id, auth.uid()));

CREATE TRIGGER trg_supplier_import_profiles_updated_at
  BEFORE UPDATE ON public.supplier_import_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Staging exclusivo: não reutiliza nem altera as tabelas genéricas de importação.
CREATE TABLE IF NOT EXISTS public.supplier_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fornecedor_id uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.supplier_import_profiles(id) ON DELETE SET NULL,
  created_by uuid NOT NULL,
  file jsonb NOT NULL,
  mapping_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  value_mappings_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  rules_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  header_signature jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'processando',
  total_rows integer NOT NULL DEFAULT 0,
  processed_rows integer NOT NULL DEFAULT 0,
  new_count integer NOT NULL DEFAULT 0,
  existing_count integer NOT NULL DEFAULT 0,
  filtered_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.supplier_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.supplier_import_batches(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  file_name text,
  row_number integer NOT NULL,
  sku text,
  bling_id text,
  gtin text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  parsed jsonb NOT NULL DEFAULT '{}'::jsonb,
  transformation_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  match_type text,
  match_product_id uuid REFERENCES public.bling_products(id) ON DELETE SET NULL,
  action text NOT NULL DEFAULT 'ignore',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_supplier_import_batches_scope
  ON public.supplier_import_batches(company_id, fornecedor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_import_rows_batch
  ON public.supplier_import_rows(batch_id, row_number);

ALTER TABLE public.supplier_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_import_rows ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_import_batches, public.supplier_import_rows TO authenticated;
GRANT ALL ON public.supplier_import_batches, public.supplier_import_rows TO service_role;

CREATE POLICY "supplier_import_batches_members_all" ON public.supplier_import_batches
  FOR ALL TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()))
  WITH CHECK (app_private.is_company_member(company_id, auth.uid()));
CREATE POLICY "supplier_import_rows_members_all" ON public.supplier_import_rows
  FOR ALL TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()))
  WITH CHECK (app_private.is_company_member(company_id, auth.uid()));
