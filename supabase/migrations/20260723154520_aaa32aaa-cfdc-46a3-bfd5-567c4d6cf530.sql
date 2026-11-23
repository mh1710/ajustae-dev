-- Catálogo de campos personalizados por integração
CREATE TABLE public.bling_custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  bling_id_campo text NOT NULL,
  nome text,
  tipo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, bling_id_campo)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bling_custom_fields TO authenticated;
GRANT ALL ON public.bling_custom_fields TO service_role;
ALTER TABLE public.bling_custom_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view custom fields" ON public.bling_custom_fields
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.company_users
            WHERE company_id = bling_custom_fields.company_id
              AND user_id = auth.uid() AND ativo = true)
  );

-- Valores dos campos personalizados por produto
CREATE TABLE public.bling_product_custom_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.bling_products(id) ON DELETE CASCADE,
  custom_field_id uuid NOT NULL REFERENCES public.bling_custom_fields(id) ON DELETE CASCADE,
  id_vinculo text,
  valor text,
  dirty boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, custom_field_id)
);
CREATE INDEX idx_bling_product_custom_values_product ON public.bling_product_custom_values(product_id);
CREATE INDEX idx_bling_product_custom_values_company ON public.bling_product_custom_values(company_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bling_product_custom_values TO authenticated;
GRANT ALL ON public.bling_product_custom_values TO service_role;
ALTER TABLE public.bling_product_custom_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view custom values" ON public.bling_product_custom_values
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.company_users
            WHERE company_id = bling_product_custom_values.company_id
              AND user_id = auth.uid() AND ativo = true)
  );

-- Jobs de importação em lote de campos personalizados
CREATE TABLE public.bling_custom_fields_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'todos',
  product_ids uuid[],
  total int NOT NULL DEFAULT 0,
  processed int NOT NULL DEFAULT 0,
  ok int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente',
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  cancel_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scope IN ('todos','sem_campos','selecionados')),
  CHECK (status IN ('pendente','processando','concluida','erro','cancelada'))
);
CREATE INDEX idx_bling_cf_import_jobs_company_status ON public.bling_custom_fields_import_jobs(company_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bling_custom_fields_import_jobs TO authenticated;
GRANT ALL ON public.bling_custom_fields_import_jobs TO service_role;
ALTER TABLE public.bling_custom_fields_import_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view cf import jobs" ON public.bling_custom_fields_import_jobs
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.company_users
            WHERE company_id = bling_custom_fields_import_jobs.company_id
              AND user_id = auth.uid() AND ativo = true)
  );

-- updated_at triggers (função já existe no projeto)
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_bling_custom_fields_updated BEFORE UPDATE
  ON public.bling_custom_fields
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_bling_product_custom_values_updated BEFORE UPDATE
  ON public.bling_product_custom_values
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_bling_cf_import_jobs_updated BEFORE UPDATE
  ON public.bling_custom_fields_import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();