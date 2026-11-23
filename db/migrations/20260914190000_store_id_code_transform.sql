ALTER TABLE public.bling_push_queue
  DROP CONSTRAINT IF EXISTS bling_push_queue_tipo_check;

ALTER TABLE public.bling_push_queue
  ADD CONSTRAINT bling_push_queue_tipo_check
  CHECK (tipo IN (
    'preco', 'estoque', 'produto', 'criar', 'excluir', 'inativar',
    'preco_loja', 'estoque_loja', 'vincular_loja', 'desvincular_loja',
    'codigo_loja'
  ));

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
    bps.current_price,
    bps.current_promotional_price
  FROM public.bling_product_stores bps
  JOIN public.bling_products p
    ON p.id = bps.internal_product_id
   AND p.company_id = bps.company_id
  WHERE bps.company_id = _company_id
    AND bps.is_linked = true
    AND (_product_ids IS NULL OR bps.internal_product_id = ANY(_product_ids));

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
        'codigo', w.bling_store_id,
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
    'skipped', _skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_bling_store_id_code(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_bling_store_id_code(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_bling_store_id_code(uuid, uuid[]) TO service_role;