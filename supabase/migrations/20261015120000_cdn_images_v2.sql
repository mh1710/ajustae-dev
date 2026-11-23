-- Módulo de imagens v2: inventário R2, jobs retomáveis e relatório por produto.
CREATE TABLE IF NOT EXISTS public.cdn_image_assets (
  r2_key text PRIMARY KEY,
  file_name text NOT NULL,
  normalized_name text NOT NULL,
  base_key text NOT NULL,
  variant_index integer NOT NULL DEFAULT 0,
  extension text NOT NULL,
  size_bytes bigint,
  etag text,
  uploaded_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  last_seen_sync uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cdn_image_assets_base_idx
  ON public.cdn_image_assets(base_key, variant_index) WHERE active;
CREATE INDEX IF NOT EXISTS cdn_image_assets_sync_idx
  ON public.cdn_image_assets(last_seen_sync);

CREATE TABLE IF NOT EXISTS public.cdn_image_jobs_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  company_ids uuid[] NOT NULL,
  selected_product_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  status text NOT NULL DEFAULT 'inventario'
    CHECK (status IN ('inventario','preparando','processando','concluido','erro','cancelado')),
  total_products integer NOT NULL DEFAULT 0,
  processed_products integer NOT NULL DEFAULT 0,
  updated_products integer NOT NULL DEFAULT 0,
  matched_products integer NOT NULL DEFAULT 0,
  no_image_products integer NOT NULL DEFAULT 0,
  already_cdn_products integer NOT NULL DEFAULT 0,
  no_integration_products integer NOT NULL DEFAULT 0,
  error_products integer NOT NULL DEFAULT 0,
  inventory_sync_id uuid NOT NULL DEFAULT gen_random_uuid(),
  inventory_cursor text,
  inventory_scanned integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamptz,
  next_tick_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(company_ids) > 0)
);

CREATE INDEX IF NOT EXISTS cdn_image_jobs_v2_due_idx
  ON public.cdn_image_jobs_v2(status, next_tick_at, started_at);

CREATE TABLE IF NOT EXISTS public.cdn_image_job_items_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.cdn_image_jobs_v2(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.bling_products(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.bling_integrations(id) ON DELETE SET NULL,
  codigo text,
  cod_fornecedor text,
  fornecedor text,
  descricao_fornecedor text,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','processando','atualizado','sem_imagem','ja_cdn','sem_integracao','erro','cancelado')),
  candidate_bases jsonb NOT NULL DEFAULT '[]'::jsonb,
  image_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  image_urls text,
  reason text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, product_id)
);

CREATE INDEX IF NOT EXISTS cdn_image_job_items_v2_queue_idx
  ON public.cdn_image_job_items_v2(job_id, status, id);
CREATE INDEX IF NOT EXISTS cdn_image_job_items_v2_report_idx
  ON public.cdn_image_job_items_v2(job_id, status, codigo);

CREATE OR REPLACE FUNCTION public.prepare_cdn_image_job_v2(_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _companies uuid[]; _selected uuid[]; _count integer;
BEGIN
  SELECT company_ids, selected_product_ids INTO _companies, _selected FROM public.cdn_image_jobs_v2 WHERE id = _job_id FOR UPDATE;
  IF _companies IS NULL THEN RAISE EXCEPTION 'Job não encontrado'; END IF;

  INSERT INTO public.cdn_image_job_items_v2 (
    job_id, company_id, product_id, integration_id, codigo, cod_fornecedor, fornecedor, descricao_fornecedor
  )
  SELECT _job_id, p.company_id, p.id, p.integration_id, p.codigo, p.cod_fornecedor, p.fornecedor, p.descricao_fornecedor
  FROM public.bling_products p
  WHERE p.company_id = ANY(_companies)
    AND (cardinality(_selected) = 0 OR p.id = ANY(_selected))
  ON CONFLICT (job_id, product_id) DO NOTHING;

  SELECT count(*) INTO _count FROM public.cdn_image_job_items_v2 WHERE job_id = _job_id;
  UPDATE public.cdn_image_jobs_v2
  SET status = CASE WHEN _count = 0 THEN 'concluido' ELSE 'processando' END,
      total_products = _count,
      finished_at = CASE WHEN _count = 0 THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = _job_id;
  RETURN _count;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_cdn_image_items_v2(_job_id uuid, _limit integer)
RETURNS SETOF public.cdn_image_job_items_v2
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH picked AS (
    SELECT id FROM public.cdn_image_job_items_v2
    WHERE job_id = _job_id AND status = 'pendente'
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(_limit, 250))
  )
  UPDATE public.cdn_image_job_items_v2 i
  SET status = 'processando', attempts = attempts + 1, started_at = coalesce(started_at, now()), updated_at = now()
  FROM picked WHERE i.id = picked.id
  RETURNING i.*;
