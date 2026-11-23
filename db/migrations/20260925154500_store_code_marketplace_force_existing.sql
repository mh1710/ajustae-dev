-- Permite reenviar pela transformação de marketplace os IDs que já aparecem corretos na base.
DROP FUNCTION IF EXISTS public.apply_marketplace_store_code(uuid, text, uuid[]);

CREATE FUNCTION public.apply_marketplace_store_code(
  _company_id uuid,
  _marketplace text,
  _product_ids uuid[] DEFAULT NULL,
  _force_existing boolean DEFAULT false
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
  _existing_enqueued integer := 0;
BEGIN
  IF _marketplace NOT IN ('kabum', 'web_continental') THEN
    RAISE EXCEPTION 'Marketplace inválido.';
  END IF;
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

  CREATE TEMP TABLE _marketplace_codes ON COMMIT DROP AS
  SELECT * FROM public.match_marketplace_store_code(_company_id, _marketplace, _product_ids);

  CREATE TEMP TABLE _marketplace_eligible ON COMMIT DROP AS
  SELECT *
  FROM _marketplace_codes
  WHERE status = 'atualizar'
     OR (_force_existing AND status = 'ja_correto');

  SELECT count(*) INTO _skipped
  FROM _marketplace_codes
  WHERE status NOT IN ('atualizar', 'ja_correto')
     OR (status = 'ja_correto' AND NOT _force_existing);

  SELECT count(*) INTO _existing_enqueued
  FROM _marketplace_eligible
  WHERE status = 'ja_correto';

  DELETE FROM public.bling_push_queue q
  USING _marketplace_eligible w
  WHERE q.integration_id = _integration_id
    AND q.tipo = 'codigo_loja_planilha'
    AND q.bling_product_store_id = w.bling_product_store_id
    AND q.status IN ('pendente', 'processando');

  WITH inserted AS (
    INSERT INTO public.bling_push_queue (
      company_id, integration_id, product_id, bling_product_id,
      bling_product_store_id, tipo, valor_novo, payload, status, proxima_tentativa_em
    )
    SELECT
      _company_id, _integration_id, w.product_id, w.bling_product_id,
      w.bling_product_store_id, 'codigo_loja_planilha', w.preco,
      jsonb_build_object(
        'bling_store_id', w.bling_store_id,
        'codigo', w.codigo_novo,
        'preco', w.preco,
        'preco_promocional', w.preco_promocional,
        'origem', 'marketplace',
        'marketplace', _marketplace,
        'reenvio', w.status = 'ja_correto'
      ),
      'pendente', now()
    FROM _marketplace_eligible w
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _enqueued FROM inserted;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'enqueued', _enqueued,
    'existing_enqueued', _existing_enqueued,
    'skipped', _skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_marketplace_store_code(uuid, text, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_marketplace_store_code(uuid, text, uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_marketplace_store_code(uuid, text, uuid[], boolean) TO service_role;