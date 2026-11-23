
CREATE TABLE IF NOT EXISTS public.bling_api_usage_daily (
  company_id uuid NOT NULL,
  dia date NOT NULL,
  total bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, dia)
);

GRANT SELECT ON public.bling_api_usage_daily TO authenticated;
GRANT ALL ON public.bling_api_usage_daily TO service_role;
ALTER TABLE public.bling_api_usage_daily ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bling_api_usage_daily' AND policyname = 'members_read_api_usage') THEN
    CREATE POLICY "members_read_api_usage" ON public.bling_api_usage_daily
      FOR SELECT TO authenticated
      USING (app_private.is_company_member(company_id, auth.uid()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.bump_bling_api_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.bling_api_usage_daily (company_id, dia, total, updated_at)
  VALUES (NEW.company_id, ((COALESCE(NEW.created_at, now())) AT TIME ZONE 'America/Sao_Paulo')::date, 1, now())
  ON CONFLICT (company_id, dia)
  DO UPDATE SET total = public.bling_api_usage_daily.total + 1, updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bump_bling_api_usage ON public.bling_api_calls;
CREATE TRIGGER trg_bump_bling_api_usage
AFTER INSERT ON public.bling_api_calls
FOR EACH ROW EXECUTE FUNCTION public.bump_bling_api_usage();

INSERT INTO public.bling_api_usage_daily (company_id, dia, total, updated_at)
SELECT company_id, (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia, count(*), now()
FROM public.bling_api_calls
WHERE company_id IS NOT NULL AND created_at >= now() - interval '7 days'
GROUP BY 1, 2
ON CONFLICT (company_id, dia) DO UPDATE SET total = EXCLUDED.total, updated_at = now();

CREATE INDEX IF NOT EXISTS idx_push_queue_integration_status ON public.bling_push_queue (integration_id, status);
CREATE INDEX IF NOT EXISTS idx_push_queue_company_updated ON public.bling_push_queue (company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bling_api_calls_created ON public.bling_api_calls (created_at);

CREATE OR REPLACE FUNCTION public.prune_old_operational_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.product_sheet_rows r
  USING public.import_batches b
  WHERE r.batch_id = b.id AND b.created_at < now() - interval '2 days';

  DELETE FROM public.audit_results a
  WHERE a.run_id IN (SELECT id FROM public.audit_runs WHERE created_at < now() - interval '3 days');

  DELETE FROM public.bling_api_calls WHERE created_at < now() - interval '7 days';

  DELETE FROM public.bling_push_queue
  WHERE status IN ('concluido','cancelado')
    AND COALESCE(processed_at, updated_at, created_at) < now() - interval '2 days';

  DELETE FROM public.bling_api_usage_daily WHERE dia < (now() AT TIME ZONE 'America/Sao_Paulo')::date - 60;
END $$;

SELECT cron.unschedule('prune-old-operational-data')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-old-operational-data');

SELECT cron.schedule('prune-old-operational-data', '0 7 * * *', $$SELECT public.prune_old_operational_data();$$);
