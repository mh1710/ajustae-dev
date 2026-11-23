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
    WHERE (
        (j.status IN ('pendente','catalogando','processando','retomando','pausada_por_limite') AND COALESCE(j.cancel_requested, false) = false)
        OR j.status = 'cancelando'
        OR COALESCE(j.cancel_requested, false) = true
      )
      AND j.status NOT IN ('concluida','concluida_com_erros','cancelada','pausada_por_erro')
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