$$;

CREATE OR REPLACE FUNCTION public.refresh_cdn_image_job_v2(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r jsonb; pending_count integer;
BEGIN
  SELECT jsonb_build_object(
    'total', count(*),
    'processed', count(*) FILTER (WHERE status NOT IN ('pendente','processando')),
    'updated', count(*) FILTER (WHERE status = 'atualizado'),
    'matched', count(*) FILTER (WHERE status IN ('atualizado','ja_cdn')),
    'no_image', count(*) FILTER (WHERE status = 'sem_imagem'),
    'already_cdn', count(*) FILTER (WHERE status = 'ja_cdn'),
    'no_integration', count(*) FILTER (WHERE status = 'sem_integracao'),
    'errors', count(*) FILTER (WHERE status = 'erro')
  ), count(*) FILTER (WHERE status IN ('pendente','processando'))
  INTO r, pending_count
  FROM public.cdn_image_job_items_v2 WHERE job_id = _job_id;

  UPDATE public.cdn_image_jobs_v2 SET
    total_products = (r->>'total')::integer,
    processed_products = (r->>'processed')::integer,
    updated_products = (r->>'updated')::integer,
    matched_products = (r->>'matched')::integer,
    no_image_products = (r->>'no_image')::integer,
    already_cdn_products = (r->>'already_cdn')::integer,
    no_integration_products = (r->>'no_integration')::integer,
    error_products = (r->>'errors')::integer,
    status = CASE WHEN pending_count = 0 AND status NOT IN ('cancelado','erro') THEN 'concluido' ELSE status END,
    finished_at = CASE WHEN pending_count = 0 THEN coalesce(finished_at, now()) ELSE finished_at END,
    updated_at = now()
  WHERE id = _job_id;
  RETURN r || jsonb_build_object('done', pending_count = 0);
END;
$$;

ALTER TABLE public.cdn_image_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cdn_image_jobs_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cdn_image_job_items_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cdn_image_assets_read ON public.cdn_image_assets;
DROP POLICY IF EXISTS cdn_image_jobs_v2_read ON public.cdn_image_jobs_v2;
DROP POLICY IF EXISTS cdn_image_items_v2_read ON public.cdn_image_job_items_v2;
CREATE POLICY cdn_image_assets_read ON public.cdn_image_assets FOR SELECT TO authenticated USING (true);
CREATE POLICY cdn_image_jobs_v2_read ON public.cdn_image_jobs_v2 FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.user_id = auth.uid() AND cu.ativo AND cu.company_id = ANY(cdn_image_jobs_v2.company_ids))
);
CREATE POLICY cdn_image_items_v2_read ON public.cdn_image_job_items_v2 FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.user_id = auth.uid() AND cu.ativo AND cu.company_id = cdn_image_job_items_v2.company_id)
);

GRANT SELECT ON public.cdn_image_assets, public.cdn_image_jobs_v2, public.cdn_image_job_items_v2 TO authenticated;

REVOKE ALL ON FUNCTION public.prepare_cdn_image_job_v2(uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.claim_cdn_image_items_v2(uuid, integer) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.refresh_cdn_image_job_v2(uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_cdn_image_job_v2(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_cdn_image_items_v2(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_cdn_image_job_v2(uuid) TO service_role;
