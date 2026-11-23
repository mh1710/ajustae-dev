CREATE INDEX IF NOT EXISTS worker_leases_pool_expires_idx ON public.worker_leases (pool, expires_at);
CREATE INDEX IF NOT EXISTS bling_push_queue_processando_claimed_idx ON public.bling_push_queue (claimed_at) WHERE status = 'processando';

CREATE OR REPLACE FUNCTION public.acquire_worker_lease(_pool text, _key text, _holder text, _ttl_seconds integer DEFAULT 120, _max_concurrent integer DEFAULT 3)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  active int;
  got boolean := false;
  ttl interval := make_interval(secs => GREATEST(COALESCE(_ttl_seconds,120),5));
BEGIN
  PERFORM set_config('lock_timeout','3s', true);

  -- serialize only within this pool so the global count check is exact,
  -- without a table-wide DELETE on every acquisition
  PERFORM pg_advisory_xact_lock(hashtext('worker_lease_pool:' || _pool));

  SELECT count(*) INTO active
    FROM public.worker_leases l
   WHERE l.pool = _pool AND l.expires_at > now() AND l.key <> _key;

  IF active >= GREATEST(COALESCE(_max_concurrent,1),1) THEN
    RETURN false;
  END IF;

  INSERT INTO public.worker_leases(key, pool, holder, expires_at)
  VALUES (_key, _pool, _holder, now() + ttl)
  ON CONFLICT (key) DO UPDATE
     SET holder = EXCLUDED.holder,
         pool = EXCLUDED.pool,
         expires_at = EXCLUDED.expires_at
   WHERE public.worker_leases.expires_at < now();

  SELECT EXISTS (
    SELECT 1 FROM public.worker_leases l WHERE l.key = _key AND l.holder = _holder
  ) INTO got;

  RETURN got;
END; $function$;

-- global throttle: run the reclaim sweep at most once per _every_seconds
CREATE OR REPLACE FUNCTION public.reclaim_stuck_workers_throttled(_minutes integer DEFAULT 10, _every_seconds integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE inserted boolean;
BEGIN
  PERFORM set_config('lock_timeout','2s', true);
  INSERT INTO public.worker_leases(key, pool, holder, expires_at)
  VALUES ('reclaim:sweep', 'maintenance', 'sweep',
          now() + make_interval(secs => GREATEST(COALESCE(_every_seconds,60),5)))
  ON CONFLICT (key) DO UPDATE
     SET expires_at = EXCLUDED.expires_at
   WHERE public.worker_leases.expires_at < now();
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF NOT inserted THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;
  RETURN public.reclaim_stuck_workers(_minutes);
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('skipped', true, 'error', SQLERRM);
END; $function$;

GRANT EXECUTE ON FUNCTION public.reclaim_stuck_workers_throttled(integer, integer) TO authenticated, service_role;