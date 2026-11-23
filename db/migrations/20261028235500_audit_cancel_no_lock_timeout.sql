-- Cancelar auditoria: interrompe primeiro quem segura a linha (etapa final),
-- depois grava 'cancelada' com novas tentativas, evitando "lock timeout".
CREATE OR REPLACE FUNCTION public.cancel_audit_run_hard(_run_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _pid int;
  _company uuid;
  _p record;
  _i int;
BEGIN
  SELECT worker_pid, company_id INTO _pid, _company
  FROM public.audit_runs WHERE id = _run_id;
  IF _company IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  FOR _i IN 1..8 LOOP
    IF _pid IS NOT NULL THEN PERFORM pg_cancel_backend(_pid); END IF;
    FOR _p IN
      SELECT pid FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND state <> 'idle'
        AND query LIKE '%' || _run_id::text || '%'
    LOOP
      PERFORM pg_cancel_backend(_p.pid);
    END LOOP;

    BEGIN
      PERFORM set_config('lock_timeout', '2s', true);
      UPDATE public.audit_runs
        SET status = 'cancelada',
            finished_at = COALESCE(finished_at, now()),
            duration_ms = COALESCE(duration_ms,
              CASE WHEN started_at IS NOT NULL
                   THEN (extract(epoch FROM (now() - started_at)) * 1000)::int
                   ELSE NULL END),
            worker_pid = NULL
        WHERE id = _run_id AND status = 'processando';
      RETURN true;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.5);
    END;
  END LOOP;
  RAISE EXCEPTION 'A auditoria está finalizando agora; tente cancelar de novo em alguns segundos.';
END;
$function$;
