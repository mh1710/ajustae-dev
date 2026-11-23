-- Atualização confirmada do "ID na loja" apenas para marketplaces conhecidos.
CREATE OR REPLACE FUNCTION public.match_marketplace_store_code(
  _company_id uuid,
  _marketplace text,
  _product_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  product_id uuid,
  bling_product_id text,
  bling_product_store_id text,
  bling_store_id text,
  store_name text,
  codigo_atual text,
  codigo_novo text,
  preco numeric,
  preco_promocional numeric,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    bps.internal_product_id,
    p.bling_product_id,
    bps.bling_product_store_id,
    bps.bling_store_id,
    bps.store_name,
    bps.store_product_code,
    CASE _marketplace
      WHEN 'kabum' THEN nullif(btrim(p.codigo), '')
      WHEN 'web_continental' THEN nullif(btrim(bps.bling_store_id), '')
    END,
    bps.current_price,
    bps.current_promotional_price,
    CASE
      WHEN _marketplace NOT IN ('kabum', 'web_continental') THEN 'marketplace_invalido'
      WHEN nullif(btrim(p.bling_product_id), '') IS NULL
        OR nullif(btrim(bps.bling_product_store_id), '') IS NULL
        OR nullif(btrim(bps.bling_store_id), '') IS NULL
        OR bps.current_price IS NULL THEN 'sem_dados'
      WHEN (_marketplace = 'kabum' AND nullif(btrim(p.codigo), '') IS NULL) THEN 'sem_dados'
      WHEN btrim(coalesce(bps.store_product_code, '')) = btrim(CASE _marketplace
        WHEN 'kabum' THEN coalesce(p.codigo, '')
        WHEN 'web_continental' THEN coalesce(bps.bling_store_id, '')
      END) THEN 'ja_correto'
      ELSE 'atualizar'
    END
  FROM public.bling_product_stores bps
  JOIN public.bling_products p
    ON p.id = bps.internal_product_id
   AND p.company_id = bps.company_id
  WHERE bps.company_id = _company_id
    AND bps.is_linked = true
    AND (_product_ids IS NULL OR bps.internal_product_id = ANY(_product_ids))
    AND (
      (_marketplace = 'kabum' AND (
        lower(coalesce(bps.store_type, '')) = 'kabum'
        OR lower(coalesce(bps.store_name, '')) LIKE '%kabum%'
      ))
      OR
      (_marketplace = 'web_continental' AND (
        lower(coalesce(bps.store_name, '')) LIKE '%webco%'
        OR lower(coalesce(bps.store_name, '')) LIKE '%continental%'
      ))
    );
$$;

REVOKE ALL ON FUNCTION public.match_marketplace_store_code(uuid, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_marketplace_store_code(uuid, text, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.preview_marketplace_store_code(
  _company_id uuid,
  _marketplace text,
  _product_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _result jsonb;
BEGIN
  IF _marketplace NOT IN ('kabum', 'web_continental') THEN
    RAISE EXCEPTION 'Marketplace inválido.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN RAISE EXCEPTION 'not a member of company'; END IF;

  SELECT jsonb_build_object(
    'total', count(*),
    'to_update', count(*) FILTER (WHERE status = 'atualizar'),
    'already_correct', count(*) FILTER (WHERE status = 'ja_correto'),
    'skipped', count(*) FILTER (WHERE status NOT IN ('atualizar', 'ja_correto'))
  ) INTO _result
  FROM public.match_marketplace_store_code(_company_id, _marketplace, _product_ids);
  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_marketplace_store_code(uuid, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_marketplace_store_code(uuid, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_marketplace_store_code(uuid, text, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_marketplace_store_code(
  _company_id uuid,
  _marketplace text,
  _product_ids uuid[] DEFAULT NULL
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
BEGIN
  IF _marketplace NOT IN ('kabum', 'web_continental') THEN
    RAISE EXCEPTION 'Marketplace inválido.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN RAISE EXCEPTION 'not a member of company'; END IF;

  SELECT id INTO _integration_id FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada' LIMIT 1;
  IF _integration_id IS NULL THEN RAISE EXCEPTION 'Nenhuma integração Bling conectada.'; END IF;

  CREATE TEMP TABLE _marketplace_codes ON COMMIT DROP AS
  SELECT * FROM public.match_marketplace_store_code(_company_id, _marketplace, _product_ids);

  SELECT count(*) INTO _skipped FROM _marketplace_codes WHERE status <> 'atualizar';

  DELETE FROM public.bling_push_queue q USING _marketplace_codes w
  WHERE q.integration_id = _integration_id
    AND q.tipo = 'codigo_loja_planilha'
    AND q.bling_product_store_id = w.bling_product_store_id
    AND q.status IN ('pendente', 'processando')
    AND w.status = 'atualizar';

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
        'marketplace', _marketplace
      ),
      'pendente', now()
    FROM _marketplace_codes w
    WHERE w.status = 'atualizar'
    RETURNING 1
  )
  SELECT count(*) INTO _enqueued FROM inserted;

  -- A cópia local será atualizada exclusivamente pelo worker, depois de
  -- confirmar no Bling que o código persistido é exatamente o esperado.
  RETURN jsonb_build_object('integration_id', _integration_id, 'enqueued', _enqueued, 'skipped', _skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_marketplace_store_code(uuid, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_marketplace_store_code(uuid, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_marketplace_store_code(uuid, text, uuid[]) TO service_role;