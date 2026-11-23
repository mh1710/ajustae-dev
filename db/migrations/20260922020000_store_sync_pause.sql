-- Pausar / retomar a sincronização de multilojas (diferente de cancelar).

-- Enquanto pausada, a integração continua "ocupada": não deixa iniciar outra sync.
DROP INDEX IF EXISTS public.bling_store_sync_jobs_active_uk;
CREATE UNIQUE INDEX bling_store_sync_jobs_active_uk
  ON public.bling_store_sync_jobs (integration_id)
  WHERE status = ANY (ARRAY['pendente'::text, 'processando'::text, 'pausada'::text, 'cancelando'::text]);

CREATE OR REPLACE FUNCTION public.pause_bling_stores_sync(
  _company_id uuid,
  _job_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
       SET status = 'pausada',
           claimed_at = NULL,
           cancel_requested = false,
           last_error = 'Pausado pelo usuário.'
     WHERE company_id = _company_id
       AND (_job_id IS NULL OR id = _job_id)
       AND status IN ('pendente','processando','cancelando','retomando','catalogando')
    RETURNING 1
  ) SELECT count(*) INTO _n FROM upd;

  RETURN jsonb_build_object('paused', _n);
END;
$$;

CREATE OR REPLACE FUNCTION public.unpause_bling_stores_sync(
  _company_id uuid,
  _job_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int := 0; _id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
     WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH upd AS (
    UPDATE public.bling_store_sync_jobs
       SET status = 'pendente',
           cancel_requested = false,
           claimed_at = NULL,
           finished_at = NULL,
           last_error = NULL
     WHERE company_id = _company_id
       AND (_job_id IS NULL OR id = _job_id)
       AND status = 'pausada'
    RETURNING id
  ) SELECT count(*), min(id) INTO _n, _id FROM upd;

  RETURN jsonb_build_object('resumed', _n, 'job_id', _id);
END;
$$;

-- Cancelar deve encerrar também jobs pausados.
CREATE OR REPLACE FUNCTION public.request_cancel_bling_stores_sync(
  _company_id uuid,
  _job_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
           last_error = COALESCE(NULLIF(last_error, 'Pausado pelo usuário.'), 'Cancelado pelo usuário.')
     WHERE company_id = _company_id
       AND (_job_id IS NULL OR id = _job_id)
       AND status IN ('pendente','processando','cancelando','retomando','catalogando','pausada')
    RETURNING 1
  ) SELECT count(*) INTO _n FROM upd;

  RETURN jsonb_build_object('cancelled', _n);
END;
$$;

REVOKE ALL ON FUNCTION public.pause_bling_stores_sync(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unpause_bling_stores_sync(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pause_bling_stores_sync(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unpause_bling_stores_sync(uuid, uuid) TO authenticated, service_role;
