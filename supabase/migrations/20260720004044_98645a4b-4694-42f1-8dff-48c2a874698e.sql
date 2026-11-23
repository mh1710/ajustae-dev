
-- 1) Extend bling_store_sync_jobs with cancel + estimate
ALTER TABLE public.bling_store_sync_jobs
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_estimate integer;

-- 2) Extend bling_product_stores with intermediador
ALTER TABLE public.bling_product_stores
  ADD COLUMN IF NOT EXISTS intermediador_cnpj text,
  ADD COLUMN IF NOT EXISTS intermediador_nome text;

-- 3) bling_stores table (channels from /canais-venda)
CREATE TABLE IF NOT EXISTS public.bling_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  bling_store_id text NOT NULL,
  descricao text,
  tipo text,
  agrupador integer,
  situacao integer,
  cnpj_filial text,
  unidade_negocio text,
  intermediador_cnpj text,
  intermediador_nome text,
  raw_json jsonb,
  last_imported_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, bling_store_id)
);

GRANT SELECT ON public.bling_stores TO authenticated;
GRANT ALL ON public.bling_stores TO service_role;

ALTER TABLE public.bling_stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read bling_stores"
  ON public.bling_stores FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = bling_stores.company_id
      AND cu.user_id = auth.uid() AND cu.ativo = true
  ));

CREATE INDEX IF NOT EXISTS bling_stores_company_idx ON public.bling_stores(company_id);
CREATE INDEX IF NOT EXISTS bling_product_stores_store_id_idx ON public.bling_product_stores(company_id, bling_store_id);

DROP TRIGGER IF EXISTS trg_bling_stores_updated ON public.bling_stores;
CREATE TRIGGER trg_bling_stores_updated BEFORE UPDATE ON public.bling_stores
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 4) Request cancel
CREATE OR REPLACE FUNCTION public.request_cancel_bling_stores_sync(_company_id uuid, _job_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _n int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  WITH upd AS (
    UPDATE public.bling_store_sync_jobs
       SET cancel_requested = true,
           status = 'cancelando',
           last_error = COALESCE(last_error, 'Cancelamento solicitado pelo usuário.')
     WHERE company_id = _company_id
       AND (_job_id IS NULL OR id = _job_id)
       AND status IN ('pendente','processando','cancelando')
    RETURNING 1
  ) SELECT count(*) INTO _n FROM upd;
  RETURN jsonb_build_object('cancelled', _n);
END; $$;

-- 5) Update claim to respect cancel and to be a no-op on cancelled jobs
CREATE OR REPLACE FUNCTION public.claim_bling_stores_job(_job_id uuid)
RETURNS TABLE(id uuid, integration_id uuid, company_id uuid, scope text, bling_product_id text, proxima_pagina integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _integ uuid; _cancel boolean; _status text;
BEGIN
  SELECT j.integration_id, j.cancel_requested, j.status
    INTO _integ, _cancel, _status
    FROM public.bling_store_sync_jobs j WHERE j.id = _job_id;
  IF _integ IS NULL THEN RETURN; END IF;

  -- If cancellation was requested, immediately mark cancelled and return nothing.
  IF _cancel OR _status = 'cancelando' THEN
    UPDATE public.bling_store_sync_jobs
       SET status = 'cancelada', finished_at = COALESCE(finished_at, now()),
           last_error = COALESCE(last_error, 'Cancelado.')
     WHERE id = _job_id AND status IN ('pendente','processando','cancelando');
    RETURN;
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtextextended(_integ::text, 77)) THEN
    RETURN;
  END IF;
  UPDATE public.bling_store_sync_jobs j
     SET status = 'processando', claimed_at = now(),
         started_at = COALESCE(j.started_at, now())
   WHERE j.id = _job_id AND j.status IN ('pendente','processando');
  RETURN QUERY
    SELECT j.id, j.integration_id, j.company_id, j.scope, j.bling_product_id, j.proxima_pagina
      FROM public.bling_store_sync_jobs j WHERE j.id = _job_id;
END; $$;

