-- Páginas com erro na sincronização de multilojas: ficam empilhadas para
-- reprocessamento individual, em vez de travar/pular silenciosamente.
CREATE TABLE IF NOT EXISTS public.bling_store_sync_page_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.bling_store_sync_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'full',
  bling_product_id text,
  page integer NOT NULL,
  http_status integer,
  error_message text,
  attempts integer NOT NULL DEFAULT 1,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  last_retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bling_store_sync_page_errors_uk
  ON public.bling_store_sync_page_errors (job_id, page);
CREATE INDEX IF NOT EXISTS bling_store_sync_page_errors_company_idx
  ON public.bling_store_sync_page_errors (company_id, resolved, created_at DESC);

GRANT SELECT ON public.bling_store_sync_page_errors TO authenticated;
GRANT ALL ON public.bling_store_sync_page_errors TO service_role;

ALTER TABLE public.bling_store_sync_page_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member reads store page errors" ON public.bling_store_sync_page_errors;
CREATE POLICY "member reads store page errors"
ON public.bling_store_sync_page_errors
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.company_users cu
  WHERE cu.company_id = bling_store_sync_page_errors.company_id
    AND cu.user_id = auth.uid()
    AND cu.ativo = true
));

DROP TRIGGER IF EXISTS tg_bling_store_sync_page_errors_upd ON public.bling_store_sync_page_errors;
CREATE TRIGGER tg_bling_store_sync_page_errors_upd
BEFORE UPDATE ON public.bling_store_sync_page_errors
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
