-- Rotação segura de URLs CDN: política global, versões, jobs retomáveis e itens por produto.
CREATE TABLE IF NOT EXISTS public.cdn_rotation_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual','event_driven','periodic')),
  interval_days integer NOT NULL DEFAULT 365 CHECK (interval_days BETWEEN 30 AND 730),
  grace_days integer NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 2 AND 90),
  start_hour integer NOT NULL DEFAULT 2 CHECK (start_hour BETWEEN 0 AND 23),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  max_bling_requests_per_second numeric(3,1) NOT NULL DEFAULT 2 CHECK (max_bling_requests_per_second > 0 AND max_bling_requests_per_second <= 2),
  max_products_per_day integer NOT NULL DEFAULT 1000 CHECK (max_products_per_day BETWEEN 1 AND 40000),
  require_revoke_approval boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.cdn_rotation_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.cdn_key_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  public_id text NOT NULL UNIQUE,
  format text NOT NULL CHECK (format IN ('v1','v2')),
  generation integer NOT NULL CHECK (generation > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','grace','revoking','revoked','failed')),
  master_key_id text,
  cloudflare_confirmed_at timestamptz,
  activated_at timestamptz,
  retire_after timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, generation),
  CHECK (
    (format = 'v1' AND public_id ~* '^cdn_[a-f0-9]{32}$') OR
    (format = 'v2' AND public_id ~ '^[A-Za-z0-9_-]{22}$')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS cdn_key_versions_one_active_idx
  ON public.cdn_key_versions(integration_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS cdn_key_versions_lifecycle_idx
  ON public.cdn_key_versions(integration_id, status, created_at DESC);

ALTER TABLE public.bling_integrations
  ADD COLUMN IF NOT EXISTS cdn_key_version_id uuid REFERENCES public.cdn_key_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.cdn_key_rotation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  trigger_type text NOT NULL DEFAULT 'manual'
    CHECK (trigger_type IN ('manual','event','periodic','dry_run')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN (
      'planned','activating','stabilizing','preparing','pushing','verifying',
      'grace','awaiting_revoke','revoking','completed','paused','failed',
      'cancelled','rolling_back','rolled_back'
    )),
  resume_status text,
  settings_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_product_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  product_limit integer CHECK (product_limit IS NULL OR product_limit BETWEEN 1 AND 40000),
  old_key_version_id uuid REFERENCES public.cdn_key_versions(id) ON DELETE SET NULL,
  new_key_version_id uuid REFERENCES public.cdn_key_versions(id) ON DELETE SET NULL,
  total_products integer NOT NULL DEFAULT 0,
  processed_products integer NOT NULL DEFAULT 0,
  confirmed_products integer NOT NULL DEFAULT 0,
  conflict_products integer NOT NULL DEFAULT 0,
  error_products integer NOT NULL DEFAULT 0,
  skipped_products integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamptz,
  prepare_cursor uuid,
  next_tick_at timestamptz NOT NULL DEFAULT now(),
  stabilize_until timestamptz,
  grace_until timestamptz,
  revoke_approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoke_approved_at timestamptz,
  consumer_scope text NOT NULL DEFAULT 'bling_only'
    CHECK (consumer_scope IN ('bling_only','bling_and_channels')),
  external_consumers_confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  external_consumers_confirmed_at timestamptz,
  purge_request_id text,
  purge_prefix text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cdn_rotation_one_active_job_idx
  ON public.cdn_key_rotation_jobs(integration_id)
  WHERE status IN ('planned','activating','stabilizing','preparing','pushing','verifying','grace','awaiting_revoke','revoking','paused','rolling_back');
CREATE INDEX IF NOT EXISTS cdn_rotation_jobs_due_idx
  ON public.cdn_key_rotation_jobs(status, next_tick_at, created_at);

CREATE TABLE IF NOT EXISTS public.cdn_key_rotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.cdn_key_rotation_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.bling_products(id) ON DELETE CASCADE,
  bling_product_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','cdn_validated','processing','bling_sent','bling_verified','db_committed','skipped','conflict','error','rolled_back')),
  old_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  new_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  object_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  product_updated_at_snapshot timestamptz,
  bling_before jsonb,
  bling_after jsonb,
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_http_status integer,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, product_id)
);

CREATE INDEX IF NOT EXISTS cdn_rotation_items_queue_idx
  ON public.cdn_key_rotation_items(job_id, status, next_retry_at, id);

