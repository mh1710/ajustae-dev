-- Corrige erro "duplicate key value violates unique constraint uniq_push_queue_pending_store"
-- ao aplicar a planilha de ID na loja: linhas repetidas (mesmo SKU + mesma loja)
-- geravam dois itens pendentes iguais na fila de envio.

CREATE OR REPLACE FUNCTION public.apply_store_code_sheet(
  _company_id uuid,
  _rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '180s'
AS $$
DECLARE
  _integration_id uuid;
  _enqueued integer := 0;
  _skipped integer := 0;
  _duplicadas integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT id INTO _integration_id
  FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada'
  LIMIT 1;

  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada.';
  END IF;

  CREATE TEMP TABLE _sheet_work ON COMMIT DROP AS
  SELECT * FROM public.match_store_code_sheet(_company_id, _rows);

  SELECT count(*) INTO _skipped FROM _sheet_work WHERE status <> 'ok';

  -- mantém apenas a última linha de cada (produto + loja)
  CREATE TEMP TABLE _sheet_ok ON COMMIT DROP AS
  SELECT DISTINCT ON (w.product_id, w.bling_product_store_id) w.*
  FROM _sheet_work w
  WHERE w.status = 'ok'
  ORDER BY w.product_id, w.bling_product_store_id, w.linha DESC;

  SELECT (SELECT count(*) FROM _sheet_work WHERE status = 'ok') - (SELECT count(*) FROM _sheet_ok)
  INTO _duplicadas;

  -- remove itens antigos da mesma origem ainda pendentes
  DELETE FROM public.bling_push_queue q
  USING _sheet_ok w
  WHERE q.integration_id = _integration_id
    AND q.tipo = 'codigo_loja_planilha'
    AND q.bling_product_store_id = w.bling_product_store_id
    AND q.status IN ('pendente', 'processando');

  WITH inserted AS (
    INSERT INTO public.bling_push_queue (
      company_id, integration_id, product_id, bling_product_id,
      bling_product_store_id, tipo, valor_novo, payload,
      status, proxima_tentativa_em
    )
    SELECT
      _company_id, _integration_id, w.product_id, w.bling_product_id,
      w.bling_product_store_id, 'codigo_loja_planilha', w.preco,
      jsonb_build_object(
        'bling_store_id', w.bling_store_id,
        'codigo', w.codigo_novo,
        'preco', w.preco,
        'preco_promocional', w.preco_promocional,
        'origem', 'planilha'
      ),
      'pendente', now()
    FROM _sheet_ok w
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _enqueued FROM inserted;

  UPDATE public.bling_product_stores bps
  SET store_product_code = w.codigo_novo
  FROM _sheet_ok w
  WHERE bps.company_id = _company_id
    AND bps.bling_product_store_id = w.bling_product_store_id;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'enqueued', _enqueued,
    'skipped', _skipped,
    'duplicadas', _duplicadas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_store_code_sheet(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_store_code_sheet(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_store_code_sheet(uuid, jsonb) TO service_role;
