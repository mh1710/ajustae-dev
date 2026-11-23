-- Automação de estoque multi-empresa:
-- claim paralelo por empresa + trava contra execução já em andamento.

CREATE OR REPLACE FUNCTION public.claim_due_automation_schedules(_limit integer DEFAULT 3)
RETURNS TABLE(id uuid, company_id uuid, slug text, options jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT s.id,
           s.company_id,
           EXISTS (
             SELECT 1 FROM public.automation_runs r
             WHERE r.company_id = s.company_id
               AND r.status = 'running'
               AND r.finished_at IS NULL
               AND r.started_at > now() - interval '2 hours'
           ) AS busy
      FROM public.automation_schedules s
     WHERE s.enabled AND s.next_run_at IS NOT NULL AND s.next_run_at <= now()
     ORDER BY s.next_run_at
     LIMIT GREATEST(COALESCE(_limit,3),1)
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.automation_schedules s
       SET last_run_at = CASE WHEN due.busy THEN s.last_run_at ELSE now() END,
           last_status = CASE WHEN due.busy THEN 'skipped_running' ELSE 'running' END,
           next_run_at = public.automation_next_run(
             s.frequency, s.hour, s.minute, s.weekday, s.day_of_month,
             s.interval_days, s.timezone, now())
      FROM due WHERE s.id = due.id
    RETURNING s.id, s.company_id, s.slug, s.options, due.busy
  )
  SELECT u.id, u.company_id, u.slug, u.options FROM upd u WHERE NOT u.busy;
END; $$;

REVOKE ALL ON FUNCTION public.claim_due_automation_schedules(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_automation_schedules(integer) TO service_role;

CREATE INDEX IF NOT EXISTS automation_runs_company_running_idx
  ON public.automation_runs (company_id, started_at) WHERE finished_at IS NULL;
