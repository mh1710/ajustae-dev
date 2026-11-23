-- Retomada automática: quando uma execução é interrompida pelo tempo limite
-- do servidor, o tick a relança sozinho (até 2 tentativas por agendamento).
-- O contador zera quando uma execução termina com sucesso.

ALTER TABLE public.automation_schedules
  ADD COLUMN IF NOT EXISTS auto_retry_count integer NOT NULL DEFAULT 0;

-- remove a versão antiga para evitar sobrecarga ambígua
DROP FUNCTION IF EXISTS public.reclaim_stuck_automation_runs(integer);

CREATE OR REPLACE FUNCTION public.reclaim_stuck_automation_runs(
  _minutes integer DEFAULT 5,
  _url text DEFAULT NULL,
  _secret text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $function$
DECLARE
  _runs integer := 0;
  _schedules integer := 0;
  _retried integer := 0;
  _retried_ids uuid[] := '{}';
  _rec record;
BEGIN
  -- 1) Execuções presas cujo agendamento ainda pode tentar de novo: relança.
  FOR _rec IN
    SELECT r.id AS run_id, s.id AS schedule_id
    FROM public.automation_runs r
    JOIN public.automation_schedules s ON s.last_run_id = r.id
    WHERE r.status = 'running'
      AND r.finished_at IS NULL
      AND r.updated_at < now() - make_interval(mins => GREATEST(COALESCE(_minutes, 5), 2))
      AND s.enabled
      AND s.auto_retry_count < 2
      AND _url IS NOT NULL
      AND _secret IS NOT NULL
  LOOP
    UPDATE public.automation_runs
       SET status = 'error',
           error = 'Execução interrompida pelo tempo limite; retomando automaticamente.',
           finished_at = now(),
           current_step = NULL
     WHERE id = _rec.run_id;

    UPDATE public.automation_schedules
       SET auto_retry_count = auto_retry_count + 1
     WHERE id = _rec.schedule_id;

    PERFORM public.enqueue_automation_run(_url, _secret, _rec.schedule_id);

    _retried := _retried + 1;
    _retried_ids := _retried_ids || _rec.schedule_id;
  END LOOP;

  -- 2) Execuções presas sem direito a nova tentativa: encerra como erro.
  WITH stale AS (
    UPDATE public.automation_runs
       SET status = 'error',
           error = 'Execução interrompida automaticamente após tentativas de retomada. Ela poderá ser executada novamente.',
           finished_at = now(),
           current_step = NULL
     WHERE status = 'running'
       AND finished_at IS NULL
       AND updated_at < now() - make_interval(mins => GREATEST(COALESCE(_minutes, 5), 2))
     RETURNING id
  ) SELECT count(*) INTO _runs FROM stale;

  WITH fixed AS (
    UPDATE public.automation_schedules s
       SET last_status = 'error'
     WHERE s.last_status = 'running'
       AND s.last_run_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.automation_runs r
         WHERE r.id = s.last_run_id AND r.status = 'error'
       )
       AND NOT (s.id = ANY(_retried_ids))
     RETURNING s.id
  ) SELECT count(*) INTO _schedules FROM fixed;

  RETURN jsonb_build_object(
    'runs', _runs,
    'schedules', _schedules,
    'retried', _retried,
    'retried_schedule_ids', to_jsonb(_retried_ids)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reclaim_stuck_automation_runs(integer, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_stuck_automation_runs(integer, text, text) TO service_role;
