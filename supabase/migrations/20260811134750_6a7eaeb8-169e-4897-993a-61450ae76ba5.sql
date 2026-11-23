CREATE OR REPLACE FUNCTION public.pricing_policy_status(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _p pricing_settings%ROWTYPE;
  _issues text[] := '{}';
  _bands_zero boolean := true;
  _has_default_mkt boolean := false;
  _mkt_zero boolean := false;
  _comissao numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT * INTO _p FROM public.pricing_settings WHERE company_id = _company_id;

  IF _p.company_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'has_settings', false,
      'issues', jsonb_build_array('Nenhuma política de preços definida para esta empresa.')
    );
  END IF;

  SELECT bool_and(COALESCE((b->>'margin_percent')::numeric, 0) = 0)
    INTO _bands_zero
  FROM jsonb_array_elements(COALESCE(_p.profit_bands, '[]'::jsonb)) b;
  _bands_zero := COALESCE(_bands_zero, true);

  SELECT m.taxa_percent INTO _comissao
  FROM public.bling_stores bs
  JOIN public.marketplaces m ON m.id = bs.marketplace_id
  WHERE bs.company_id = _company_id AND bs.is_default = true
  LIMIT 1;

  IF _comissao IS NULL AND _p.default_marketplace_id IS NOT NULL THEN
    SELECT taxa_percent INTO _comissao FROM public.marketplaces WHERE id = _p.default_marketplace_id;
  END IF;

  _has_default_mkt := _comissao IS NOT NULL;
  _mkt_zero := _has_default_mkt AND COALESCE(_comissao, 0) = 0;

  IF _bands_zero THEN
    _issues := _issues || 'As faixas de lucro estão todas zeradas — o preço de venda sairá igual ao custo.';
  END IF;
  IF NOT _has_default_mkt THEN
    _issues := _issues || 'Nenhum marketplace padrão definido (Multilojas ou Precificação) — o preço de venda não será calculado.';
  ELSIF _mkt_zero THEN
    _issues := _issues || 'A comissão do marketplace padrão está zerada.';
  END IF;
  IF COALESCE(_p.frete_medio_percent,0) = 0
     AND COALESCE(_p.custo_fixo_percent,0) = 0
     AND COALESCE(_p.devolucao_percent,0) = 0
     AND COALESCE(_p.embalagem_default,0) = 0
     AND COALESCE(_p.transporte_default,0) = 0
     AND COALESCE(_p.taxa_operacional_valor,0) = 0 THEN
    _issues := _issues || 'Todos os percentuais e valores de composição de custo estão zerados.';
  END IF;

  RETURN jsonb_build_object(
    'ok', array_length(_issues, 1) IS NULL,
    'has_settings', true,
    'bands_zero', _bands_zero,
    'has_default_marketplace', _has_default_mkt,
    'issues', COALESCE(to_jsonb(_issues), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.low_margin_products(_company_id uuid, _threshold numeric DEFAULT 20, _limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _p pricing_settings%ROWTYPE;
  _default_comissao numeric;
  _count int := 0;
  _items jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT * INTO _p FROM public.pricing_settings WHERE company_id = _company_id;

  SELECT m.taxa_percent INTO _default_comissao
  FROM public.bling_stores bs
  JOIN public.marketplaces m ON m.id = bs.marketplace_id
  WHERE bs.company_id = _company_id AND bs.is_default = true
  LIMIT 1;

  IF _default_comissao IS NULL AND _p.default_marketplace_id IS NOT NULL THEN
    SELECT taxa_percent INTO _default_comissao FROM public.marketplaces WHERE id = _p.default_marketplace_id;
  END IF;

  CREATE TEMP TABLE _lm ON COMMIT DROP AS
  WITH prods AS (
    SELECT p.id, p.codigo AS sku, p.nome, p.preco, p.preco_custo,
           upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND p.preco IS NOT NULL AND p.preco > 0
      AND p.preco_custo IS NOT NULL AND p.preco_custo > 0
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
    SELECT m.*, s.preco_embalagem AS sup_emb, s.preco_transporte AS sup_transp,
           s.taxa_devolucao AS sup_devol, s.taxa_promocao AS sup_promo,
           ov.embalagem AS ov_emb, ov.transporte AS ov_transp, ov.taxa_operacional AS ov_taxa_op,
           (SELECT max(mk.taxa_percent)
              FROM public.bling_product_stores bps
              JOIN public.bling_stores bs2 ON bs2.bling_store_id = bps.bling_store_id AND bs2.company_id = bps.company_id
              LEFT JOIN public.marketplaces mk ON mk.id = bs2.marketplace_id
             WHERE bps.company_id = _company_id AND bps.internal_product_id = m.id) AS store_comissao
    FROM mapped m
    LEFT JOIN public.fornecedores s ON s.codigo = m.sup_codigo
    LEFT JOIN public.product_cost_overrides ov ON ov.product_id = m.id AND ov.company_id = _company_id
  ),
  calc AS (
    SELECT j.*,
      (
        j.preco_custo
        + COALESCE(j.ov_emb, j.sup_emb, COALESCE(_p.embalagem_default, 0))
        + COALESCE(j.ov_transp, j.sup_transp, COALESCE(_p.transporte_default, 0))
        + CASE
            WHEN COALESCE(j.ov_taxa_op, _p.taxa_operacional_valor, 0) > 0
             AND j.preco_custo >= COALESCE(_p.taxa_operacional_min_custo, 0)
            THEN COALESCE(j.ov_taxa_op, _p.taxa_operacional_valor, 0) ELSE 0 END
      ) AS cmv_base
    FROM joined j
  ),
  calc2 AS (
    SELECT c.*, (c.cmv_base * (1 + COALESCE(_p.frete_medio_percent, 0)/100)) AS cmv_total FROM calc c
  ),
  calc3 AS (
    SELECT c.*,
      (c.cmv_total
       + c.cmv_total * COALESCE(_p.custo_fixo_percent, 0)/100
       + c.cmv_total * COALESCE(_p.devolucao_percent, 0)/100) AS custo_completo,
      COALESCE(c.store_comissao, _default_comissao, 0) AS comissao
    FROM calc2 c
  ),
  fin AS (
    SELECT c.id, c.sku, c.nome, c.preco, c.custo_completo, c.comissao,
      round(((
        c.preco
        - c.custo_completo
        - c.preco * (c.comissao + COALESCE(c.sup_devol,0) + COALESCE(c.sup_promo,0))/100
      ) / c.preco * 100)::numeric, 2) AS margem_percent
    FROM calc3 c
  )
  SELECT * FROM fin WHERE margem_percent < _threshold;

  SELECT count(*) INTO _count FROM _lm;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.margem_percent ASC), '[]'::jsonb) INTO _items
  FROM (SELECT * FROM _lm ORDER BY margem_percent ASC LIMIT _limit) x;

  RETURN jsonb_build_object('count', _count, 'threshold', _threshold, 'items', _items);
END;
$$;