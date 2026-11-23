CREATE TABLE IF NOT EXISTS public.cdn_image_propagation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','processando','pausado','concluido','erro','cancelado')),
  total_products integer NOT NULL DEFAULT 0,
  processed_products integer NOT NULL DEFAULT 0,
  updated_products integer NOT NULL DEFAULT 0,
  skipped_products integer NOT NULL DEFAULT 0,
  error_products integer NOT NULL DEFAULT 0,
  next_offset integer NOT NULL DEFAULT 0,
  batch_size integer NOT NULL DEFAULT 100,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cdn_image_propagation_jobs_status_idx
  ON public.cdn_image_propagation_jobs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS cdn_image_propagation_jobs_company_idx
  ON public.cdn_image_propagation_jobs(company_id, updated_at DESC);

DROP TRIGGER IF EXISTS cdn_image_propagation_jobs_updated_at ON public.cdn_image_propagation_jobs;
CREATE TRIGGER cdn_image_propagation_jobs_updated_at
BEFORE UPDATE ON public.cdn_image_propagation_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_cdn_image_propagation_updated_at();

ALTER TABLE public.cdn_image_propagation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cdn_image_propagation_jobs_select_admin ON public.cdn_image_propagation_jobs;
CREATE POLICY cdn_image_propagation_jobs_select_admin
ON public.cdn_image_propagation_jobs FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.company_users cu
  WHERE cu.company_id = cdn_image_propagation_jobs.company_id
    AND cu.user_id = auth.uid() AND cu.ativo = true
));

GRANT SELECT ON public.cdn_image_propagation_jobs TO authenticated;
