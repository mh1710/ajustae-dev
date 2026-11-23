
-- =========================
-- 1) AUTOMATION SCHEDULES
-- =========================
CREATE TABLE IF NOT EXISTS public.automation_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid,
  slug text NOT NULL DEFAULT 'estoque-preco-fornecedor',
  name text NOT NULL DEFAULT 'Automação programada',
  enabled boolean NOT NULL DEFAULT true,
  frequency text NOT NULL DEFAULT 'daily',
  hour integer NOT NULL DEFAULT 3,
  minute integer NOT NULL DEFAULT 0,
  weekday integer,
  day_of_month integer,
  interval_days integer,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  options jsonb NOT NULL DEFAULT '{"include_stores": true, "apply_status": true}'::jsonb,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_id uuid,
  last_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_schedules_frequency_chk CHECK (frequency IN ('daily','weekly','monthly','interval')),
  CONSTRAINT automation_schedules_hour_chk CHECK (hour BETWEEN 0 AND 23),
  CONSTRAINT automation_schedules_minute_chk CHECK (minute BETWEEN 0 AND 59)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_schedules TO authenticated;
GRANT ALL ON public.automation_schedules TO service_role;
ALTER TABLE public.automation_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members manage automation schedules" ON public.automation_schedules;
CREATE POLICY "members manage automation schedules"
ON public.automation_schedules FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.company_users cu
   WHERE cu.company_id = automation_schedules.company_id AND cu.user_id = auth.uid() AND cu.ativo = true))
WITH CHECK (EXISTS (SELECT 1 FROM public.company_users cu
   WHERE cu.company_id = automation_schedules.company_id AND cu.user_id = auth.uid() AND cu.ativo = true));

DROP TRIGGER IF EXISTS trg_automation_schedules_updated_at ON public.automation_schedules;
CREATE TRIGGER trg_automation_schedules_updated_at
BEFORE UPDATE ON public.automation_schedules
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS automation_schedules_due_idx
  ON public.automation_schedules (next_run_at) WHERE enabled;

-- Next run calculation (local timezone aware)
CREATE OR REPLACE FUNCTION public.automation_next_run(
  _frequency text, _hour integer, _minute integer, _weekday integer,
  _day_of_month integer, _interval_days integer, _timezone text, _from timestamptz
) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  tz text := COALESCE(NULLIF(_timezone,''), 'America/Sao_Paulo');
  base timestamp;      -- local time
  cand timestamp;
  dom int;
BEGIN
  base := (COALESCE(_from, now()) AT TIME ZONE tz);
  cand := date_trunc('day', base) + make_interval(hours => COALESCE(_hour,0), mins => COALESCE(_minute,0));

  IF _frequency = 'daily' THEN
    IF cand <= base THEN cand := cand + interval '1 day'; END IF;

  ELSIF _frequency = 'weekly' THEN
    cand := cand + make_interval(days => ((COALESCE(_weekday,1) - EXTRACT(DOW FROM cand)::int) + 7) % 7);
    IF cand <= base THEN cand := cand + interval '7 days'; END IF;

  ELSIF _frequency = 'monthly' THEN
    dom := LEAST(GREATEST(COALESCE(_day_of_month,1),1),28);
    cand := date_trunc('month', base) + make_interval(days => dom - 1, hours => COALESCE(_hour,0), mins => COALESCE(_minute,0));
    IF cand <= base THEN
      cand := date_trunc('month', base) + interval '1 month'
              + make_interval(days => dom - 1, hours => COALESCE(_hour,0), mins => COALESCE(_minute,0));
    END IF;

  ELSE -- interval
    cand := cand + make_interval(days => GREATEST(COALESCE(_interval_days,1),1));
    IF cand <= base THEN cand := base + make_interval(days => GREATEST(COALESCE(_interval_days,1),1)); END IF;
  END IF;

  RETURN cand AT TIME ZONE tz;
END; $$;

-- Claim due schedules atomically (advances next_run_at before running)
CREATE OR REPLACE FUNCTION public.claim_due_automation_schedules(_limit integer DEFAULT 3)
RETURNS TABLE(id uuid, company_id uuid, slug text, options jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT s.id FROM public.automation_schedules s
    WHERE s.enabled AND s.next_run_at IS NOT NULL AND s.next_run_at <= now()
    ORDER BY s.next_run_at
    LIMIT GREATEST(COALESCE(_limit,3),1)
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.automation_schedules s
       SET last_run_at = now(),
           last_status = 'running',
           next_run_at = public.automation_next_run(
             s.frequency, s.hour, s.minute, s.weekday, s.day_of_month,
             s.interval_days, s.timezone, now())
      FROM due WHERE s.id = due.id
    RETURNING s.id, s.company_id, s.slug, s.options
  )
  SELECT u.id, u.company_id, u.slug, u.options FROM upd u;
END; $$;

