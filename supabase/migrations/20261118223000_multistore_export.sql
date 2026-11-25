-- Página da planilha de vínculo multiloja: preço calculado pela política da
-- empresa com a taxa do marketplace da multiloja (mesma fórmula de
-- transform_update_price_stock), sem gravar nada.
CREATE OR REPLACE FUNCTION public.multistore_export_page(
  _company_id uuid,
  _bling_store_id text,
  _scope text DEFAULT 'linked',
  _offset integer DEFAULT 0,
  _limit integer DEFAULT 1000
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _pricing pricing_settings%ROWTYPE;
  _store_name text;
  _store_marketplace uuid;
  _fee numeric;
  _default_fee numeric;
  _total integer;
  _rows jsonb;
BEGIN
  IF _scope NOT IN ('linked', 'all') THEN RAISE EXCEPTION 'Escopo inválido'; END IF;
  _limit := LEAST(GREATEST(COALESCE(_limit, 1000), 1), 1000);
  _offset := GREATEST(COALESCE(_offset, 0), 0);

  SELECT COALESCE(NULLIF(btrim(bs.descricao), ''), bs.bling_store_id), bs.marketplace_id
    INTO _store_name, _store_marketplace
  FROM public.bling_stores bs
  WHERE bs.company_id = _company_id AND bs.bling_store_id = _bling_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Multiloja não encontrada nesta empresa.'; END IF;

  SELECT * INTO _pricing FROM public.pricing_settings WHERE company_id = _company_id;

  IF _store_marketplace IS NOT NULL THEN
    _fee := public.company_marketplace_fee(_company_id, _store_marketplace);
  END IF;
  SELECT public.company_marketplace_fee(_company_id, bs.marketplace_id) INTO _default_fee
  FROM public.bling_stores bs
  WHERE bs.company_id = _company_id AND bs.is_default = true AND bs.marketplace_id IS NOT NULL
  LIMIT 1;
  IF _default_fee IS NULL AND _pricing.default_marketplace_id IS NOT NULL THEN
    _default_fee := public.company_marketplace_fee(_company_id, _pricing.default_marketplace_id);
  END IF;
  _fee := COALESCE(_fee, _default_fee);

  SELECT count(*) INTO _total
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND NULLIF(btrim(p.bling_product_id::text), '') IS NOT NULL
    AND (_scope = 'all' OR EXISTS (
      SELECT 1 FROM public.bling_product_stores l
      WHERE l.company_id = _company_id AND l.bling_store_id = _bling_store_id
        AND l.bling_product_id = p.bling_product_id AND l.is_linked
    ));

  WITH page AS (
    SELECT p.id, p.bling_product_id, p.nome, btrim(p.codigo) AS codigo, p.preco,
           upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix,
           btrim(substring(p.codigo from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND NULLIF(btrim(p.bling_product_id::text), '') IS NOT NULL
      AND (_scope = 'all' OR EXISTS (
        SELECT 1 FROM public.bling_product_stores l
        WHERE l.company_id = _company_id AND l.bling_store_id = _bling_store_id
          AND l.bling_product_id = p.bling_product_id AND l.is_linked
      ))
    ORDER BY p.codigo, p.id
    OFFSET _offset LIMIT _limit
  ),
  joined AS (
    SELECT pg.*,
      s.id AS sup_id, s.preco_embalagem AS sup_emb, s.preco_transporte AS sup_transp,
      s.taxa_devolucao AS sup_devol, s.taxa_promocao AS sup_promo,
      COALESCE(
        NULLIF((fp.precos->>'PR')::numeric, 0),
        NULLIF((fp.precos->>'base')::numeric, 0),
        NULLIF((fp.precos->>'dropshipping')::numeric, 0),
        NULLIF((fp.precos->>'crossdocking')::numeric, 0)
      ) AS fp_preco,
      (SELECT l.current_price FROM public.bling_product_stores l
        WHERE l.company_id = _company_id AND l.bling_store_id = _bling_store_id
          AND l.bling_product_id = pg.bling_product_id AND l.is_linked
        LIMIT 1) AS loja_preco
    FROM page pg
    LEFT JOIN public.fornecedores s ON s.codigo = public.map_supplier_prefix(pg.prefix)
    LEFT JOIN LATERAL (
      SELECT f.precos FROM public.fornecedor_produtos f
      WHERE f.fornecedor_id = s.id AND btrim(f.codigo) = pg.num_code AND pg.num_code <> ''
      LIMIT 1
    ) fp ON true
  ),
  costed AS (
    SELECT j.*,
      (
        (
          COALESCE(j.fp_preco, 0)
          + COALESCE(j.sup_emb, COALESCE(_pricing.embalagem_default, 0))
          + COALESCE(j.sup_transp, COALESCE(_pricing.transporte_default, 0))
          + CASE WHEN COALESCE(_pricing.taxa_operacional_valor, 0) > 0
                  AND COALESCE(j.fp_preco, 0) >= COALESCE(_pricing.taxa_operacional_min_custo, 0)
                 THEN _pricing.taxa_operacional_valor ELSE 0 END
        ) * (1 + COALESCE(_pricing.frete_medio_percent, 0)/100)
      ) AS cmv_total
    FROM joined j
  ),
  priced AS (
    SELECT c.*,
      CASE
        WHEN _fee IS NULL OR c.sup_id IS NULL OR c.fp_preco IS NULL OR c.fp_preco <= 0 THEN NULL
        ELSE public._apply_price_anchor(
          public._compute_sale_price(
            c.cmv_total + c.cmv_total * COALESCE(_pricing.custo_fixo_percent, 0)/100
                        + c.cmv_total * COALESCE(_pricing.devolucao_percent, 0)/100,
            _fee,
            COALESCE(c.sup_devol, 0),
            COALESCE(c.sup_promo, 0),
            COALESCE(_pricing.profit_bands, '[]'::jsonb)
          ),
          COALESCE(_pricing.price_anchors, '[]'::jsonb)
        )
      END AS preco_regra
    FROM costed c
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'bling_product_id', pr.bling_product_id::text,
      'nome', pr.nome,
      'codigo', pr.codigo,
      'preco', CASE
        WHEN pr.preco_regra > 0 THEN round(pr.preco_regra, 2)
        WHEN pr.loja_preco > 0 THEN round(pr.loja_preco, 2)
        WHEN pr.preco > 0 THEN round(pr.preco, 2)
        ELSE NULL END,
      'fonte', CASE
        WHEN pr.preco_regra > 0 THEN 'regra'
        WHEN pr.loja_preco > 0 THEN 'loja'
        WHEN pr.preco > 0 THEN 'produto'
        ELSE NULL END
    ) ORDER BY pr.codigo, pr.id), '[]'::jsonb)
  INTO _rows
  FROM priced pr;

  RETURN jsonb_build_object(
    'total', _total,
    'store_id', _bling_store_id,
    'store_name', _store_name,
    'rows', _rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.multistore_export_page(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.multistore_export_page(uuid, text, text, integer, integer) TO service_role;
