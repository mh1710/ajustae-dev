-- O "ID na loja" (campo código do anúncio) varia por marketplace:
--  * alguns usam o SKU do produto;
--  * Web Continental usa o ID da multiloja;
--  * nos demais não sabemos a regra -> não mexemos.
CREATE OR REPLACE FUNCTION public.bling_store_code_kind(_store_type text, _store_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(coalesce(_store_type, '')) IN (
      'amazon', 'kabum', 'madeiramadeira', 'viavarejo', 'casasbahia',
      'americanas', 'b2w', 'omnik', 'magalu', 'magazineluiza', 'olist'
    ) THEN 'sku'
    WHEN lower(coalesce(_store_type, '')) = 'integracommerce'
     AND lower(coalesce(_store_name, '')) LIKE '%magalu%' THEN 'sku'
    WHEN lower(coalesce(_store_name, '')) LIKE '%webco%'
      OR lower(coalesce(_store_name, '')) LIKE '%continental%'
      OR lower(coalesce(_store_name, '')) LIKE '%web ung%' THEN 'store_id'
    ELSE 'unknown'
  END;
$$;

REVOKE ALL ON FUNCTION public.bling_store_code_kind(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bling_store_code_kind(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bling_store_code_kind(text, text) TO service_role;

-- Prévia: quais lojas ficarão de fora por não sabermos o que vai no "ID na loja".
CREATE OR REPLACE FUNCTION public.preview_bling_store_id_code(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  _res jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH base AS (
    SELECT
      coalesce(nullif(btrim(bps.store_name), ''), bps.bling_store_id) AS store_name,
      public.bling_store_code_kind(bps.store_type, bps.store_name) AS kind
    FROM public.bling_product_stores bps
    WHERE bps.company_id = _company_id
      AND bps.is_linked = true
      AND (_product_ids IS NULL OR bps.internal_product_id = ANY(_product_ids))
  ), agg AS (
    SELECT store_name, kind, count(*) AS total
    FROM base GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'total', (SELECT coalesce(sum(total), 0) FROM agg),
    'sku', (SELECT coalesce(sum(total), 0) FROM agg WHERE kind = 'sku'),
    'store_id', (SELECT coalesce(sum(total), 0) FROM agg WHERE kind = 'store_id'),
    'unknown', (SELECT coalesce(sum(total), 0) FROM agg WHERE kind = 'unknown'),
    'unknown_stores', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('store_name', store_name, 'total', total) ORDER BY total DESC), '[]'::jsonb)
      FROM agg WHERE kind = 'unknown'
    )
  ) INTO _res;

  RETURN _res;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_bling_store_id_code(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_bling_store_id_code(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_bling_store_id_code(uuid, uuid[]) TO service_role;

-- Transformação "ID da multiloja -> ID na loja": agora o código enviado depende
-- do marketplace. Lojas desconhecidas são puladas.
CREATE OR REPLACE FUNCTION public.enqueue_bling_store_id_code(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  _integration_id uuid;
  _enqueued integer := 0;
  _skipped integer := 0;
  _skipped_unknown integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.company_users
    WHERE company_id = _company_id
      AND user_id = auth.uid()
      AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT id INTO _integration_id
  FROM public.bling_integrations
  WHERE company_id = _company_id
    AND status = 'conectada'
  LIMIT 1;

  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada.';
  END IF;

  CREATE TEMP TABLE _store_code_work ON COMMIT DROP AS
  SELECT
    bps.internal_product_id AS product_id,
    p.bling_product_id,
    bps.bling_product_store_id,
    bps.bling_store_id,
    bps.store_product_code,
    bps.current_price,
    bps.current_promotional_price,
    public.bling_store_code_kind(bps.store_type, bps.store_name) AS kind,
    CASE public.bling_store_code_kind(bps.store_type, bps.store_name)
      WHEN 'sku' THEN nullif(btrim(p.codigo), '')
      WHEN 'store_id' THEN nullif(btrim(bps.bling_store_id), '')
      ELSE NULL
    END AS desired_code
  FROM public.bling_product_stores bps
  JOIN public.bling_products p
    ON p.id = bps.internal_product_id
   AND p.company_id = bps.company_id
  WHERE bps.company_id = _company_id
    AND bps.is_linked = true
    AND (_product_ids IS NULL OR bps.internal_product_id = ANY(_product_ids));

  SELECT count(*) INTO _skipped_unknown
  FROM _store_code_work WHERE kind = 'unknown';

  DELETE FROM _store_code_work
  WHERE kind = 'unknown'
     OR desired_code IS NULL
     OR store_product_code IS NOT DISTINCT FROM desired_code;

  DELETE FROM public.bling_push_queue q
  USING _store_code_work w
  WHERE q.integration_id = _integration_id
    AND q.product_id = w.product_id
    AND q.tipo = 'codigo_loja'
    AND q.bling_product_store_id = w.bling_product_store_id
    AND q.status IN ('pendente', 'processando');

  WITH inserted AS (
    INSERT INTO public.bling_push_queue (
      company_id, integration_id, product_id, bling_product_id,
      bling_product_store_id, tipo, valor_novo, payload,
      status, proxima_tentativa_em
    )
    SELECT
      _company_id,
      _integration_id,
      w.product_id,
      w.bling_product_id,
      w.bling_product_store_id,
      'codigo_loja',
      COALESCE(w.current_price, 0),
      jsonb_build_object(
        'bling_store_id', w.bling_store_id,
        'codigo', w.desired_code,
        'codigo_kind', w.kind,
        'preco', w.current_price,
        'preco_promocional', w.current_promotional_price
      ),
      'pendente',
      now()
    FROM _store_code_work w
    WHERE NULLIF(btrim(w.bling_product_id), '') IS NOT NULL
      AND NULLIF(btrim(w.bling_product_store_id), '') IS NOT NULL
      AND NULLIF(btrim(w.bling_store_id), '') IS NOT NULL
      AND w.current_price IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO _enqueued FROM inserted;

  SELECT count(*) INTO _skipped
  FROM _store_code_work w
  WHERE NULLIF(btrim(w.bling_product_id), '') IS NULL
     OR NULLIF(btrim(w.bling_product_store_id), '') IS NULL
     OR NULLIF(btrim(w.bling_store_id), '') IS NULL
     OR w.current_price IS NULL;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'enqueued', _enqueued,
    'skipped', _skipped,
    'skipped_unknown', _skipped_unknown
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_bling_store_id_code(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_bling_store_id_code(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_bling_store_id_code(uuid, uuid[]) TO service_role;