REVOKE ALL ON FUNCTION public.claim_due_automation_schedules(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_automation_schedules(integer) TO service_role;

-- =========================
-- 2) WORKER CONCURRENCY
-- =========================
CREATE TABLE IF NOT EXISTS public.worker_leases (
  key text PRIMARY KEY,
  pool text NOT NULL,
  holder text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
GRANT ALL ON public.worker_leases TO service_role;
ALTER TABLE public.worker_leases ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS worker_leases_pool_idx ON public.worker_leases (pool, expires_at);

CREATE OR REPLACE FUNCTION public.acquire_worker_lease(
  _pool text, _key text, _holder text, _ttl_seconds integer DEFAULT 120, _max_concurrent integer DEFAULT 3
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE active int;
BEGIN
  PERFORM set_config('lock_timeout','3s', true);
  DELETE FROM public.worker_leases WHERE expires_at < now();

  IF EXISTS (SELECT 1 FROM public.worker_leases l WHERE l.key = _key AND l.expires_at > now()) THEN
    RETURN false;
  END IF;

  SELECT count(*) INTO active FROM public.worker_leases l WHERE l.pool = _pool AND l.expires_at > now();
  IF active >= GREATEST(COALESCE(_max_concurrent,1),1) THEN
    RETURN false;
  END IF;

  INSERT INTO public.worker_leases(key, pool, holder, expires_at)
  VALUES (_key, _pool, _holder, now() + make_interval(secs => GREATEST(COALESCE(_ttl_seconds,120),5)))
  ON CONFLICT (key) DO NOTHING;

  RETURN EXISTS (SELECT 1 FROM public.worker_leases l WHERE l.key = _key AND l.holder = _holder);
END; $$;

CREATE OR REPLACE FUNCTION public.release_worker_lease(_key text, _holder text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.worker_leases WHERE key = _key AND holder = _holder;
$$;

REVOKE ALL ON FUNCTION public.acquire_worker_lease(text,text,text,integer,integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_worker_lease(text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_worker_lease(text,text,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_worker_lease(text,text) TO service_role;

-- Unstick abandoned work
CREATE OR REPLACE FUNCTION public.reclaim_stuck_workers(_minutes integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _push int := 0; _stores int := 0;
BEGIN
  PERFORM set_config('lock_timeout','3s', true);
  WITH r AS (
    UPDATE public.bling_push_queue q
       SET status = 'pendente', claimed_at = NULL,
           proxima_tentativa_em = now()
     WHERE q.status = 'processando'
       AND q.claimed_at IS NOT NULL
       AND q.claimed_at < now() - make_interval(mins => GREATEST(COALESCE(_minutes,10),1))
    RETURNING 1
  ) SELECT count(*) INTO _push FROM r;

  WITH s AS (
    UPDATE public.bling_store_sync_jobs j
       SET status = 'pendente', claimed_at = NULL
     WHERE j.status = 'processando'
       AND j.claimed_at IS NOT NULL
       AND j.claimed_at < now() - make_interval(mins => GREATEST(COALESCE(_minutes,10),1))
    RETURNING 1
  ) SELECT count(*) INTO _stores FROM s;

  DELETE FROM public.worker_leases WHERE expires_at < now();
  RETURN jsonb_build_object('push_reset', _push, 'stores_reset', _stores);
END; $$;

REVOKE ALL ON FUNCTION public.reclaim_stuck_workers(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_stuck_workers(integer) TO service_role;

-- Fail fast on lock contention instead of hitting statement timeouts
CREATE OR REPLACE FUNCTION public.claim_next_push_batch(_integration_id uuid DEFAULT NULL::uuid, _limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, integration_id uuid, company_id uuid, product_id uuid, bling_product_id text, bling_deposit_id text, tipo text, valor_novo numeric, tentativas integer, bling_product_store_id text, payload jsonb)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _target uuid;
BEGIN
  PERFORM set_config('lock_timeout','3s', true);
  PERFORM set_config('statement_timeout','20s', true);

  IF _integration_id IS NOT NULL THEN
    _target := _integration_id;
  ELSE
    SELECT q.integration_id INTO _target
    FROM public.bling_push_queue q
    WHERE q.status = 'pendente' AND q.proxima_tentativa_em <= now()
    ORDER BY q.created_at
    LIMIT 1;
  END IF;
  IF _target IS NULL THEN RETURN; END IF;

  IF NOT pg_try_advisory_xact_lock(hashtextextended(_target::text, 42)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT q.id FROM public.bling_push_queue q
    WHERE q.integration_id = _target
      AND q.status = 'pendente'
      AND q.proxima_tentativa_em <= now()
    ORDER BY q.created_at
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.bling_push_queue q
       SET status = 'processando', claimed_at = now(), tentativas = q.tentativas + 1
      FROM picked WHERE q.id = picked.id
    RETURNING q.*
  )
  SELECT u.id, u.integration_id, u.company_id, u.product_id,
         u.bling_product_id, u.bling_deposit_id, u.tipo,
         u.valor_novo, u.tentativas, u.bling_product_store_id, u.payload
  FROM upd u;
END; $function$;
