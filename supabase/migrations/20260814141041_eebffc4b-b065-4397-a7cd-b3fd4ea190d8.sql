CREATE OR REPLACE FUNCTION public.audit_price_policy(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[], _limit int DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '0'
AS $function$
DECLARE
  _pricing pricing_settings%ROWTYPE;
  _default_comissao numeric;
  _no_default_marketplace boolean := false;
  _total int := 0;
  _avaliados int := 0;
  _ok int := 0;
  _diverg int := 0;
  _sem_base int := 0;
  _items jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT * INTO _pricing FROM public.pricing_settings WHERE company_id = _company_id;

  SELECT m.taxa_percent INTO _default_comissao
  FROM public.bling_stores bs
  JOIN public.marketplaces m ON m.id = bs.marketplace_id
  WHERE bs.company_id = _company_id AND bs.is_default = true
  LIMIT 1;

  IF _default_comissao IS NULL AND _pricing.default_marketplace_id IS NOT NULL THEN
    SELECT taxa_percent INTO _default_comissao
    FROM public.marketplaces WHERE id = _pricing.default_marketplace_id;
  END IF;
  IF _default_comissao IS NULL THEN _no_default_marketplace := true; END IF;

  CREATE TEMP TABLE _audit_work ON COMMIT DROP AS
  WITH prods AS (
    SELECT p.id, p.codigo AS sku, p.nome, p.preco AS preco_atual,
           upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix,
           btrim(substring(p.codigo from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
  ),
  mapped AS (
    SELECT pr.*, CASE prefix
      WHEN 'ODS' THEN 'oderco' WHEN 'O' THEN 'oderco'
      WHEN 'HX' THEN 'hayamax' WHEN 'HA' THEN 'hayamax'
      WHEN 'EV' THEN 'evolusom' WHEN 'E' THEN 'evolusom'
      ELSE NULL END AS sup_codigo
    FROM prods pr
  ),
  joined AS (
    SELECT m.*, s.id AS sup_id,
      s.preco_embalagem AS sup_emb, s.preco_transporte AS sup_transp,
      s.taxa_devolucao AS sup_devol, s.taxa_promocao AS sup_promo,
      COALESCE(
        NULLIF((fp.precos->>'PR')::numeric, 0),
        NULLIF((fp.precos->>'base')::numeric, 0),
        NULLIF((fp.precos->>'dropshipping')::numeric, 0),
        NULLIF((fp.precos->>'crossdocking')::numeric, 0)
      ) AS fp_preco
    FROM mapped m
    LEFT JOIN public.fornecedores s ON s.codigo = m.sup_codigo
    LEFT JOIN public.fornecedor_produtos fp
      ON fp.fornecedor_id = s.id AND btrim(fp.codigo) = m.num_code AND m.num_code <> ''
  ),
  calc AS (
    SELECT j.*, (
      COALESCE(j.fp_preco, 0)
      + COALESCE(j.sup_emb, COALESCE(_pricing.embalagem_default, 0))
      + COALESCE(j.sup_transp, COALESCE(_pricing.transporte_default, 0))
      + CASE WHEN COALESCE(_pricing.taxa_operacional_valor, 0) > 0
              AND COALESCE(j.fp_preco, 0) >= COALESCE(_pricing.taxa_operacional_min_custo, 0)
             THEN _pricing.taxa_operacional_valor ELSE 0 END
    ) AS cmv_base
    FROM joined j
  ),
  calc2 AS (
    SELECT c.*, (c.cmv_base * (1 + COALESCE(_pricing.frete_medio_percent, 0)/100)) AS cmv_total FROM calc c
  ),
  calc3 AS (
    SELECT c.*, (
      c.cmv_total
      + c.cmv_total * COALESCE(_pricing.custo_fixo_percent, 0)/100
      + c.cmv_total * COALESCE(_pricing.devolucao_percent, 0)/100
    ) AS custo_completo
    FROM calc2 c
  )
  SELECT c.id, c.sku, c.nome, c.preco_atual,
    CASE
      WHEN _no_default_marketplace THEN NULL
      WHEN c.sup_id IS NULL THEN NULL
      WHEN c.fp_preco IS NULL OR c.fp_preco <= 0 THEN NULL
      ELSE public._apply_price_anchor(
        public._compute_sale_price(
          c.custo_completo,
          COALESCE(_default_comissao, 0),
          COALESCE(c.sup_devol, 0),
          COALESCE(c.sup_promo, 0),
          COALESCE(_pricing.profit_bands, '[]'::jsonb)
        ),
        COALESCE(_pricing.price_anchors, '[]'::jsonb)
      )
    END AS preco_esperado
  FROM calc3 c;

  SELECT
    count(*),
    count(*) FILTER (WHERE preco_esperado IS NOT NULL),
    count(*) FILTER (WHERE preco_esperado IS NOT NULL AND abs(COALESCE(preco_atual, -1) - preco_esperado) <= 0.005),
    count(*) FILTER (WHERE preco_esperado IS NOT NULL AND abs(COALESCE(preco_atual, -1) - preco_esperado) > 0.005),
    count(*) FILTER (WHERE preco_esperado IS NULL)
  INTO _total, _avaliados, _ok, _diverg, _sem_base
  FROM _audit_work;

  SELECT jsonb_agg(row_to_json(t)) INTO _items FROM (
    SELECT sku, nome, preco_atual, preco_esperado,
           round((COALESCE(preco_atual,0) - preco_esperado)::numeric, 2) AS diferenca
    FROM _audit_work
    WHERE preco_esperado IS NOT NULL
      AND abs(COALESCE(preco_atual, -1) - preco_esperado) > 0.005
    ORDER BY abs(COALESCE(preco_atual, 0) - preco_esperado) DESC
    LIMIT GREATEST(1, COALESCE(_limit, 100))
  ) t;

  RETURN jsonb_build_object(
    'total', _total,
    'avaliados', _avaliados,
    'ok', _ok,
    'divergentes', _diverg,
    'sem_base', _sem_base,
    'no_default_marketplace', _no_default_marketplace,
    'items', COALESCE(_items, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_price_policy(uuid, uuid[], int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_price_policy(uuid, uuid[], int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_price_policy(uuid, uuid[], int) TO service_role;