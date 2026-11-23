
-- =========================================================
-- bling_products
-- =========================================================
CREATE TABLE public.bling_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  bling_product_id TEXT NOT NULL,
  codigo TEXT,
  nome TEXT,
  descricao_curta TEXT,
  descricao_complementar TEXT,
  tipo TEXT,
  formato TEXT,
  situacao TEXT,
  unidade TEXT,
  gtin TEXT,
  gtin_embalagem TEXT,
  preco NUMERIC(14,4),
  preco_custo NUMERIC(14,4),
  estoque_minimo NUMERIC(14,4),
  estoque_maximo NUMERIC(14,4),
  garantia TEXT,
  peso_liquido NUMERIC(14,4),
  peso_bruto NUMERIC(14,4),
  largura NUMERIC(14,4),
  altura NUMERIC(14,4),
  profundidade NUMERIC(14,4),
  marca TEXT,
  categoria_id TEXT,
  fornecedor_id TEXT,
  imagem_principal_url TEXT,
  dados_resumidos_json JSONB,
  dados_completos_json JSONB,
  detail_synced BOOLEAN NOT NULL DEFAULT false,
  detail_sync_error TEXT,
  detail_synced_at TIMESTAMPTZ,
  last_seen_sync_job_id UUID,
  bling_created_at TIMESTAMPTZ,
  bling_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration_id, bling_product_id)
);

CREATE INDEX idx_bling_products_company ON public.bling_products(company_id);
CREATE INDEX idx_bling_products_codigo ON public.bling_products(codigo);
CREATE INDEX idx_bling_products_gtin ON public.bling_products(gtin);
CREATE INDEX idx_bling_products_situacao ON public.bling_products(situacao);
CREATE INDEX idx_bling_products_detail_synced ON public.bling_products(integration_id, detail_synced);

GRANT SELECT ON public.bling_products TO authenticated;
GRANT ALL ON public.bling_products TO service_role;

ALTER TABLE public.bling_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view products"
  ON public.bling_products FOR SELECT
  TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));

CREATE TRIGGER trg_bling_products_updated_at
  BEFORE UPDATE ON public.bling_products
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================
-- bling_sync_jobs
-- =========================================================
CREATE TABLE public.bling_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  resource TEXT NOT NULL DEFAULT 'produtos',
  sync_type TEXT NOT NULL DEFAULT 'full',
  phase TEXT NOT NULL DEFAULT 'catalogacao',
  status TEXT NOT NULL DEFAULT 'pendente',
  current_page INTEGER NOT NULL DEFAULT 1,
  page_size INTEGER NOT NULL DEFAULT 100,
  total_pages_processed INTEGER NOT NULL DEFAULT 0,
  total_items INTEGER,
  cataloged_items INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  successful_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  remaining_items INTEGER,
  progress_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  catalog_finished_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  estimated_finish_at TIMESTAMPTZ,
  elapsed_seconds INTEGER,
  estimated_remaining_seconds INTEGER,
  average_seconds_per_item NUMERIC(10,4),
  requests_made INTEGER NOT NULL DEFAULT 0,
  retries_count INTEGER NOT NULL DEFAULT 0,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  last_product_id TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  pause_reason TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_jobs_company ON public.bling_sync_jobs(company_id);
CREATE INDEX idx_sync_jobs_status ON public.bling_sync_jobs(status);
CREATE INDEX idx_sync_jobs_active_integration ON public.bling_sync_jobs(integration_id, status);

GRANT SELECT ON public.bling_sync_jobs TO authenticated;
GRANT ALL ON public.bling_sync_jobs TO service_role;

ALTER TABLE public.bling_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view sync jobs"
  ON public.bling_sync_jobs FOR SELECT
  TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));

CREATE TRIGGER trg_bling_sync_jobs_updated_at
  BEFORE UPDATE ON public.bling_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Only one active sync job per integration at a time
CREATE UNIQUE INDEX uniq_active_sync_per_integration
  ON public.bling_sync_jobs(integration_id)
  WHERE status IN ('pendente','catalogando','processando','pausada_por_limite','pausada_por_erro','retomando','cancelando');

-- =========================================================
-- bling_sync_job_errors
-- =========================================================
CREATE TABLE public.bling_sync_job_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_job_id UUID NOT NULL REFERENCES public.bling_sync_jobs(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  bling_product_id TEXT,
  phase TEXT,
  endpoint TEXT,
  http_status INTEGER,
  error_code TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_job_errors_job ON public.bling_sync_job_errors(sync_job_id);
CREATE INDEX idx_sync_job_errors_company ON public.bling_sync_job_errors(company_id);

GRANT SELECT ON public.bling_sync_job_errors TO authenticated;
GRANT ALL ON public.bling_sync_job_errors TO service_role;

ALTER TABLE public.bling_sync_job_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view sync errors"
  ON public.bling_sync_job_errors FOR SELECT
  TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));

CREATE TRIGGER trg_bling_sync_errors_updated_at
  BEFORE UPDATE ON public.bling_sync_job_errors
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================
-- Helper: claim next active job for a worker tick.
-- Uses advisory lock keyed on integration to prevent concurrent workers
-- on the same integration.
-- =========================================================
CREATE OR REPLACE FUNCTION public.claim_next_sync_job(_job_id UUID DEFAULT NULL)
RETURNS TABLE(id UUID, integration_id UUID, company_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT j.id, j.integration_id, j.company_id
    FROM public.bling_sync_jobs j
    WHERE j.status IN ('pendente','catalogando','processando','retomando','cancelando')
      AND (_job_id IS NULL OR j.id = _job_id)
    ORDER BY j.last_activity_at NULLS FIRST, j.created_at ASC
    LIMIT 20
  LOOP
    IF pg_try_advisory_xact_lock(hashtextextended(r.integration_id::text, 0)) THEN
      id := r.id; integration_id := r.integration_id; company_id := r.company_id;
      RETURN NEXT;
      RETURN;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_next_sync_job(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_sync_job(UUID) TO service_role;
