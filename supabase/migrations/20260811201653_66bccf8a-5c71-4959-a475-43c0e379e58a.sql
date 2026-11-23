CREATE OR REPLACE FUNCTION public.low_margin_products(_company_id uuid, _threshold numeric DEFAULT 20, _limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  WITH prods AS (
    SELECT p.id, p.codigo AS sku, p.nome, p.preco, p.preco_custo,
           upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix
    FROM public.bling_products p
    WHERE p.company_id = _company_id
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
           ov.embalagem AS ov_emb, ov.transporte AS ov_transp, ov.taxa_operacional AS ov_taxa_op
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
       + c.cmv_total * COALESCE(_p.devolucao_percent, 0)/100) AS custo_completo
    FROM calc2 c
  ),
  -- uma linha por produto x loja vinculada
  per_store AS (
    SELECT c.id, c.sku, c.nome, c.custo_completo, c.sup_devol, c.sup_promo,
           bps.bling_store_id AS loja_id,
           COALESCE(bs2.nome_loja, bps.store_name, 'Loja ' || bps.bling_store_id) AS loja_nome,
           mk.nome AS marketplace_nome,
           COALESCE(bps.current_promotional_price, bps.current_price, c.preco) AS preco,
           COALESCE(mk.taxa_percent, _default_comissao, 0) AS comissao
    FROM calc3 c
    JOIN public.bling_product_stores bps
      ON bps.internal_product_id = c.id AND bps.company_id = _company_id
     AND COALESCE(bps.is_linked, true) = true
    LEFT JOIN public.bling_stores bs2
      ON bs2.bling_store_id = bps.bling_store_id AND bs2.company_id = _company_id
    LEFT JOIN public.marketplaces mk ON mk.id = bs2.marketplace_id
  ),
  no_store AS (
    SELECT c.id, c.sku, c.nome, c.custo_completo, c.sup_devol, c.sup_promo,
           NULL::text AS loja_id, NULL::text AS loja_nome, NULL::text AS marketplace_nome,
           c.preco, COALESCE(_default_comissao, 0) AS comissao
    FROM calc3 c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bling_product_stores bps
      WHERE bps.internal_product_id = c.id AND bps.company_id = _company_id
        AND COALESCE(bps.is_linked, true) = true
    )
  ),
  rows_all AS (
    SELECT * FROM per_store UNION ALL SELECT * FROM no_store
  ),
  fin AS (
    SELECT r.id, r.sku, r.nome, r.loja_id, r.loja_nome, r.marketplace_nome,
           r.preco, r.custo_completo, r.comissao,
      round(((
        r.preco
        - r.custo_completo
        - r.preco * (r.comissao + COALESCE(r.sup_devol,0) + COALESCE(r.sup_promo,0))/100
      ) / NULLIF(r.preco,0) * 100)::numeric, 2) AS margem_percent
    FROM rows_all r
    WHERE r.preco IS NOT NULL AND r.preco > 0
  ),
  low AS (
    SELECT * FROM fin WHERE margem_percent < _threshold
  )
  SELECT (SELECT count(*) FROM low),
         COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.margem_percent ASC)
                     FROM (SELECT * FROM low ORDER BY margem_percent ASC LIMIT _limit) x), '[]'::jsonb)
  INTO _count, _items;

  RETURN jsonb_build_object('count', _count, 'threshold', _threshold, 'items', _items);
END;
$function$;