-- 6) Upsert channel and backfill product_stores
CREATE OR REPLACE FUNCTION public.upsert_bling_channel(
  _company_id uuid,
  _integration_id uuid,
  _row jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _sid text := COALESCE(_row->>'bling_store_id','');
BEGIN
  IF _sid = '' THEN RETURN 'skipped'; END IF;
  INSERT INTO public.bling_stores AS s (
    company_id, integration_id, bling_store_id, descricao, tipo, agrupador, situacao,
    cnpj_filial, unidade_negocio, intermediador_cnpj, intermediador_nome,
    raw_json, last_imported_at
  ) VALUES (
    _company_id, _integration_id, _sid,
    NULLIF(_row->>'descricao',''), NULLIF(_row->>'tipo',''),
    NULLIF(_row->>'agrupador','')::int, NULLIF(_row->>'situacao','')::int,
    NULLIF(_row->>'cnpj_filial',''), NULLIF(_row->>'unidade_negocio',''),
    NULLIF(_row->>'intermediador_cnpj',''), NULLIF(_row->>'intermediador_nome',''),
    _row->'raw_json', now()
  )
  ON CONFLICT (integration_id, bling_store_id) DO UPDATE SET
    descricao = COALESCE(EXCLUDED.descricao, s.descricao),
    tipo = COALESCE(EXCLUDED.tipo, s.tipo),
    agrupador = COALESCE(EXCLUDED.agrupador, s.agrupador),
    situacao = COALESCE(EXCLUDED.situacao, s.situacao),
    cnpj_filial = COALESCE(EXCLUDED.cnpj_filial, s.cnpj_filial),
    unidade_negocio = COALESCE(EXCLUDED.unidade_negocio, s.unidade_negocio),
    intermediador_cnpj = COALESCE(EXCLUDED.intermediador_cnpj, s.intermediador_cnpj),
    intermediador_nome = COALESCE(EXCLUDED.intermediador_nome, s.intermediador_nome),
    raw_json = COALESCE(EXCLUDED.raw_json, s.raw_json),
    last_imported_at = now();

  -- Backfill existing product-store links
  UPDATE public.bling_product_stores ps SET
    store_name = COALESCE(NULLIF(_row->>'descricao',''), ps.store_name),
    store_type = COALESCE(NULLIF(_row->>'tipo',''), ps.store_type),
    intermediador_cnpj = COALESCE(NULLIF(_row->>'intermediador_cnpj',''), ps.intermediador_cnpj),
    intermediador_nome = COALESCE(NULLIF(_row->>'intermediador_nome',''), ps.intermediador_nome),
    updated_at = now()
  WHERE ps.integration_id = _integration_id AND ps.bling_store_id = _sid;

  RETURN 'ok';
END; $$;

-- 7) Backfill intermediador on a channel row (after external CNPJ lookup)
CREATE OR REPLACE FUNCTION public.set_bling_channel_intermediador(
  _integration_id uuid, _bling_store_id text, _cnpj text, _nome text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.bling_stores SET
    intermediador_cnpj = COALESCE(_cnpj, intermediador_cnpj),
    intermediador_nome = COALESCE(_nome, intermediador_nome),
    updated_at = now()
   WHERE integration_id = _integration_id AND bling_store_id = _bling_store_id;

  UPDATE public.bling_product_stores SET
    intermediador_cnpj = COALESCE(_cnpj, intermediador_cnpj),
    intermediador_nome = COALESCE(_nome, intermediador_nome),
    updated_at = now()
   WHERE integration_id = _integration_id AND bling_store_id = _bling_store_id;
END; $$;

-- 8) Progress with verified/total
CREATE OR REPLACE FUNCTION public.get_bling_stores_progress(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _res jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

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
    ) FROM public.bling_product_stores WHERE company_id = _company_id),
    'channels', (SELECT count(*) FROM public.bling_stores WHERE company_id = _company_id)
  ) INTO _res
  FROM (
    SELECT bj.*,
      CASE WHEN bj.total_estimate IS NOT NULL AND bj.total_estimate > 0
           THEN LEAST(100, ROUND(100.0 * bj.vinculos_encontrados / bj.total_estimate))
           ELSE NULL END AS percent
    FROM public.bling_store_sync_jobs bj
     WHERE bj.company_id = _company_id
     ORDER BY bj.created_at DESC LIMIT 1
  ) j;
  RETURN COALESCE(_res, '{}'::jsonb);
END; $$;

-- 9) Allow setting an estimated total on job start
CREATE OR REPLACE FUNCTION public.set_bling_stores_job_total(_job_id uuid, _total integer)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.bling_store_sync_jobs SET total_estimate = _total WHERE id = _job_id;
$$;

-- 10) Set default deposit helper (used after fetching /depositos)
CREATE OR REPLACE FUNCTION public.set_bling_default_deposito(
  _company_id uuid, _integration_id uuid, _deposito_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  UPDATE public.bling_integrations
     SET default_deposito_id = _deposito_id, updated_at = now()
   WHERE id = _integration_id AND company_id = _company_id;
END; $$;
