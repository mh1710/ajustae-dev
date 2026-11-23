
-- ================= bling_product_stores =================
CREATE TABLE IF NOT EXISTS public.bling_product_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  internal_product_id uuid REFERENCES public.bling_products(id) ON DELETE SET NULL,
  bling_product_id text NOT NULL,
  bling_store_id text NOT NULL,
  bling_product_store_id text NOT NULL,
  store_name text,
  store_type text,
  store_product_code text,
  current_price numeric,
  current_promotional_price numeric,
  supplier_store_id text,
  brand_store_id text,
  categories_json jsonb,
  raw_data_json jsonb,
  is_linked boolean NOT NULL DEFAULT true,
  last_bling_update_at timestamptz,
  last_imported_at timestamptz NOT NULL DEFAULT now(),
  last_seen_run_id uuid,
  sync_status text NOT NULL DEFAULT 'ok',
  sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bling_product_stores TO authenticated;
GRANT ALL ON public.bling_product_stores TO service_role;
ALTER TABLE public.bling_product_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member reads own stores" ON public.bling_product_stores;
CREATE POLICY "member reads own stores" ON public.bling_product_stores
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = bling_product_stores.company_id
        AND cu.user_id = auth.uid() AND cu.ativo = true)
  );

CREATE UNIQUE INDEX IF NOT EXISTS bling_product_stores_link_uk
  ON public.bling_product_stores(integration_id, bling_product_store_id);
CREATE UNIQUE INDEX IF NOT EXISTS bling_product_stores_prod_store_uk
  ON public.bling_product_stores(integration_id, bling_product_id, bling_store_id);
CREATE INDEX IF NOT EXISTS bling_product_stores_company_idx
  ON public.bling_product_stores(company_id);
CREATE INDEX IF NOT EXISTS bling_product_stores_internal_idx
  ON public.bling_product_stores(internal_product_id) WHERE internal_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bling_product_stores_store_idx
  ON public.bling_product_stores(company_id, bling_store_id);

DROP TRIGGER IF EXISTS tg_bling_product_stores_upd ON public.bling_product_stores;
CREATE TRIGGER tg_bling_product_stores_upd BEFORE UPDATE ON public.bling_product_stores
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ================= bling_store_sync_jobs =================
CREATE TABLE IF NOT EXISTS public.bling_store_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'full', -- full | product
  bling_product_id text,
  status text NOT NULL DEFAULT 'pendente', -- pendente | processando | concluida | erro | cancelada
  proxima_pagina int NOT NULL DEFAULT 1,
  paginas_processadas int NOT NULL DEFAULT 0,
  total_paginas int,
  vinculos_encontrados int NOT NULL DEFAULT 0,
  vinculos_salvos int NOT NULL DEFAULT 0,
  vinculos_atualizados int NOT NULL DEFAULT 0,
  produtos_relacionados int NOT NULL DEFAULT 0,
  produtos_nao_encontrados int NOT NULL DEFAULT 0,
  erros int NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bling_store_sync_jobs TO authenticated;
GRANT ALL ON public.bling_store_sync_jobs TO service_role;
ALTER TABLE public.bling_store_sync_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member reads store jobs" ON public.bling_store_sync_jobs;
CREATE POLICY "member reads store jobs" ON public.bling_store_sync_jobs
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = bling_store_sync_jobs.company_id
        AND cu.user_id = auth.uid() AND cu.ativo = true)
  );
DROP POLICY IF EXISTS "member inserts store jobs" ON public.bling_store_sync_jobs;
CREATE POLICY "member inserts store jobs" ON public.bling_store_sync_jobs
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = bling_store_sync_jobs.company_id
        AND cu.user_id = auth.uid() AND cu.ativo = true)
  );

CREATE INDEX IF NOT EXISTS bling_store_sync_jobs_integ_idx
  ON public.bling_store_sync_jobs(integration_id, status);

