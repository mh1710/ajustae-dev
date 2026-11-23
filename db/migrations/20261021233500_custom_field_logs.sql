-- Registro de cada gravação de campos customizados no Bling, exibido nos Logs de envio.
CREATE TABLE IF NOT EXISTS public.bling_custom_field_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.bling_custom_field_jobs(id) ON DELETE SET NULL,
  product_id uuid,
  product_codigo text,
  product_nome text,
  status text NOT NULL CHECK (status IN ('concluido','erro')),
  campos text,
  erro text,
  response_status integer,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bcfl_company_idx ON public.bling_custom_field_logs(company_id, created_at DESC);
ALTER TABLE public.bling_custom_field_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bling_custom_field_logs FROM anon;
GRANT SELECT ON public.bling_custom_field_logs TO authenticated;
GRANT ALL ON public.bling_custom_field_logs TO service_role;
DROP POLICY IF EXISTS "members read cf logs" ON public.bling_custom_field_logs;
CREATE POLICY "members read cf logs" ON public.bling_custom_field_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = bling_custom_field_logs.company_id AND cu.user_id = auth.uid() AND cu.ativo));
