-- Transformações de IA em segundo plano: fila persistente, trava por execução,
-- progresso por produto e estados de pausa/cancelamento.

CREATE TABLE IF NOT EXISTS public.ai_transform_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid,
  kind text NOT NULL CHECK (kind IN ('shorten_title', 'remove_warranty', 'expand_short_desc', 'find_ean')),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'executando', 'pausado_creditos', 'pausado_limite', 'concluido', 'cancelado', 'erro')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  total int NOT NULL DEFAULT 0,
  done int NOT NULL DEFAULT 0,
  updated_count int NOT NULL DEFAULT 0,
  errors int NOT NULL DEFAULT 0,
  last_sku text,
  last_error text,
  claimed_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.ai_transform_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.ai_transform_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.bling_products(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'concluido', 'erro')),
  tentativas int NOT NULL DEFAULT 0,
  proxima_tentativa_em timestamptz NOT NULL DEFAULT now(),
  erro text,
  processed_at timestamptz,
  UNIQUE (job_id, product_id)
);

CREATE INDEX IF NOT EXISTS ai_transform_jobs_ativos_idx
  ON public.ai_transform_jobs (status, created_at)
  WHERE status IN ('pendente', 'executando', 'pausado_creditos', 'pausado_limite');
CREATE INDEX IF NOT EXISTS ai_transform_jobs_company_idx
  ON public.ai_transform_jobs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_transform_job_items_pendentes_idx
  ON public.ai_transform_job_items (job_id, proxima_tentativa_em)
  WHERE status = 'pendente';

GRANT SELECT ON public.ai_transform_jobs TO authenticated;
GRANT ALL ON public.ai_transform_jobs TO service_role;
GRANT SELECT ON public.ai_transform_job_items TO authenticated;
GRANT ALL ON public.ai_transform_job_items TO service_role;

ALTER TABLE public.ai_transform_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_transform_job_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view ai jobs" ON public.ai_transform_jobs;
CREATE POLICY "Members can view ai jobs"
  ON public.ai_transform_jobs FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