DROP TRIGGER IF EXISTS tg_bling_store_sync_jobs_upd ON public.bling_store_sync_jobs;
CREATE TRIGGER tg_bling_store_sync_jobs_upd BEFORE UPDATE ON public.bling_store_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Only one active job per integration
CREATE UNIQUE INDEX IF NOT EXISTS bling_store_sync_jobs_active_uk
  ON public.bling_store_sync_jobs(integration_id)
  WHERE status IN ('pendente','processando');

-- ================= RPCs =================
CREATE OR REPLACE FUNCTION public.start_bling_stores_sync(
  _company_id uuid,
  _scope text DEFAULT 'full',
  _bling_product_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _integ_id uuid;
  _job_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN RAISE EXCEPTION 'not a member of company'; END IF;

  SELECT id INTO _integ_id FROM public.bling_integrations
   WHERE company_id = _company_id AND status = 'conectada' LIMIT 1;
  IF _integ_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada.';
  END IF;

  -- If a job is already active for this integration, return it
  SELECT id INTO _job_id FROM public.bling_store_sync_jobs
   WHERE integration_id = _integ_id AND status IN ('pendente','processando')
   LIMIT 1;
  IF _job_id IS NOT NULL THEN
    RETURN jsonb_build_object('job_id', _job_id, 'already_running', true);
  END IF;

  INSERT INTO public.bling_store_sync_jobs(company_id, integration_id, scope, bling_product_id, status, started_at)
  VALUES (_company_id, _integ_id, COALESCE(_scope,'full'), _bling_product_id, 'pendente', now())
  RETURNING id INTO _job_id;

  RETURN jsonb_build_object('job_id', _job_id, 'integration_id', _integ_id, 'already_running', false);
END; $$;

CREATE OR REPLACE FUNCTION public.claim_bling_stores_job(_job_id uuid)
RETURNS TABLE(id uuid, integration_id uuid, company_id uuid, scope text, bling_product_id text, proxima_pagina int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _integ uuid;
BEGIN
  SELECT j.integration_id INTO _integ FROM public.bling_store_sync_jobs j WHERE j.id = _job_id;
  IF _integ IS NULL THEN RETURN; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(_integ::text, 77)) THEN
    RETURN;
  END IF;
  UPDATE public.bling_store_sync_jobs
     SET status = 'processando', claimed_at = now(),
         started_at = COALESCE(started_at, now())
   WHERE id = _job_id AND status IN ('pendente','processando');
  RETURN QUERY
    SELECT j.id, j.integration_id, j.company_id, j.scope, j.bling_product_id, j.proxima_pagina
      FROM public.bling_store_sync_jobs j WHERE j.id = _job_id;
END; $$;

CREATE OR REPLACE FUNCTION public.upsert_bling_product_store(
  _company_id uuid,
  _integration_id uuid,
  _run_id uuid,
  _row jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _bling_product_id text := COALESCE(_row->>'bling_product_id','');
  _bling_store_id text := COALESCE(_row->>'bling_store_id','');
  _link_id text := COALESCE(_row->>'bling_product_store_id','');
  _internal uuid;
  _existed boolean;
  _result text;
BEGIN
  IF _bling_product_id = '' OR _bling_store_id = '' OR _link_id = '' THEN
    RETURN 'skipped';
  END IF;

  SELECT id INTO _internal FROM public.bling_products
   WHERE company_id = _company_id AND bling_product_id = _bling_product_id
   LIMIT 1;

  SELECT EXISTS(
    SELECT 1 FROM public.bling_product_stores
     WHERE integration_id = _integration_id AND bling_product_store_id = _link_id
  ) INTO _existed;

  INSERT INTO public.bling_product_stores AS b (
    company_id, integration_id, internal_product_id,
    bling_product_id, bling_store_id, bling_product_store_id,
    store_name, store_type, store_product_code,
    current_price, current_promotional_price,
    supplier_store_id, brand_store_id,
    categories_json, raw_data_json,
    is_linked, last_bling_update_at, last_imported_at, last_seen_run_id,
    sync_status, sync_error
  ) VALUES (
    _company_id, _integration_id, _internal,
    _bling_product_id, _bling_store_id, _link_id,
    NULLIF(_row->>'store_name',''), NULLIF(_row->>'store_type',''), NULLIF(_row->>'store_product_code',''),
    NULLIF(_row->>'current_price','')::numeric, NULLIF(_row->>'current_promotional_price','')::numeric,
    NULLIF(_row->>'supplier_store_id',''), NULLIF(_row->>'brand_store_id',''),
    _row->'categories_json', _row->'raw_data_json',
    true,
    NULLIF(_row->>'last_bling_update_at','')::timestamptz,
    now(), _run_id,
    CASE WHEN _internal IS NULL THEN 'produto_nao_encontrado' ELSE 'ok' END,
    NULL
  )
  ON CONFLICT (integration_id, bling_product_store_id) DO UPDATE SET
    company_id = EXCLUDED.company_id,
    internal_product_id = EXCLUDED.internal_product_id,
    bling_product_id = EXCLUDED.bling_product_id,
    bling_store_id = EXCLUDED.bling_store_id,
    store_name = COALESCE(EXCLUDED.store_name, b.store_name),
    store_type = COALESCE(EXCLUDED.store_type, b.store_type),
    store_product_code = EXCLUDED.store_product_code,
    current_price = EXCLUDED.current_price,
    current_promotional_price = EXCLUDED.current_promotional_price,
    supplier_store_id = EXCLUDED.supplier_store_id,
    brand_store_id = EXCLUDED.brand_store_id,
    categories_json = EXCLUDED.categories_json,
    raw_data_json = EXCLUDED.raw_data_json,
    is_linked = true,
    last_bling_update_at = EXCLUDED.last_bling_update_at,
    last_imported_at = now(),
    last_seen_run_id = _run_id,
    sync_status = EXCLUDED.sync_status,
    sync_error = NULL;

  IF _existed THEN _result := 'updated'; ELSE _result := 'inserted'; END IF;
  RETURN _result;
END; $$;

CREATE OR REPLACE FUNCTION public.finish_bling_stores_page(
  _job_id uuid,
  _page int,
  _total_pages int,
  _found int,
  _inserted int,
  _updated int,
  _matched int,
  _unmatched int,
  _errors int,
  _next_page int,
  _last_error text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
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
END; $$;

CREATE OR REPLACE FUNCTION public.finish_bling_stores_job(
  _job_id uuid, _status text, _last_error text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _job public.bling_store_sync_jobs%ROWTYPE;
BEGIN
  SELECT * INTO _job FROM public.bling_store_sync_jobs WHERE id = _job_id;
  IF _job.id IS NULL THEN RETURN; END IF;

  UPDATE public.bling_store_sync_jobs
     SET status = _status, finished_at = now(),
         last_error = COALESCE(_last_error, last_error)
   WHERE id = _job_id;

  -- On successful full sync, mark links not seen as inactive.
  IF _status = 'concluida' AND _job.scope = 'full' THEN
    UPDATE public.bling_product_stores
       SET is_linked = false, updated_at = now()
     WHERE integration_id = _job.integration_id
       AND (last_seen_run_id IS NULL OR last_seen_run_id <> _job_id)
       AND is_linked = true;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.get_bling_stores_progress(_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _res jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN RAISE EXCEPTION 'not a member of company'; END IF;

  SELECT jsonb_build_object(
    'job', row_to_json(j),
    'totals', (SELECT jsonb_build_object(
      'total_links', count(*),
      'active_links', count(*) FILTER (WHERE is_linked),
      'inactive_links', count(*) FILTER (WHERE NOT is_linked),
      'unmatched', count(*) FILTER (WHERE internal_product_id IS NULL AND is_linked),
      'distinct_stores', count(DISTINCT bling_store_id) FILTER (WHERE is_linked),
      'products_with_stores', count(DISTINCT internal_product_id) FILTER (WHERE is_linked AND internal_product_id IS NOT NULL),
      'last_imported', max(last_imported_at)
    ) FROM public.bling_product_stores WHERE company_id = _company_id)
  ) INTO _res
  FROM (
    SELECT * FROM public.bling_store_sync_jobs
     WHERE company_id = _company_id
     ORDER BY created_at DESC LIMIT 1
  ) j;
  RETURN COALESCE(_res, '{}'::jsonb);
END; $$;
