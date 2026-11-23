-- Preserve shared marketplace identities while isolating commission settings.
BEGIN;
CREATE TABLE public.company_marketplace_fees (
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 marketplace_id uuid NOT NULL REFERENCES public.marketplaces(id) ON DELETE CASCADE,
 taxa_percent numeric(6,3) NOT NULL CHECK (taxa_percent BETWEEN 0 AND 100),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id, marketplace_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_marketplace_fees TO authenticated;
GRANT ALL ON public.company_marketplace_fees TO service_role;
ALTER TABLE public.company_marketplace_fees ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_fees_read ON public.company_marketplace_fees FOR SELECT TO authenticated
 USING (app_private.is_company_member(company_id, auth.uid()));
CREATE POLICY company_fees_write ON public.company_marketplace_fees FOR ALL TO authenticated
 USING (app_private.is_company_member(company_id, auth.uid()) AND NOT public.is_company_restricted())
 WITH CHECK (app_private.is_company_member(company_id, auth.uid()) AND NOT public.is_company_restricted());
-- Snapshot current rates: rollout changes neither prices nor historical orders.
INSERT INTO public.company_marketplace_fees(company_id, marketplace_id, taxa_percent)
 SELECT c.id, m.id, m.taxa_percent FROM public.companies c CROSS JOIN public.marketplaces m;

CREATE OR REPLACE FUNCTION public.company_marketplace_fee(_company_id uuid, _marketplace_id uuid)
 RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
 SELECT COALESCE(f.taxa_percent, m.taxa_percent)
 FROM public.marketplaces m LEFT JOIN public.company_marketplace_fees f
 ON f.marketplace_id = m.id AND f.company_id = _company_id WHERE m.id = _marketplace_id
$$;
REVOKE ALL ON FUNCTION public.company_marketplace_fee(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_marketplace_fee(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_company_marketplace(_company_id uuid, _marketplace_id uuid, _nome text, _taxa_percent numeric)
 RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE _id uuid := _marketplace_id;
BEGIN
 IF NOT app_private.is_company_member(_company_id, auth.uid()) OR public.is_company_restricted() THEN
   RAISE EXCEPTION 'Sem permissão para alterar as taxas desta empresa.';
 END IF;
 IF _taxa_percent IS NULL OR _taxa_percent < 0 OR _taxa_percent > 100 THEN
   RAISE EXCEPTION 'Taxa deve estar entre 0 e 100.';
 END IF;
 IF _id IS NULL THEN
   IF NULLIF(btrim(_nome), '') IS NULL THEN RAISE EXCEPTION 'Nome obrigatório.'; END IF;
   INSERT INTO public.marketplaces(nome, taxa_percent) VALUES (btrim(_nome), 0) RETURNING id INTO _id;
 END IF;
 INSERT INTO public.company_marketplace_fees(company_id, marketplace_id, taxa_percent)
 VALUES (_company_id, _id, _taxa_percent)
 ON CONFLICT(company_id, marketplace_id) DO UPDATE SET taxa_percent = EXCLUDED.taxa_percent, updated_at = now();
 RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.save_company_marketplace(uuid, uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_company_marketplace(uuid, uuid, text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_price_policy(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 100)
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
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT * INTO _pricing FROM public.pricing_settings WHERE company_id = _company_id;

  SELECT public.company_marketplace_fee(_company_id, m.id) INTO _default_comissao
  FROM public.bling_stores bs
  JOIN public.marketplaces m ON m.id = bs.marketplace_id
  WHERE bs.company_id = _company_id AND bs.is_default = true
  LIMIT 1;

  IF _default_comissao IS NULL AND _pricing.default_marketplace_id IS NOT NULL THEN
    SELECT public.company_marketplace_fee(_company_id, id) INTO _default_comissao
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
    SELECT pr.*, public.map_supplier_prefix(prefix) AS sup_codigo
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

CREATE OR REPLACE FUNCTION public.enqueue_bling_link_store(_company_id uuid, _product_ids uuid[], _bling_store_id text, _action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  _integration_id uuid;
  _pricing pricing_settings%ROWTYPE;
  _store_comissao numeric;
  _enqueued int := 0;
  _skipped int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  IF _action NOT IN ('link','unlink') THEN
    RAISE EXCEPTION 'invalid action';
  END IF;

  SELECT id INTO _integration_id
  FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada'
  LIMIT 1;

  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada.';
  END IF;

  IF _action = 'unlink' THEN
    WITH src AS (
      SELECT p.id AS product_id, p.bling_product_id, bps.bling_product_store_id
      FROM public.bling_products p
      JOIN public.bling_product_stores bps
        ON bps.internal_product_id = p.id
       AND bps.company_id = p.company_id
      WHERE p.company_id = _company_id
        AND p.id = ANY(_product_ids)
        AND bps.bling_store_id = _bling_store_id
        AND bps.bling_product_store_id IS NOT NULL
        AND btrim(bps.bling_product_store_id) <> ''
        AND p.bling_product_id IS NOT NULL
        AND btrim(p.bling_product_id) <> ''
    ), del AS (
      DELETE FROM public.bling_push_queue q
      USING src s
      WHERE q.integration_id = _integration_id
        AND q.product_id = s.product_id
        AND q.tipo = 'desvincular_loja'
        AND q.bling_product_store_id = s.bling_product_store_id
        AND q.status IN ('pendente','processando')
      RETURNING 1
    ), ins AS (
      INSERT INTO public.bling_push_queue
        (company_id, integration_id, product_id, bling_product_id, bling_product_store_id,
         tipo, valor_novo, payload, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, s.product_id, s.bling_product_id, s.bling_product_store_id,
             'desvincular_loja', 0,
             jsonb_build_object('bling_store_id', _bling_store_id),
             'pendente', now()
      FROM src s
      RETURNING 1
    )
    SELECT count(*) INTO _enqueued FROM ins;

    RETURN jsonb_build_object(
      'integration_id', _integration_id,
      'action', _action,
      'bling_store_id', _bling_store_id,
      'enqueued', _enqueued,
      'skipped', 0
    );
  END IF;

  SELECT * INTO _pricing
  FROM public.pricing_settings
  WHERE company_id = _company_id;

  SELECT public.company_marketplace_fee(_company_id, m.id) INTO _store_comissao
  FROM public.bling_stores bs
  LEFT JOIN public.marketplaces m ON m.id = bs.marketplace_id
  WHERE bs.company_id = _company_id
    AND bs.bling_store_id = _bling_store_id
  LIMIT 1;

  CREATE TEMP TABLE _work ON COMMIT DROP AS
  WITH prods AS (
    SELECT p.id, p.codigo, p.bling_product_id,
           upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix,
           btrim(substring(p.codigo from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND p.id = ANY(_product_ids)
      AND p.bling_product_id IS NOT NULL
      AND btrim(p.bling_product_id) <> ''
  ), mapped AS (
    SELECT pr.*,
      public.map_supplier_prefix(prefix) AS sup_codigo
    FROM prods pr
  ), joined AS (
    SELECT m.*,
      s.id AS sup_id,
      s.preco_embalagem AS sup_emb,
      s.preco_transporte AS sup_transp,
      s.taxa_devolucao AS sup_devol,
      s.taxa_promocao AS sup_promo,
      COALESCE(
        NULLIF((fp.precos->>'PR')::numeric, 0),
        NULLIF((fp.precos->>'base')::numeric, 0),
        NULLIF((fp.precos->>'dropshipping')::numeric, 0),
        NULLIF((fp.precos->>'crossdocking')::numeric, 0)
      ) AS fp_preco,
      ov.embalagem AS ov_emb,
      ov.transporte AS ov_transp,
      ov.taxa_operacional AS ov_taxa_op
    FROM mapped m
    LEFT JOIN public.fornecedores s ON s.codigo = m.sup_codigo
    LEFT JOIN public.fornecedor_produtos fp
      ON fp.fornecedor_id = s.id
     AND btrim(fp.codigo) = m.num_code
     AND m.num_code <> ''
    LEFT JOIN public.product_cost_overrides ov
      ON ov.product_id = m.id
     AND ov.company_id = _company_id
  ), calc AS (
    SELECT j.*,
      (
        COALESCE(j.fp_preco, 0)
        + COALESCE(j.ov_emb, j.sup_emb, COALESCE(_pricing.embalagem_default, 0))
        + COALESCE(j.ov_transp, j.sup_transp, COALESCE(_pricing.transporte_default, 0))
        + CASE
            WHEN COALESCE(j.ov_taxa_op, _pricing.taxa_operacional_valor, 0) > 0
             AND COALESCE(j.fp_preco, 0) >= COALESCE(_pricing.taxa_operacional_min_custo, 0)
            THEN COALESCE(j.ov_taxa_op, _pricing.taxa_operacional_valor)
            ELSE 0
          END
      ) AS cmv_base
    FROM joined j
  ), calc2 AS (
    SELECT c.*, (c.cmv_base * (1 + COALESCE(_pricing.frete_medio_percent, 0)/100)) AS cmv_total
    FROM calc c
  ), calc3 AS (
    SELECT c.*,
      (c.cmv_total
       + c.cmv_total * COALESCE(_pricing.custo_fixo_percent, 0)/100
       + c.cmv_total * COALESCE(_pricing.devolucao_percent, 0)/100
      ) AS custo_completo
    FROM calc2 c
  ), priced AS (
    SELECT c.*,
      CASE
        WHEN c.sup_id IS NULL THEN NULL
        WHEN c.fp_preco IS NULL OR c.fp_preco <= 0 THEN NULL
        WHEN _store_comissao IS NULL THEN NULL
        ELSE public._apply_price_anchor(
          public._compute_sale_price(
            c.custo_completo,
            COALESCE(_store_comissao, 0),
            COALESCE(c.sup_devol, 0),
            COALESCE(c.sup_promo, 0),
            COALESCE(_pricing.profit_bands, '[]'::jsonb)
          ),
          COALESCE(_pricing.price_anchors, '[]'::jsonb)
        )
      END AS preco_venda
    FROM calc3 c
  )
  SELECT id,
         codigo,
         bling_product_id,
         sup_promo,
         preco_venda,
         CASE
           WHEN preco_venda IS NULL THEN NULL
           ELSE round((preco_venda * (1 - COALESCE(sup_promo, 0)/100))::numeric, 2)
         END AS preco_promo
  FROM priced;

  DELETE FROM public.bling_push_queue q
  USING _work w
  WHERE q.integration_id = _integration_id
    AND q.product_id = w.id
    AND q.tipo = 'vincular_loja'
    AND q.bling_product_store_id = _bling_store_id
    AND q.status IN ('pendente','processando');

  WITH ins AS (
    INSERT INTO public.bling_push_queue
      (company_id, integration_id, product_id, bling_product_id, bling_product_store_id,
       tipo, valor_novo, payload, status, proxima_tentativa_em)
    SELECT _company_id, _integration_id, w.id, w.bling_product_id, _bling_store_id,
           'vincular_loja', COALESCE(w.preco_venda, 0),
           jsonb_build_object(
             'bling_store_id', _bling_store_id,
             'preco', w.preco_venda,
             'preco_promocional', w.preco_promo,
             'codigo', w.codigo
           ),
           'pendente', now()
    FROM _work w
    WHERE w.preco_venda IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO _enqueued FROM ins;

  SELECT count(*) INTO _skipped
  FROM _work
  WHERE preco_venda IS NULL;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'action', _action,
    'bling_store_id', _bling_store_id,
    'store_comissao', _store_comissao,
    'enqueued', _enqueued,
    'skipped', _skipped
  );
END;
$function$;

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
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT * INTO _p FROM public.pricing_settings WHERE company_id = _company_id;

  SELECT public.company_marketplace_fee(_company_id, m.id) INTO _default_comissao
  FROM public.bling_stores bs
  JOIN public.marketplaces m ON m.id = bs.marketplace_id
  WHERE bs.company_id = _company_id AND bs.is_default = true
  LIMIT 1;

  IF _default_comissao IS NULL AND _p.default_marketplace_id IS NOT NULL THEN
    SELECT public.company_marketplace_fee(_company_id, id) INTO _default_comissao FROM public.marketplaces WHERE id = _p.default_marketplace_id;
  END IF;

  WITH prods AS (
    SELECT p.id, p.codigo AS sku, p.nome, p.preco, p.preco_custo,
           upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND p.preco_custo IS NOT NULL AND p.preco_custo > 0
  ),
  mapped AS (
    SELECT pr.*, public.map_supplier_prefix(prefix) AS sup_codigo
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
           COALESCE(public.company_marketplace_fee(_company_id, mk.id), _default_comissao, 0) AS comissao
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

CREATE OR REPLACE FUNCTION public.pricing_policy_status(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  SELECT public.company_marketplace_fee(_company_id, m.id) INTO _comissao
  FROM public.bling_stores bs
  JOIN public.marketplaces m ON m.id = bs.marketplace_id
  WHERE bs.company_id = _company_id AND bs.is_default = true
  LIMIT 1;

  IF _comissao IS NULL AND _p.default_marketplace_id IS NOT NULL THEN
    SELECT public.company_marketplace_fee(_company_id, id) INTO _comissao FROM public.marketplaces WHERE id = _p.default_marketplace_id;
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
$function$;

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

  SELECT public.company_marketplace_fee(_company_id, m.id) INTO _default_comissao
  FROM public.bling_stores bs
  JOIN public.marketplaces m ON m.id = bs.marketplace_id
  WHERE bs.company_id = _company_id AND bs.is_default = true
  LIMIT 1;

  IF _default_comissao IS NULL AND _pricing.default_marketplace_id IS NOT NULL THEN
    SELECT public.company_marketplace_fee(_company_id, id) INTO _default_comissao
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
             bs.marketplace_id, public.company_marketplace_fee(_company_id, m.id) AS taxa_percent
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
$function$;


NOTIFY pgrst, 'reload schema';
COMMIT;
