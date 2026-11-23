ALTER TABLE public.bling_sync_jobs
  ADD COLUMN IF NOT EXISTS worker_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_invocation_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS worker_last_status TEXT,
  ADD COLUMN IF NOT EXISTS worker_last_error TEXT,
  ADD COLUMN IF NOT EXISTS last_request_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_request_endpoint TEXT,
  ADD COLUMN IF NOT EXISTS last_response_status INTEGER,
  ADD COLUMN IF NOT EXISTS last_response_body_safe TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_sync_jobs_worker_heartbeat
  ON public.bling_sync_jobs(worker_last_heartbeat_at)
  WHERE status IN ('pendente','catalogando','processando','retomando','pausada_por_limite','cancelando');

DROP INDEX IF EXISTS public.uniq_active_sync_per_integration;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_sync_per_integration
  ON public.bling_sync_jobs(integration_id)
  WHERE status IN ('pendente','catalogando','processando','pausada_por_limite','retomando','cancelando');

DROP FUNCTION IF EXISTS public.claim_next_sync_job(UUID);
CREATE OR REPLACE FUNCTION public.claim_next_sync_job(_job_id UUID DEFAULT NULL)
RETURNS TABLE(claimed BOOLEAN, job_id UUID, integration_id UUID, company_id UUID, phase TEXT, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT j.id, j.integration_id, j.company_id, j.phase
    FROM public.bling_sync_jobs j
    JOIN public.bling_integrations i ON i.id = j.integration_id
    WHERE j.status IN ('pendente','catalogando','processando','retomando','pausada_por_limite')
      AND COALESCE(j.cancel_requested, false) = false
      AND i.status = 'conectada'
      AND (_job_id IS NULL OR j.id = _job_id)
    ORDER BY j.last_activity_at NULLS FIRST, j.created_at ASC
    LIMIT 20
  LOOP
    IF pg_try_advisory_xact_lock(hashtextextended(r.integration_id::text, 0)) THEN
      UPDATE public.bling_sync_jobs
      SET claimed_at = now(),
          claimed_by = 'sync-tick',
          worker_last_status = 'claimed',
          last_activity_at = now()
      WHERE id = r.id;

      claimed := true;
      job_id := r.id;
      integration_id := r.integration_id;
      company_id := r.company_id;
      phase := r.phase;
      reason := NULL;
      RETURN NEXT;
      RETURN;
    END IF;
  END LOOP;

  claimed := false;
  job_id := NULL;
  integration_id := NULL;
  company_id := NULL;
  phase := NULL;
  reason := 'no_eligible_job';
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_next_sync_job(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_sync_job(UUID) TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bling-products-sync-safety-net') THEN
      PERFORM cron.unschedule('bling-products-sync-safety-net');
    END IF;

    PERFORM cron.schedule(
      'bling-products-sync-safety-net',
      '* * * * *',
      'SELECT net.http_post(
        url := ''https://meublingcorreto.lovable.app/api/public/bling/sync-tick'',
        headers := ''{""Content-Type"":""application/json"",""apikey"":""eyJhbGciOiJIUzI1NiIsInJlZiI6InphdmFicGdldGdib3Zkb2d6YXR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMjI4NjgsImV4cCI6MjA5OTY5ODg2OH0.ce9_V33AvX87ZM7AI_zZg6bkKFejq06UEaYjwBmtF5A""}''::jsonb,
        body := ''{}''::jsonb
      ) as request_id;'
    );
  END IF;
END $$;