DROP POLICY IF EXISTS "Members can view ai job items" ON public.ai_transform_job_items;
CREATE POLICY "Members can view ai job items"
  ON public.ai_transform_job_items FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- Criar tarefa (idempotente por produto)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_ai_transform_job(
  _company_id uuid,
  _kind text,
  _product_ids uuid[],
  _params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  _job_id uuid;
  _total int := 0;
  _existing uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  IF _product_ids IS NULL OR array_length(_product_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('job_id', NULL, 'total', 0, 'reused', false);
  END IF;

  -- Uma tarefa ativa por empresa+tipo: acrescenta produtos na existente.
  SELECT id INTO _existing
  FROM public.ai_transform_jobs
  WHERE company_id = _company_id
    AND kind = _kind
    AND status IN ('pendente', 'executando', 'pausado_creditos', 'pausado_limite')
  ORDER BY created_at
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    _job_id := _existing;
  ELSE
    INSERT INTO public.ai_transform_jobs (company_id, user_id, kind, params, status)
    VALUES (_company_id, auth.uid(), _kind, COALESCE(_params, '{}'::jsonb), 'pendente')
    RETURNING id INTO _job_id;
  END IF;

  WITH ins AS (
    INSERT INTO public.ai_transform_job_items (job_id, company_id, product_id)
    SELECT _job_id, _company_id, p.id
    FROM public.bling_products p
    WHERE p.company_id = _company_id AND p.id = ANY(_product_ids)
    ON CONFLICT (job_id, product_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _total FROM ins;

  UPDATE public.ai_transform_jobs
     SET total = total + _total,
         status = CASE WHEN status IN ('pausado_creditos', 'pausado_limite') THEN status ELSE 'pendente' END,
         params = CASE WHEN _existing IS NULL THEN params ELSE params || COALESCE(_params, '{}'::jsonb) END,
         finished_at = NULL,
         updated_at = now()
   WHERE id = _job_id;

  RETURN jsonb_build_object('job_id', _job_id, 'total', _total, 'reused', _existing IS NOT NULL);
END;
$$;

-- ---------------------------------------------------------------------------
-- Reservar a próxima tarefa com trava por tempo (lease)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_next_ai_transform_job(
  _worker text,
  _lease_seconds int DEFAULT 120,
  _job_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, company_id uuid, kind text, params jsonb, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '20s', true);

  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM public.ai_transform_jobs j
    WHERE (_job_id IS NULL OR j.id = _job_id)
      AND j.status IN ('pendente', 'executando', 'pausado_limite')
      AND (j.lease_expires_at IS NULL OR j.lease_expires_at < now())
      AND EXISTS (
        SELECT 1 FROM public.ai_transform_job_items i
        WHERE i.job_id = j.id AND i.status = 'pendente'
      )
    ORDER BY j.created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.ai_transform_jobs j
       SET status = 'executando',
           claimed_at = now(),
           claimed_by = _worker,
           lease_expires_at = now() + make_interval(secs => GREATEST(_lease_seconds, 30)),
           updated_at = now()
      FROM picked
     WHERE j.id = picked.id
    RETURNING j.*
  )
  SELECT u.id, u.company_id, u.kind, u.params, u.status FROM upd u;
END;
$$;

-- Renova a trava enquanto o worker continua trabalhando.
CREATE OR REPLACE FUNCTION public.touch_ai_transform_job(_job_id uuid, _lease_seconds int DEFAULT 120)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _status text;
BEGIN
  UPDATE public.ai_transform_jobs
     SET lease_expires_at = now() + make_interval(secs => GREATEST(_lease_seconds, 30)),
         updated_at = now()
   WHERE id = _job_id
  RETURNING status INTO _status;
  RETURN _status;
END;
$$;

-- ---------------------------------------------------------------------------
-- Próximos produtos pendentes da tarefa
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_ai_transform_items(_job_id uuid, _limit int DEFAULT 10)
RETURNS TABLE(item_id uuid, product_id uuid, tentativas int)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT i.id, i.product_id, i.tentativas
  FROM public.ai_transform_job_items i
  WHERE i.job_id = _job_id
    AND i.status = 'pendente'
    AND i.proxima_tentativa_em <= now()
  ORDER BY i.proxima_tentativa_em, i.id
  LIMIT GREATEST(_limit, 1);
$$;

-- ---------------------------------------------------------------------------
-- Registrar o resultado de um produto (idempotente) e fechar a tarefa
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_ai_transform_item(
  _item_id uuid,
  _outcome text,
  _changed boolean DEFAULT false,
  _erro text DEFAULT NULL,
  _sku text DEFAULT NULL,
  _retry_in_seconds int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _job_id uuid;
  _status text;
  _pendentes int;
  _job_status text;
BEGIN
  SELECT job_id, status INTO _job_id, _status
  FROM public.ai_transform_job_items
  WHERE id = _item_id
  FOR UPDATE;

  IF _job_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'item inexistente');
  END IF;

  -- Já contabilizado: nada a fazer (retomada não duplica progresso).
  IF _status <> 'pendente' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  IF _outcome = 'retry' THEN
    UPDATE public.ai_transform_job_items
       SET tentativas = tentativas + 1,
           erro = _erro,
           proxima_tentativa_em = now() + make_interval(secs => GREATEST(COALESCE(_retry_in_seconds, 30), 5))
     WHERE id = _item_id;
    UPDATE public.ai_transform_jobs
       SET last_error = COALESCE(_erro, last_error), updated_at = now()
     WHERE id = _job_id;
    RETURN jsonb_build_object('ok', true, 'retry', true);
  END IF;

  UPDATE public.ai_transform_job_items
     SET status = CASE WHEN _outcome = 'erro' THEN 'erro' ELSE 'concluido' END,
         tentativas = tentativas + 1,
         erro = _erro,
         processed_at = now()
   WHERE id = _item_id;

  UPDATE public.ai_transform_jobs
     SET done = done + 1,
         updated_count = updated_count + CASE WHEN _changed THEN 1 ELSE 0 END,
         errors = errors + CASE WHEN _outcome = 'erro' THEN 1 ELSE 0 END,
         last_sku = COALESCE(_sku, last_sku),
         last_error = CASE WHEN _outcome = 'erro' THEN COALESCE(_erro, last_error) ELSE last_error END,
         updated_at = now()
   WHERE id = _job_id;

  SELECT count(*) INTO _pendentes
  FROM public.ai_transform_job_items
  WHERE job_id = _job_id AND status = 'pendente';

  SELECT status INTO _job_status FROM public.ai_transform_jobs WHERE id = _job_id;

  IF _pendentes = 0 AND _job_status NOT IN ('cancelado', 'pausado_creditos') THEN
    UPDATE public.ai_transform_jobs
       SET status = 'concluido', finished_at = now(), lease_expires_at = NULL, updated_at = now()
     WHERE id = _job_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'pendentes', _pendentes);
END;
$$;

-- ---------------------------------------------------------------------------
-- Pausa (créditos/limite), retomada, cancelamento e liberação da trava
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pause_ai_transform_job(_job_id uuid, _status text, _erro text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _status NOT IN ('pausado_creditos', 'pausado_limite', 'erro') THEN
    RAISE EXCEPTION 'status inválido para pausa: %', _status;
  END IF;
  UPDATE public.ai_transform_jobs
     SET status = _status,
         last_error = COALESCE(_erro, last_error),
         lease_expires_at = NULL,
         updated_at = now()
   WHERE id = _job_id AND status NOT IN ('cancelado', 'concluido');
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_ai_transform_job(_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.ai_transform_jobs
     SET lease_expires_at = NULL,
         status = CASE
           WHEN status = 'executando' AND EXISTS (
             SELECT 1 FROM public.ai_transform_job_items i WHERE i.job_id = _job_id AND i.status = 'pendente'
           ) THEN 'pendente'
           WHEN status = 'executando' THEN 'concluido'
           ELSE status
         END,
         finished_at = CASE
           WHEN status = 'executando' AND NOT EXISTS (
             SELECT 1 FROM public.ai_transform_job_items i WHERE i.job_id = _job_id AND i.status = 'pendente'
           ) THEN now() ELSE finished_at END,
         updated_at = now()
   WHERE id = _job_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_ai_transform_job(_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ai_transform_jobs j
    JOIN public.company_users cu ON cu.company_id = j.company_id
    WHERE j.id = _job_id AND cu.user_id = auth.uid() AND cu.ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  UPDATE public.ai_transform_jobs
     SET status = 'pendente', last_error = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE id = _job_id AND status IN ('pausado_creditos', 'pausado_limite', 'erro');
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_ai_transform_job(_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ai_transform_jobs j
    JOIN public.company_users cu ON cu.company_id = j.company_id
    WHERE j.id = _job_id AND cu.user_id = auth.uid() AND cu.ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  UPDATE public.ai_transform_jobs
     SET status = 'cancelado', finished_at = now(), lease_expires_at = NULL, updated_at = now()
   WHERE id = _job_id AND status NOT IN ('concluido', 'cancelado');

  DELETE FROM public.ai_transform_job_items WHERE job_id = _job_id AND status = 'pendente';
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- Progresso para o indicador flutuante
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ai_transform_progress(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _res jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x_created DESC), '[]'::jsonb) INTO _res
  FROM (
    SELECT jsonb_build_object(
             'id', j.id,
             'kind', j.kind,
             'status', j.status,
             'total', j.total,
             'done', j.done,
             'updated_count', j.updated_count,
             'errors', j.errors,
             'last_sku', j.last_sku,
             'last_error', j.last_error,
             'created_at', j.created_at,
             'finished_at', j.finished_at
           ) AS x,
           j.created_at AS x_created
    FROM public.ai_transform_jobs j
    WHERE j.company_id = _company_id
      AND (
        j.status IN ('pendente', 'executando', 'pausado_creditos', 'pausado_limite')
        OR j.updated_at > now() - interval '2 minutes'
      )
    LIMIT 10
  ) s;

  RETURN _res;
END;
$$;

-- Libera tarefas cuja trava expirou (worker interrompido).
CREATE OR REPLACE FUNCTION public.reclaim_stuck_ai_transform_jobs()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n int;
BEGIN
  WITH upd AS (
    UPDATE public.ai_transform_jobs
       SET status = 'pendente', lease_expires_at = NULL, updated_at = now()
     WHERE status = 'executando'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at < now()
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM upd;
  RETURN COALESCE(_n, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_ai_transform_job(uuid, text, uuid[], jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.claim_next_ai_transform_job(text, int, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_ai_transform_job(uuid, int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_ai_transform_items(uuid, int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_ai_transform_item(uuid, text, boolean, text, text, int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.pause_ai_transform_job(uuid, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_ai_transform_job(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.reclaim_stuck_ai_transform_jobs() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.resume_ai_transform_job(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.cancel_ai_transform_job(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.get_ai_transform_progress(uuid) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.enqueue_ai_transform_job(uuid, text, uuid[], jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resume_ai_transform_job(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_ai_transform_job(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_transform_progress(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_ai_transform_job(text, int, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.touch_ai_transform_job(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_ai_transform_items(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_ai_transform_item(uuid, text, boolean, text, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.pause_ai_transform_job(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ai_transform_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reclaim_stuck_ai_transform_jobs() TO service_role;