CREATE TABLE IF NOT EXISTS public.cdn_key_rotation_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid REFERENCES public.cdn_key_rotation_jobs(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cdn_rotation_bling_rate_slots (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  next_allowed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.take_cdn_rotation_bling_slot(
  _company_id uuid,
  _interval_ms integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  slot_at timestamptz;
  wait_ms integer;
BEGIN
  IF _interval_ms < 500 OR _interval_ms > 10000 THEN
    RAISE EXCEPTION 'Intervalo de rotação Bling inválido';
  END IF;

  INSERT INTO public.cdn_rotation_bling_rate_slots (company_id)
  VALUES (_company_id)
  ON CONFLICT (company_id) DO NOTHING;

  SELECT greatest(next_allowed_at, clock_timestamp())
  INTO slot_at
  FROM public.cdn_rotation_bling_rate_slots
  WHERE company_id = _company_id
  FOR UPDATE;

  wait_ms := greatest(0, ceil(extract(epoch FROM (slot_at - clock_timestamp())) * 1000)::integer);

  UPDATE public.cdn_rotation_bling_rate_slots
  SET next_allowed_at = slot_at + make_interval(secs => _interval_ms::double precision / 1000),
      updated_at = clock_timestamp()
  WHERE company_id = _company_id;

  RETURN wait_ms;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_cdn_rotation_items(_job_id uuid, _limit integer DEFAULT 10)
RETURNS SETOF public.cdn_key_rotation_items
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH picked AS (
    SELECT id
    FROM public.cdn_key_rotation_items
    WHERE job_id = _job_id
      AND status = 'cdn_validated'
      AND next_retry_at <= now()
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(_limit, 25))
  )
  UPDATE public.cdn_key_rotation_items item
  SET status = 'processing',
      attempts = attempts + 1,
      started_at = coalesce(started_at, now()),
      updated_at = now()
  FROM picked
  WHERE item.id = picked.id
  RETURNING item.*;
$$;

CREATE OR REPLACE FUNCTION public.refresh_cdn_rotation_job(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE summary jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total', count(*),
    'processed', count(*) FILTER (WHERE status IN ('db_committed','skipped','conflict','error','rolled_back')),
    'confirmed', count(*) FILTER (WHERE status = 'db_committed'),
    'conflicts', count(*) FILTER (WHERE status = 'conflict'),
    'errors', count(*) FILTER (WHERE status = 'error'),
    'skipped', count(*) FILTER (WHERE status = 'skipped'),
    'outstanding', count(*) FILTER (WHERE status IN ('pending','cdn_validated','processing','bling_sent','bling_verified'))
  ) INTO summary
  FROM public.cdn_key_rotation_items
  WHERE job_id = _job_id;

  UPDATE public.cdn_key_rotation_jobs
  SET total_products = (summary->>'total')::integer,
      processed_products = (summary->>'processed')::integer,
      confirmed_products = (summary->>'confirmed')::integer,
      conflict_products = (summary->>'conflicts')::integer,
      error_products = (summary->>'errors')::integer,
      skipped_products = (summary->>'skipped')::integer,
      updated_at = now()
  WHERE id = _job_id;
  RETURN summary;
END;
$$;

ALTER TABLE public.cdn_rotation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cdn_key_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cdn_key_rotation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cdn_key_rotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cdn_key_rotation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cdn_rotation_bling_rate_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY cdn_rotation_settings_admin_read ON public.cdn_rotation_settings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY cdn_key_versions_admin_read ON public.cdn_key_versions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY cdn_rotation_jobs_admin_read ON public.cdn_key_rotation_jobs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY cdn_rotation_items_admin_read ON public.cdn_key_rotation_items
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY cdn_rotation_audit_admin_read ON public.cdn_key_rotation_audit
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.cdn_rotation_settings, public.cdn_key_versions,
  public.cdn_key_rotation_jobs, public.cdn_key_rotation_items,
  public.cdn_key_rotation_audit TO authenticated;
GRANT ALL ON public.cdn_rotation_settings, public.cdn_key_versions,
  public.cdn_key_rotation_jobs, public.cdn_key_rotation_items,
  public.cdn_key_rotation_audit, public.cdn_rotation_bling_rate_slots TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cdn_key_rotation_audit_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.claim_cdn_rotation_items(uuid, integer) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.refresh_cdn_rotation_job(uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.take_cdn_rotation_bling_slot(uuid, integer) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cdn_rotation_items(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_cdn_rotation_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.take_cdn_rotation_bling_slot(uuid, integer) TO service_role;
