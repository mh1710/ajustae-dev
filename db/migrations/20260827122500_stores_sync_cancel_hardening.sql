-- Pausa/cancelamento definitivo da sincronização de multilojas.

CREATE OR REPLACE FUNCTION public.request_cancel_bling_stores_sync(_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _n int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.bling_store_sync_jobs
       SET cancel_requested = true,
           status = 'cancelada',
           finished_at = now(),
           last_error = COALESCE(last_error, 'Cancelado pelo usuário.')
     WHERE id = _job_id
       AND status IN ('pendente','processando','cancelando','retomando','catalogando')
    RETURNING 1
  ) SELECT count(*) INTO _n FROM upd;
  RETURN _n > 0;
END; $function$;

CREATE OR REPLACE FUNCTION public.request_cancel_bling_stores_sync(_company_id uuid, _job_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _n int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
     WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH upd AS (
    UPDATE public.bling_store_sync_jobs
       SET cancel_requested = true,
           status = 'cancelada',
           finished_at = now(),
           last_error = COALESCE(last_error, 'Cancelado pelo usuário.')
     WHERE company_id = _company_id
       AND (_job_id IS NULL OR id = _job_id)
       AND status IN ('pendente','processando','cancelando','retomando','catalogando')
    RETURNING 1
  ) SELECT count(*) INTO _n FROM upd;

  RETURN jsonb_build_object('cancelled', _n);
END; $function$;

CREATE OR REPLACE FUNCTION public.finish_bling_stores_page(
  _job_id uuid, _page integer, _total_pages integer, _found integer,
  _inserted integer, _updated integer, _matched integer, _unmatched integer,
  _errors integer, _next_page integer, _last_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.bling_store_sync_jobs
     WHERE id = _job_id AND (cancel_requested = true OR status = 'cancelada')
  ) THEN
    RETURN;
  END IF;

  UPDATE public.bling_store_sync_jobs SET
    paginas_processadas = paginas_processadas + 1,
    proxima_pagina = COALESCE(_next_page, proxima_pagina),
    total_paginas = COALESCE(_total_pages, total_paginas),
    vinculos_encontrados = vinculos_encontrados + COALESCE(_found,0),
    vinculos_salvos = vinculos_salvos + COALESCE(_inserted,0),
    vinculos_atualizados = vinculos_atualizados + COALESCE(_updated,0),
    produtos_relacionados = produtos_relacionados + COALESCE(_matched,0),
    produtos_nao_encontrados = produtos_nao_encontrados + COALESCE(_unmatched,0),
    erros = erros + COALESCE(_errors,0),
    last_error = COALESCE(_last_error, last_error)
   WHERE id = _job_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.finish_bling_stores_job(_job_id uuid, _status text, _last_error text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _job public.bling_store_sync_jobs%ROWTYPE;
BEGIN
  SELECT * INTO _job FROM public.bling_store_sync_jobs WHERE id = _job_id;
  IF _job.id IS NULL THEN RETURN; END IF;

  IF (_job.cancel_requested OR _job.status = 'cancelada') AND _status <> 'cancelada' THEN
    RETURN;
  END IF;

  UPDATE public.bling_store_sync_jobs
     SET status = _status, finished_at = now(),
         last_error = COALESCE(_last_error, last_error)
   WHERE id = _job_id;

  IF _status = 'concluida' AND _job.scope = 'full' THEN
    UPDATE public.bling_product_stores
       SET is_linked = false, updated_at = now()
     WHERE integration_id = _job.integration_id
       AND (last_seen_run_id IS NULL OR last_seen_run_id <> _job_id)
       AND is_linked = true;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.cleanup_stuck_bling_stores_jobs(_minutes integer DEFAULT 15)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _n int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.bling_store_sync_jobs
       SET status = 'cancelada',
           cancel_requested = true,
           finished_at = now(),
           last_error = COALESCE(last_error, 'Job travado — finalizado automaticamente.')
     WHERE status IN ('processando','retomando','catalogando','cancelando','pendente')
       AND COALESCE(claimed_at, started_at, created_at) < now() - make_interval(mins => GREATEST(_minutes, 1))
    RETURNING 1
  ) SELECT count(*) INTO _n FROM upd;
  RETURN _n;
END; $function$;

GRANT EXECUTE ON FUNCTION public.request_cancel_bling_stores_sync(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_cancel_bling_stores_sync(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_stuck_bling_stores_jobs(integer) TO authenticated, service_role;
