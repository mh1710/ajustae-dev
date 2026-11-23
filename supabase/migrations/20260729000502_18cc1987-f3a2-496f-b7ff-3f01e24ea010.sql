-- 1) Raise statement timeout for the heavy enqueue functions
ALTER FUNCTION public.enqueue_bling_push(uuid, uuid[], text, boolean) SET statement_timeout = '300s';
ALTER FUNCTION public.enqueue_bling_push(uuid, uuid[], text) SET statement_timeout = '300s';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enqueue_bling_link_store' AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'ALTER FUNCTION public.enqueue_bling_link_store(uuid, uuid[], text, text) SET statement_timeout = ''300s''';
  END IF;
END $$;

-- 2) Fix duplicate-key error on bling_product_stores_prod_store_uk:
--    dedupe rows within the incoming batch, then remove any pre-existing
--    row that shares (integration_id, bling_product_id, bling_store_id)
--    but has a different bling_product_store_id, before the upsert.
CREATE OR REPLACE FUNCTION public.upsert_bling_product_stores_batch(_company_id uuid, _integration_id uuid, _run_id uuid, _rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _res jsonb;
BEGIN
  CREATE TEMP TABLE _in ON COMMIT DROP AS
  SELECT
    NULLIF(btrim(r.bling_product_id), '') AS bling_product_id,
    NULLIF(btrim(r.bling_store_id), '') AS bling_store_id,
    NULLIF(btrim(r.bling_product_store_id), '') AS bling_product_store_id,
    NULLIF(r.store_name, '') AS store_name,
    NULLIF(r.store_type, '') AS store_type,
    NULLIF(r.store_product_code, '') AS store_product_code,
    r.current_price,
    r.current_promotional_price,
    NULLIF(r.supplier_store_id, '') AS supplier_store_id,
    NULLIF(r.brand_store_id, '') AS brand_store_id,
    r.categories_json,
    r.raw_data_json,
    CASE
      WHEN NULLIF(r.last_bling_update_at, '') IS NULL THEN NULL::timestamptz
      WHEN r.last_bling_update_at ~ '^\d{4}-\d{2}-\d{2}' THEN r.last_bling_update_at::timestamptz
      ELSE NULL::timestamptz
    END AS last_bling_update_at,
    NULLIF(r.intermediador_cnpj, '') AS intermediador_cnpj,
    NULLIF(r.intermediador_nome, '') AS intermediador_nome
  FROM jsonb_to_recordset(
    CASE WHEN jsonb_typeof(COALESCE(_rows, '[]'::jsonb)) = 'array' THEN COALESCE(_rows, '[]'::jsonb) ELSE '[]'::jsonb END
  ) AS r(
    bling_product_id text, bling_store_id text, bling_product_store_id text,
    store_name text, store_type text, store_product_code text,
    current_price numeric, current_promotional_price numeric,
    supplier_store_id text, brand_store_id text,
    categories_json jsonb, raw_data_json jsonb,
    last_bling_update_at text, intermediador_cnpj text, intermediador_nome text
  );

  -- Dedup within batch: keep the newest bling_product_store_id per (product, store)
  CREATE TEMP TABLE _dedup ON COMMIT DROP AS
  SELECT DISTINCT ON (bling_product_id, bling_store_id) *
  FROM _in
  WHERE bling_product_id IS NOT NULL
    AND bling_store_id IS NOT NULL
    AND bling_product_store_id IS NOT NULL
  ORDER BY bling_product_id, bling_store_id, bling_product_store_id DESC;

  -- Remove stale rows in the DB that would collide on prod_store_uk
  -- (same integration/product/store but different bling_product_store_id).
  DELETE FROM public.bling_product_stores b
  USING _dedup d
  WHERE b.integration_id = _integration_id
    AND b.bling_product_id = d.bling_product_id
    AND b.bling_store_id = d.bling_store_id
    AND b.bling_product_store_id IS DISTINCT FROM d.bling_product_store_id;

  WITH valid AS (
    SELECT d.*, p.id AS internal_product_id
    FROM _dedup d
    LEFT JOIN public.bling_products p
      ON p.company_id = _company_id
     AND p.bling_product_id = d.bling_product_id
  ),
  upserted AS (
    INSERT INTO public.bling_product_stores AS b (
      company_id, integration_id, internal_product_id,
      bling_product_id, bling_store_id, bling_product_store_id,
      store_name, store_type, store_product_code,
      current_price, current_promotional_price,
      supplier_store_id, brand_store_id,
      categories_json, raw_data_json,
      is_linked, last_bling_update_at, last_imported_at, last_seen_run_id,
      sync_status, sync_error, intermediador_cnpj, intermediador_nome
    )
    SELECT
      _company_id, _integration_id, v.internal_product_id,
      v.bling_product_id, v.bling_store_id, v.bling_product_store_id,
      v.store_name, v.store_type, v.store_product_code,
      v.current_price, v.current_promotional_price,
      v.supplier_store_id, v.brand_store_id,
      v.categories_json, v.raw_data_json,
      true, v.last_bling_update_at, now(), _run_id,
      CASE WHEN v.internal_product_id IS NULL THEN 'produto_nao_encontrado' ELSE 'ok' END,
      NULL, v.intermediador_cnpj, v.intermediador_nome
    FROM valid v
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
      sync_error = NULL,
      intermediador_cnpj = COALESCE(EXCLUDED.intermediador_cnpj, b.intermediador_cnpj),
      intermediador_nome = COALESCE(EXCLUDED.intermediador_nome, b.intermediador_nome)
    RETURNING (xmax = 0) AS inserted, internal_product_id IS NOT NULL AS matched
  )
  SELECT jsonb_build_object(
    'processed', (SELECT count(*) FROM _dedup),
    'inserted', count(*) FILTER (WHERE inserted),
    'updated', count(*) FILTER (WHERE NOT inserted),
    'matched', count(*) FILTER (WHERE matched),
    'unmatched', count(*) FILTER (WHERE NOT matched),
    'errors', GREATEST((SELECT count(*) FROM _in) - (SELECT count(*) FROM _dedup), 0)
  ) INTO _res
  FROM upserted;

  RETURN COALESCE(_res, jsonb_build_object('processed',0,'inserted',0,'updated',0,'matched',0,'unmatched',0,'errors',0));
END;
$function$;

-- 3) Helpful index for the stores subquery in enqueue_bling_push
CREATE INDEX IF NOT EXISTS bling_product_stores_company_linked_idx
  ON public.bling_product_stores (company_id, internal_product_id)
  WHERE is_linked = true AND bling_product_store_id IS NOT NULL;