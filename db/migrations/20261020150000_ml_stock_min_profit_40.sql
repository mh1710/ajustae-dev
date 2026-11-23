-- Estoque ML só conta quando (preço de venda - preço ML com frete)/preço ML >= 40%.
CREATE OR REPLACE FUNCTION public.automation_update_stock_only(_company_id uuid, _run_id uuid DEFAULT NULL::uuid, _consider_ml_stock boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  _total integer := 0;
  _found integer := 0;
  _no_supplier integer := 0;
  _stock_updated integer := 0;
  _via_ml integer := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  DROP TABLE IF EXISTS pg_temp._stock_work;
  CREATE TEMP TABLE _stock_work ON COMMIT DROP AS
  WITH mapped AS (
    SELECT p.id, p.codigo AS sku, p.nome, p.estoque AS estoque_atual,
      public.map_supplier_prefix(upper(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+'))) AS sup_codigo,
      btrim(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
  )
  SELECT m.id, m.sku, m.nome, m.estoque_atual, m.sup_codigo,
    f.id AS fornecedor_id,
    CASE
      WHEN fp.qt_estoque IS NULL THEN NULL
      WHEN COALESCE(_consider_ml_stock, true) AND EXISTS (
             SELECT 1 FROM public.ml_product_matches mm
             WHERE mm.sku = m.sku AND mm.qualifies IS TRUE AND COALESCE(mm.best_total_price, mm.best_price, 0) > 0 AND EXISTS (SELECT 1 FROM public.bling_products bp40 WHERE bp40.id = mm.product_id AND COALESCE(bp40.preco,0) >= COALESCE(mm.best_total_price, mm.best_price) * 1.4)
           )
        THEN GREATEST(
          CASE
            WHEN COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default) IS NOT NULL
              THEN LEAST(fp.qt_estoque, COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default))
            ELSE fp.qt_estoque
          END, 4)
      WHEN COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default) IS NOT NULL
        THEN LEAST(fp.qt_estoque, COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default))
      ELSE fp.qt_estoque
    END AS estoque_novo,
    (fp.qt_estoque IS NOT NULL AND COALESCE(_consider_ml_stock, true) AND EXISTS (
             SELECT 1 FROM public.ml_product_matches mm
             WHERE mm.sku = m.sku AND mm.qualifies IS TRUE AND COALESCE(mm.best_total_price, mm.best_price, 0) > 0 AND EXISTS (SELECT 1 FROM public.bling_products bp40 WHERE bp40.id = mm.product_id AND COALESCE(bp40.preco,0) >= COALESCE(mm.best_total_price, mm.best_price) * 1.4)
           ) AND (CASE
            WHEN COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default) IS NOT NULL
              THEN LEAST(fp.qt_estoque, COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default))
            ELSE fp.qt_estoque
          END) < 4) AS via_ml
  FROM mapped m
  LEFT JOIN public.fornecedores f
    ON f.codigo = m.sup_codigo AND (f.company_id IS NULL OR f.company_id = _company_id)
  LEFT JOIN public.fornecedor_produtos fp
    ON fp.fornecedor_id = f.id AND btrim(fp.codigo) = m.num_code AND m.num_code <> ''
  LEFT JOIN public.product_cost_overrides ov
    ON ov.product_id = m.id AND ov.company_id = _company_id
  LEFT JOIN public.pricing_settings ps ON ps.company_id = _company_id;

  SELECT count(*) INTO _via_ml FROM _stock_work
   WHERE fornecedor_id IS NOT NULL AND estoque_novo IS NOT NULL
     AND via_ml AND estoque_atual IS DISTINCT FROM estoque_novo;

  SELECT count(*),
         count(*) FILTER (WHERE fornecedor_id IS NOT NULL AND estoque_novo IS NOT NULL),
         count(*) FILTER (WHERE sup_codigo IS NULL OR fornecedor_id IS NULL OR estoque_novo IS NULL),
         count(*) FILTER (WHERE fornecedor_id IS NOT NULL AND estoque_novo IS NOT NULL
                          AND estoque_atual IS DISTINCT FROM estoque_novo)
    INTO _total, _found, _no_supplier, _stock_updated
  FROM _stock_work;

  IF _run_id IS NOT NULL THEN
    INSERT INTO public.automation_changes
      (run_id, company_id, product_id, sku, nome, tipo, valor_anterior, valor_novo)
    SELECT _run_id, _company_id, w.id, w.sku, w.nome,
           CASE WHEN w.via_ml THEN 'estoque_ml' ELSE 'estoque' END,
           w.estoque_atual::text, w.estoque_novo::text
    FROM _stock_work w
    WHERE w.fornecedor_id IS NOT NULL AND w.estoque_novo IS NOT NULL
      AND w.estoque_atual IS DISTINCT FROM w.estoque_novo;
  END IF;

  UPDATE public.bling_products bp
     SET estoque = w.estoque_novo,
         dirty = true,
         updated_at = now()
    FROM _stock_work w
   WHERE bp.id = w.id
     AND w.fornecedor_id IS NOT NULL
     AND w.estoque_novo IS NOT NULL
     AND bp.estoque IS DISTINCT FROM w.estoque_novo;

  RETURN jsonb_build_object(
    'total', _total,
    'estoque_via_ml', _via_ml,
    'encontrados', _found,
    'sem_fornecedor', _no_supplier,
    'estoque_atualizado', _stock_updated,
    'preco_atualizado', 0,
    'preco_e_estoque_atualizados', 0,
    'stores_updated', 0,
    'items', '[]'::jsonb
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_update_price_stock(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[], _include_stores boolean DEFAULT false, _run_id uuid DEFAULT NULL::uuid, _only_stock boolean DEFAULT false, _only_price boolean DEFAULT false, _consider_ml_stock boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  _total int := 0;
  _found int := 0;
  _not_found int := 0;
  _no_supplier int := 0;
  _price_updated int := 0;
  _stock_updated int := 0;
  _both_updated int := 0;
  _unchanged int := 0;
  _stores_updated int := 0;
  _via_ml int := 0;
  _items jsonb;
  _default_comissao numeric;
  _no_default_marketplace boolean := false;
  _pricing pricing_settings%ROWTYPE;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
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
    FROM public.marketplaces
    WHERE id = _pricing.default_marketplace_id;
  END IF;

  IF _default_comissao IS NULL THEN _no_default_marketplace := true; END IF;

  CREATE TEMP TABLE _work ON COMMIT DROP AS
  WITH prods AS (
    SELECT p.id, p.codigo AS sku, p.nome,
           p.preco AS preco_atual_venda,
           p.preco_custo AS preco_atual,
           p.estoque AS estoque_atual,
           upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix,
           btrim(substring(p.codigo from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
  ),
  mapped AS (
    SELECT pr.*,
      public.map_supplier_prefix(prefix) AS sup_codigo
    FROM prods pr
  ),
  joined AS (
    SELECT m.*,
      s.id AS sup_id, s.nome AS sup_nome,
      s.preco_embalagem AS sup_emb, s.preco_transporte AS sup_transp,
      s.taxa_devolucao AS sup_devol, s.taxa_promocao AS sup_promo,
      s.stock_cap AS sup_stock_cap,
      ov.stock_cap AS ov_stock_cap,
      fp.qt_estoque AS fp_estoque_raw,
      COALESCE(
        NULLIF((fp.precos->>'PR')::numeric, 0),
        NULLIF((fp.precos->>'base')::numeric, 0),
        NULLIF((fp.precos->>'dropshipping')::numeric, 0),
        NULLIF((fp.precos->>'crossdocking')::numeric, 0)
      ) AS fp_preco
    FROM mapped m
    LEFT JOIN public.fornecedores s
      ON s.codigo = m.sup_codigo
    LEFT JOIN public.fornecedor_produtos fp
      ON fp.fornecedor_id = s.id AND btrim(fp.codigo) = m.num_code AND m.num_code <> ''
    LEFT JOIN public.product_cost_overrides ov
      ON ov.product_id = m.id AND ov.company_id = _company_id
  ),
  capped AS (
    SELECT j.*,
      CASE
        WHEN j.fp_estoque_raw IS NULL THEN NULL
        WHEN COALESCE(_consider_ml_stock, true) AND EXISTS (
               SELECT 1 FROM public.ml_product_matches mm
               WHERE mm.sku = j.sku AND mm.qualifies IS TRUE AND COALESCE(mm.best_total_price, mm.best_price, 0) > 0 AND EXISTS (SELECT 1 FROM public.bling_products bp40 WHERE bp40.id = mm.product_id AND COALESCE(bp40.preco,0) >= COALESCE(mm.best_total_price, mm.best_price) * 1.4)
             )
          THEN GREATEST(
            CASE
              WHEN COALESCE(j.ov_stock_cap, j.sup_stock_cap, _pricing.stock_cap_default) IS NOT NULL
                THEN LEAST(j.fp_estoque_raw, COALESCE(j.ov_stock_cap, j.sup_stock_cap, _pricing.stock_cap_default))
              ELSE j.fp_estoque_raw
            END, 4)
        WHEN COALESCE(j.ov_stock_cap, j.sup_stock_cap, _pricing.stock_cap_default) IS NOT NULL
          THEN LEAST(j.fp_estoque_raw, COALESCE(j.ov_stock_cap, j.sup_stock_cap, _pricing.stock_cap_default))
        ELSE j.fp_estoque_raw
      END AS fp_estoque,
      (j.fp_estoque_raw IS NOT NULL AND COALESCE(_consider_ml_stock, true) AND EXISTS (
               SELECT 1 FROM public.ml_product_matches mm
               WHERE mm.sku = j.sku AND mm.qualifies IS TRUE AND COALESCE(mm.best_total_price, mm.best_price, 0) > 0 AND EXISTS (SELECT 1 FROM public.bling_products bp40 WHERE bp40.id = mm.product_id AND COALESCE(bp40.preco,0) >= COALESCE(mm.best_total_price, mm.best_price) * 1.4)
             ) AND (CASE
              WHEN COALESCE(j.ov_stock_cap, j.sup_stock_cap, _pricing.stock_cap_default) IS NOT NULL
                THEN LEAST(j.fp_estoque_raw, COALESCE(j.ov_stock_cap, j.sup_stock_cap, _pricing.stock_cap_default))
              ELSE j.fp_estoque_raw
            END) < 4) AS via_ml
    FROM joined j
  ),
  calc AS (
    SELECT c.*,
      (
        COALESCE(c.fp_preco, 0)
        + COALESCE(c.sup_emb, COALESCE(_pricing.embalagem_default, 0))
        + COALESCE(c.sup_transp, COALESCE(_pricing.transporte_default, 0))
        + CASE
            WHEN COALESCE(_pricing.taxa_operacional_valor, 0) > 0
             AND COALESCE(c.fp_preco, 0) >= COALESCE(_pricing.taxa_operacional_min_custo, 0)
            THEN _pricing.taxa_operacional_valor ELSE 0 END
      ) AS cmv_base
    FROM capped c
  ),
  calc2 AS (
    SELECT c.*,
      (c.cmv_base * (1 + COALESCE(_pricing.frete_medio_percent, 0)/100)) AS cmv_total
    FROM calc c
  ),
  calc3 AS (
    SELECT c.*,
      (
        c.cmv_total
        + c.cmv_total * COALESCE(_pricing.custo_fixo_percent, 0)/100
        + c.cmv_total * COALESCE(_pricing.devolucao_percent, 0)/100
      ) AS custo_completo
    FROM calc2 c
  ),
  priced AS (
    SELECT c.*,
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
      END AS preco_novo_venda
    FROM calc3 c
  )
  SELECT * FROM priced;

  SELECT count(*) INTO _total FROM _work;

  UPDATE public.bling_products bp SET
    preco_custo = CASE
      WHEN NOT _only_stock AND w.fp_preco IS NOT NULL AND (bp.preco_custo IS DISTINCT FROM w.fp_preco)
      THEN w.fp_preco ELSE bp.preco_custo END,
    preco_compra = CASE
      WHEN NOT _only_stock AND w.fp_preco IS NOT NULL AND (bp.preco_compra IS DISTINCT FROM w.fp_preco)
      THEN w.fp_preco ELSE bp.preco_compra END,
    estoque = CASE
      WHEN NOT _only_price AND w.fp_estoque IS NOT NULL AND (bp.estoque IS DISTINCT FROM w.fp_estoque)
      THEN w.fp_estoque ELSE bp.estoque END,
    preco = CASE
      WHEN NOT _only_stock AND w.preco_novo_venda IS NOT NULL AND (bp.preco IS DISTINCT FROM w.preco_novo_venda)
      THEN w.preco_novo_venda ELSE bp.preco END,
    dirty = CASE
      WHEN (NOT _only_stock AND w.fp_preco IS NOT NULL AND bp.preco_custo IS DISTINCT FROM w.fp_preco)
        OR (NOT _only_price AND w.fp_estoque IS NOT NULL AND bp.estoque IS DISTINCT FROM w.fp_estoque)
        OR (NOT _only_stock AND w.preco_novo_venda IS NOT NULL AND bp.preco IS DISTINCT FROM w.preco_novo_venda)
      THEN true ELSE bp.dirty END,
    updated_at = now()
  FROM _work w
  WHERE bp.id = w.id
    AND w.sup_id IS NOT NULL
    AND w.fp_estoque IS NOT NULL;

  IF _run_id IS NOT NULL AND NOT _only_stock THEN
    INSERT INTO public.automation_changes
      (run_id, company_id, product_id, sku, nome, tipo, valor_anterior, valor_novo)
    SELECT _run_id, _company_id, w.id, w.sku, w.nome, 'preco_custo',
           w.preco_atual::text, w.fp_preco::text
    FROM _work w
    WHERE w.sup_id IS NOT NULL AND w.fp_estoque IS NOT NULL
      AND w.fp_preco IS NOT NULL AND w.preco_atual IS DISTINCT FROM w.fp_preco;

    INSERT INTO public.automation_changes
      (run_id, company_id, product_id, sku, nome, tipo, valor_anterior, valor_novo)
    SELECT _run_id, _company_id, w.id, w.sku, w.nome, 'preco_venda',
           w.preco_atual_venda::text, w.preco_novo_venda::text
    FROM _work w
    WHERE w.sup_id IS NOT NULL AND w.fp_estoque IS NOT NULL
      AND w.preco_novo_venda IS NOT NULL AND w.preco_atual_venda IS DISTINCT FROM w.preco_novo_venda;

  END IF;

  IF _run_id IS NOT NULL AND NOT _only_price THEN
    INSERT INTO public.automation_changes
      (run_id, company_id, product_id, sku, nome, tipo, valor_anterior, valor_novo)
    SELECT _run_id, _company_id, w.id, w.sku, w.nome,
           CASE WHEN w.via_ml THEN 'estoque_ml' ELSE 'estoque' END,
           w.estoque_atual::text, w.fp_estoque::text
    FROM _work w
    WHERE w.sup_id IS NOT NULL AND w.fp_estoque IS NOT NULL
      AND w.estoque_atual IS DISTINCT FROM w.fp_estoque;
  END IF;

  IF _include_stores THEN
    WITH s AS (
      SELECT bps.id AS store_row_id, bps.internal_product_id, bps.current_price AS preco_antigo,
             bps.bling_store_id, COALESCE(bs.descricao, bps.store_name) AS loja_nome,
             bs.marketplace_id, m.taxa_percent
      FROM public.bling_product_stores bps
      JOIN public.bling_stores bs ON bs.bling_store_id = bps.bling_store_id AND bs.company_id = bps.company_id
      LEFT JOIN public.marketplaces m ON m.id = bs.marketplace_id
      WHERE bps.company_id = _company_id
        AND bps.internal_product_id IN (SELECT id FROM _work WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL)
    ),
    calc_store AS (
      SELECT s.store_row_id, s.internal_product_id, s.preco_antigo, s.bling_store_id, s.loja_nome,
        w.sku, w.nome, COALESCE(w.sup_promo, 0) AS sup_promo,
        public._apply_price_anchor(
          public._compute_sale_price(
            w.custo_completo,
            COALESCE(s.taxa_percent, _default_comissao, 0),
            COALESCE(w.sup_devol, 0),
            COALESCE(w.sup_promo, 0),
            COALESCE(_pricing.profit_bands, '[]'::jsonb)
          ),
          COALESCE(_pricing.price_anchors, '[]'::jsonb)
        ) AS preco_novo_loja
      FROM s
      JOIN _work w ON w.id = s.internal_product_id
      WHERE w.fp_preco IS NOT NULL AND w.fp_preco > 0
    ),
    calc_store2 AS (
      SELECT cs.*,
        CASE WHEN cs.preco_novo_loja IS NULL THEN NULL
             ELSE round((cs.preco_novo_loja * (1 - COALESCE(cs.sup_promo, 0)/100))::numeric, 2)
        END AS preco_promo_loja
      FROM calc_store cs
    ),
    log AS (
      INSERT INTO public.automation_changes
        (run_id, company_id, product_id, sku, nome, tipo, loja_id, loja_nome, valor_anterior, valor_novo)
      SELECT _run_id, _company_id, cs.internal_product_id, cs.sku, cs.nome, 'preco_loja',
             cs.bling_store_id, cs.loja_nome, cs.preco_antigo::text, cs.preco_novo_loja::text
      FROM calc_store2 cs
      WHERE _run_id IS NOT NULL
        AND cs.preco_novo_loja IS NOT NULL
        AND cs.preco_antigo IS DISTINCT FROM cs.preco_novo_loja
      RETURNING 1
    ),
    upd_stores AS (
      UPDATE public.bling_product_stores bps SET
        current_price = cs.preco_novo_loja,
        current_promotional_price = cs.preco_promo_loja,
        updated_at = now()
      FROM calc_store2 cs
      WHERE bps.id = cs.store_row_id
        AND cs.preco_novo_loja IS NOT NULL
        AND (bps.current_price IS DISTINCT FROM cs.preco_novo_loja
             OR bps.current_promotional_price IS DISTINCT FROM cs.preco_promo_loja)
      RETURNING 1
    )
    SELECT count(*) INTO _stores_updated FROM upd_stores;
  END IF;

  SELECT
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL),
    count(*) FILTER (WHERE sup_codigo IS NOT NULL AND (sup_id IS NULL OR fp_estoque IS NULL)),
    count(*) FILTER (WHERE sup_codigo IS NULL),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND ((fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco) OR (preco_novo_venda IS NOT NULL AND preco_atual_venda IS DISTINCT FROM preco_novo_venda))
        AND (estoque_atual IS NOT DISTINCT FROM fp_estoque)),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND estoque_atual IS DISTINCT FROM fp_estoque
        AND ((fp_preco IS NULL OR preco_atual IS NOT DISTINCT FROM fp_preco) AND (preco_novo_venda IS NULL OR preco_atual_venda IS NOT DISTINCT FROM preco_novo_venda))),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND ((fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco) OR (preco_novo_venda IS NOT NULL AND preco_atual_venda IS DISTINCT FROM preco_novo_venda))
        AND estoque_atual IS DISTINCT FROM fp_estoque),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND ((fp_preco IS NULL OR preco_atual IS NOT DISTINCT FROM fp_preco) AND (preco_novo_venda IS NULL OR preco_atual_venda IS NOT DISTINCT FROM preco_novo_venda))
        AND estoque_atual IS NOT DISTINCT FROM fp_estoque)
  INTO _found, _not_found, _no_supplier, _price_updated, _stock_updated, _both_updated, _unchanged
  FROM _work;

  IF _only_price THEN
    _price_updated := _price_updated + _both_updated;
    _unchanged := _unchanged + _stock_updated;
    _stock_updated := 0;
    _both_updated := 0;
  END IF;

  IF _only_stock THEN
    _stock_updated := _stock_updated + _both_updated;
    _unchanged := _unchanged + _price_updated;
    _price_updated := 0;
    _both_updated := 0;
  END IF;

  SELECT count(*) INTO _via_ml FROM _work
   WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
     AND via_ml AND estoque_atual IS DISTINCT FROM fp_estoque;

  SELECT jsonb_agg(row_to_json(t)) INTO _items FROM (
    SELECT
      sku, nome, sup_codigo AS fornecedor,
      CASE
        WHEN sup_codigo IS NULL THEN 'sem_fornecedor'
        WHEN sup_id IS NULL OR fp_estoque IS NULL THEN 'nao_encontrado'
        WHEN ((fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco) OR (preco_novo_venda IS NOT NULL AND preco_atual_venda IS DISTINCT FROM preco_novo_venda))
          AND estoque_atual IS DISTINCT FROM fp_estoque THEN 'preco_e_estoque_atualizados'
        WHEN ((fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco) OR (preco_novo_venda IS NOT NULL AND preco_atual_venda IS DISTINCT FROM preco_novo_venda)) THEN 'preco_atualizado'
        WHEN estoque_atual IS DISTINCT FROM fp_estoque THEN 'estoque_atualizado'
        ELSE 'inalterado'
      END AS status,
      preco_atual, fp_preco AS preco_novo,
      estoque_atual, fp_estoque AS estoque_novo,
      CASE WHEN via_ml THEN 'mercado_livre' ELSE 'fornecedor' END AS estoque_origem,
      preco_atual_venda, preco_novo_venda
    FROM _work
    ORDER BY sku
    -- execuções agendadas não precisam da lista completa (evita JSON gigante)
    LIMIT CASE WHEN _run_id IS NOT NULL THEN 200 ELSE 1000000 END
  ) t;

  RETURN jsonb_build_object(
    'total', _total,
    'encontrados', _found,
    'nao_encontrados', _not_found,
    'sem_fornecedor', _no_supplier,
    'preco_atualizado', _price_updated,
    'estoque_atualizado', _stock_updated,
    'estoque_via_ml', _via_ml,
    'preco_e_estoque_atualizados', _both_updated,
    'inalterados', _unchanged,
    'stores_updated', COALESCE(_stores_updated, 0),
    'no_default_marketplace', _no_default_marketplace,
    'items', COALESCE(_items, '[]'::jsonb)
  );
END;
$function$
;

UPDATE public.fornecedores SET stock_cap = 20;
UPDATE public.pricing_settings SET stock_cap_default = 20;
