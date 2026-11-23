-- Mapa central de prefixos de SKU → fornecedor.
-- Fonte única usada por: precificação, auditoria, automações de estoque e envios ao Bling.

CREATE TABLE IF NOT EXISTS public.supplier_prefix_map (
  prefix text PRIMARY KEY,
  supplier_codigo text NOT NULL REFERENCES public.fornecedores(codigo) ON UPDATE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.supplier_prefix_map TO authenticated;
GRANT SELECT ON public.supplier_prefix_map TO anon;
GRANT ALL ON public.supplier_prefix_map TO service_role;

ALTER TABLE public.supplier_prefix_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Qualquer um pode ler o mapa de prefixos" ON public.supplier_prefix_map;
CREATE POLICY "Qualquer um pode ler o mapa de prefixos"
  ON public.supplier_prefix_map FOR SELECT TO authenticated, anon USING (true);

INSERT INTO public.supplier_prefix_map (prefix, supplier_codigo) VALUES
  ('ODS', 'oderco'), ('ODR', 'oderco'), ('O', 'oderco'),
  ('HX', 'hayamax'), ('HAY', 'hayamax'), ('HA', 'hayamax'),
  ('EVS', 'evolusom'), ('EV', 'evolusom'), ('E', 'evolusom')
ON CONFLICT (prefix) DO UPDATE SET supplier_codigo = EXCLUDED.supplier_codigo;

-- Lookup pelo prefixo (maiúsculas). NULL quando não mapeado.
CREATE OR REPLACE FUNCTION public.map_supplier_prefix(p_prefix text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.supplier_codigo
  FROM public.supplier_prefix_map m
  WHERE m.prefix = upper(btrim(coalesce(p_prefix, '')))
  LIMIT 1
$$;

-- Atalho: extrai o prefixo do SKU e resolve o fornecedor.
CREATE OR REPLACE FUNCTION public.map_sku_prefix(p_sku text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.map_supplier_prefix(upper(substring(btrim(coalesce(p_sku, '')) from '^[A-Za-z]+')))
$$;

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

CREATE OR REPLACE FUNCTION public.automation_apply_supplier_status(_company_id uuid, _run_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  _inact uuid[] := '{}';
  _act uuid[] := '{}';
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  CREATE TEMP TABLE _tmp_status ON COMMIT DROP AS
  WITH alvo AS (
    SELECT p.id, p.situacao,
           upper(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+')) AS prefix,
           btrim(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
  ),
  mapped AS (
    SELECT a.*, public.map_supplier_prefix(a.prefix) AS sup_codigo
    FROM alvo a
  )
  SELECT m.id,
         upper(btrim(coalesce(m.situacao, ''))) AS sit,
         fp.id IS NOT NULL AS tem_fornecedor,
         COALESCE(fp.qt_estoque, 0) AS qt_estoque
  FROM mapped m
  LEFT JOIN public.fornecedores f ON f.codigo = m.sup_codigo
    AND (f.company_id IS NULL OR f.company_id = _company_id)
  LEFT JOIN public.fornecedor_produtos fp ON fp.fornecedor_id = f.id
    AND btrim(fp.codigo) = m.num_code;

  WITH upd AS (
    UPDATE public.bling_products bp
    SET situacao = 'I', dirty = true, updated_at = now()
    FROM _tmp_status t
    WHERE bp.id = t.id
      AND t.tem_fornecedor = false
      AND t.sit NOT IN ('I', 'INATIVO')
    RETURNING bp.id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO _inact FROM upd;

  WITH upd2 AS (
    UPDATE public.bling_products bp
    SET situacao = 'A', dirty = true, updated_at = now()
    FROM _tmp_status t
    WHERE bp.id = t.id
      AND t.tem_fornecedor = true
      AND t.qt_estoque > 0
      AND t.sit NOT IN ('A', 'ATIVO')
    RETURNING bp.id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO _act FROM upd2;

  IF _run_id IS NOT NULL THEN
    INSERT INTO public.automation_changes
      (run_id, company_id, product_id, sku, nome, tipo, valor_anterior, valor_novo)
    SELECT _run_id, _company_id, p.id, p.codigo, p.nome, 'inativado', 'Ativo', 'Inativo'
    FROM public.bling_products p WHERE p.id = ANY(_inact);

    INSERT INTO public.automation_changes
      (run_id, company_id, product_id, sku, nome, tipo, valor_anterior, valor_novo)
    SELECT _run_id, _company_id, p.id, p.codigo, p.nome, 'ativado', 'Inativo', 'Ativo'
    FROM public.bling_products p WHERE p.id = ANY(_act);
  END IF;

  RETURN jsonb_build_object(
    'inactivated', COALESCE(array_length(_inact, 1), 0),
    'activated', COALESCE(array_length(_act, 1), 0),
    'inactivate_ids', to_jsonb(_inact),
    'activate_ids', to_jsonb(_act)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.automation_update_stock_only(_company_id uuid, _run_id uuid DEFAULT NULL::uuid)
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
BEGIN
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
      WHEN COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default) IS NOT NULL
        THEN LEAST(fp.qt_estoque, COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default))
      ELSE fp.qt_estoque
    END AS estoque_novo
  FROM mapped m
  LEFT JOIN public.fornecedores f
    ON f.codigo = m.sup_codigo AND (f.company_id IS NULL OR f.company_id = _company_id)
  LEFT JOIN public.fornecedor_produtos fp
    ON fp.fornecedor_id = f.id AND btrim(fp.codigo) = m.num_code AND m.num_code <> ''
  LEFT JOIN public.product_cost_overrides ov
    ON ov.product_id = m.id AND ov.company_id = _company_id
  LEFT JOIN public.pricing_settings ps ON ps.company_id = _company_id;

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
    SELECT _run_id, _company_id, w.id, w.sku, w.nome, 'estoque',
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
    'encontrados', _found,
    'sem_fornecedor', _no_supplier,
    'estoque_atualizado', _stock_updated,
    'preco_atualizado', 0,
    'preco_e_estoque_atualizados', 0,
    'stores_updated', 0,
    'items', '[]'::jsonb
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

  SELECT m.taxa_percent INTO _store_comissao
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

CREATE OR REPLACE FUNCTION public.enqueue_bling_push(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[], _scope text DEFAULT 'ambos'::text, _include_stores boolean DEFAULT false, _only_changed boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  _integration_id uuid;
  _default_dep text;
  _created_preco int := 0;
  _created_estoque int := 0;
  _created_produto int := 0;
  _created_criar int := 0;
  _created_lojas int := 0;
  _updated_existing int := 0;
  _skipped_sem_bling int := 0;
  _skipped_sem_dep int := 0;
  _skipped_sem_mudanca int := 0;
  _tipos text[];
  _enq_at timestamptz := now();
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT id, default_deposito_id INTO _integration_id, _default_dep
  FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada'
  LIMIT 1;

  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada para esta empresa.';
  END IF;

  -- Limpa APENAS os tipos que esta chamada vai reenfileirar; nunca mexe em
  -- itens de outras transformações (ex.: codigo_loja, inativar, excluir).
  _tipos := CASE
    WHEN _scope = 'criar' THEN ARRAY['criar']
    WHEN _scope = 'todos' THEN ARRAY['criar','produto']
    WHEN _scope = 'preco' THEN ARRAY['preco']
    WHEN _scope = 'estoque' THEN ARRAY['estoque']
    ELSE ARRAY['preco','estoque']
  END;
  IF _include_stores AND _scope IN ('preco','ambos','todos') THEN
    _tipos := _tipos || ARRAY['preco_loja'];
  END IF;

  DELETE FROM public.bling_push_queue
  WHERE company_id = _company_id AND tipo = ANY(_tipos);

  -- Se já existir outra transformação na fila, esta entra no FINAL dela.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.bling_push_queue
    WHERE company_id = _company_id
      AND status IN ('pendente','processando')
      AND NOT (tipo = ANY(_tipos))
  ) THEN now() + interval '1 second' ELSE now() END
  INTO _enq_at;

  CREATE TEMP TABLE _pending ON COMMIT DROP AS
  SELECT p.id AS product_id,
         p.bling_product_id,
         COALESCE(p.bling_deposit_id, _default_dep) AS bling_deposit_id,
         p.preco,
         p.estoque,
         p.ultimo_preco_sincronizado,
         p.ultimo_estoque_sincronizado
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids));

  IF _scope = 'criar' THEN
    WITH ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, NULL, p.bling_deposit_id,
             'criar', NULL, COALESCE(p.preco, 0), 'pendente', _enq_at
      FROM _pending p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          valor_novo = EXCLUDED.valor_novo,
          proxima_tentativa_em = now(),
          tentativas = 0, erro = NULL, status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
      INTO _created_criar, _updated_existing FROM ins;

    RETURN jsonb_build_object(
      'integration_id', _integration_id,
      'created_preco', 0, 'created_estoque', 0, 'created_produto', 0,
      'created_criar', _created_criar, 'created_lojas', 0,
      'updated_existing', _updated_existing,
      'skipped_sem_bling_id', 0, 'skipped_sem_deposito', 0,
      'skipped_sem_mudanca', 0
    );
  END IF;

  CREATE TEMP TABLE _pending_no_id ON COMMIT DROP AS
  SELECT * FROM _pending WHERE bling_product_id IS NULL OR btrim(bling_product_id) = '';

  DELETE FROM _pending WHERE bling_product_id IS NULL OR btrim(bling_product_id) = '';

  IF _scope = 'todos' THEN
    WITH ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, NULL, p.bling_deposit_id,
             'criar', NULL, COALESCE(p.preco, 0), 'pendente', _enq_at
      FROM _pending_no_id p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          valor_novo = EXCLUDED.valor_novo,
          proxima_tentativa_em = now(),
          tentativas = 0, erro = NULL, status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
      INTO _created_criar, _updated_existing FROM ins;

    WITH ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, p.bling_deposit_id,
             'produto', p.ultimo_preco_sincronizado, COALESCE(p.preco, 0), 'pendente', _enq_at
      FROM _pending p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          valor_novo = EXCLUDED.valor_novo,
          valor_anterior = EXCLUDED.valor_anterior,
          proxima_tentativa_em = now(),
          tentativas = 0, erro = NULL, status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), _updated_existing + count(*) FILTER (WHERE NOT inserted)
      INTO _created_produto, _updated_existing FROM ins;
  ELSE
    SELECT count(*) INTO _skipped_sem_bling FROM _pending_no_id;
  END IF;

  IF _scope = 'preco' OR _scope = 'ambos' THEN
    WITH src AS (
      SELECT * FROM _pending p
      WHERE NOT _only_changed
         OR p.ultimo_preco_sincronizado IS DISTINCT FROM COALESCE(p.preco, 0)
    ), ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, p.bling_deposit_id,
             'preco', p.ultimo_preco_sincronizado, COALESCE(p.preco, 0), 'pendente', _enq_at
      FROM src p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          bling_product_id = EXCLUDED.bling_product_id,
          valor_anterior = EXCLUDED.valor_anterior,
          valor_novo = EXCLUDED.valor_novo,
          proxima_tentativa_em = now(),
          tentativas = 0,
          erro = NULL,
          status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), _updated_existing + count(*) FILTER (WHERE NOT inserted)
      INTO _created_preco, _updated_existing FROM ins;

    IF _only_changed THEN
      SELECT _skipped_sem_mudanca + count(*) INTO _skipped_sem_mudanca
      FROM _pending p
      WHERE p.ultimo_preco_sincronizado IS NOT DISTINCT FROM COALESCE(p.preco, 0);
    END IF;
  END IF;

  IF _scope = 'estoque' OR _scope = 'ambos' THEN
    WITH src AS (
      SELECT * FROM _pending p
      WHERE p.bling_deposit_id IS NOT NULL AND btrim(p.bling_deposit_id) <> ''
        AND (NOT _only_changed
             OR p.ultimo_estoque_sincronizado IS DISTINCT FROM COALESCE(p.estoque, 0))
    ), ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, p.bling_deposit_id,
             'estoque', p.ultimo_estoque_sincronizado, COALESCE(p.estoque, 0), 'pendente', _enq_at
      FROM src p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          bling_product_id = EXCLUDED.bling_product_id,
          bling_deposit_id = EXCLUDED.bling_deposit_id,
          valor_anterior = EXCLUDED.valor_anterior,
          valor_novo = EXCLUDED.valor_novo,
          proxima_tentativa_em = now(),
          tentativas = 0,
          erro = NULL,
          status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), _updated_existing + count(*) FILTER (WHERE NOT inserted)
      INTO _created_estoque, _updated_existing FROM ins;

    SELECT count(*) INTO _skipped_sem_dep
    FROM _pending
    WHERE bling_deposit_id IS NULL OR btrim(bling_deposit_id) = '';

    IF _only_changed THEN
      SELECT _skipped_sem_mudanca + count(*) INTO _skipped_sem_mudanca
      FROM _pending p
      WHERE p.bling_deposit_id IS NOT NULL AND btrim(p.bling_deposit_id) <> ''
        AND p.ultimo_estoque_sincronizado IS NOT DISTINCT FROM COALESCE(p.estoque, 0);
    END IF;
  END IF;

  IF _include_stores AND (_scope = 'preco' OR _scope = 'ambos' OR _scope = 'todos') THEN
    WITH stores AS (
      SELECT ps.internal_product_id AS product_id,
             ps.bling_product_store_id,
             ps.current_price,
             ps.ultimo_preco_sincronizado,
             ps.bling_store_id,
             ps.store_product_code,
             ps.current_promotional_price,
             sup.taxa_promocao AS sup_taxa_promocao,
             p.preco,
             p.codigo,
             p.bling_product_id
      FROM public.bling_product_stores ps
      JOIN public.bling_products p ON p.id = ps.internal_product_id
      LEFT JOIN public.fornecedores sup ON sup.codigo = (public.map_supplier_prefix(upper(substring(p.codigo from '^[A-Za-z]+'))))
      WHERE p.company_id = _company_id
        AND ps.company_id = _company_id
        AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
        AND ps.is_linked = true
        AND ps.bling_product_store_id IS NOT NULL
        AND btrim(ps.bling_product_store_id) <> ''
        AND p.bling_product_id IS NOT NULL
        AND btrim(p.bling_product_id) <> ''
    ), src AS (
      SELECT * FROM stores s
      WHERE NOT _only_changed
         OR s.ultimo_preco_sincronizado IS DISTINCT FROM COALESCE(s.current_price, s.preco, 0)
    ), ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_product_store_id,
         tipo, valor_anterior, valor_novo, payload, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, s.product_id, s.bling_product_id, s.bling_product_store_id,
             'preco_loja', s.ultimo_preco_sincronizado, COALESCE(s.current_price, s.preco, 0),
             jsonb_build_object(
               'bling_store_id', s.bling_store_id,
               'codigo', COALESCE(NULLIF(btrim(s.store_product_code), ''), s.codigo),
               'preco_promocional', COALESCE(
                 s.current_promotional_price,
                 round((COALESCE(s.current_price, s.preco, 0) * (1 - COALESCE(s.sup_taxa_promocao, 0)/100))::numeric, 2)
               )
             ),
             'pendente', _enq_at
      FROM src s
      ON CONFLICT (integration_id, product_id, tipo, bling_product_store_id)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NOT NULL
        DO UPDATE SET
          bling_product_id = EXCLUDED.bling_product_id,
          valor_anterior = EXCLUDED.valor_anterior,
          valor_novo = EXCLUDED.valor_novo,
          payload = EXCLUDED.payload,
          proxima_tentativa_em = now(),
          tentativas = 0,
          erro = NULL,
          status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted) INTO _created_lojas FROM ins;
  END IF;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'created_preco', _created_preco,
    'created_estoque', _created_estoque,
    'created_produto', _created_produto,
    'created_criar', _created_criar,
    'created_lojas', _created_lojas,
    'updated_existing', _updated_existing,
    'skipped_sem_bling_id', _skipped_sem_bling,
    'skipped_sem_deposito', _skipped_sem_dep,
    'skipped_sem_mudanca', _skipped_sem_mudanca
  );
END; $function$;

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

CREATE OR REPLACE FUNCTION public.run_audit_sql(_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  _run public.audit_runs%ROWTYPE;
  _rule_slugs text[];
  _rules_count int := 0;
  _min_desc int := 150;
  _max_titulo int := 60;
  _min_imgs int := 3;
  _max_imgs int := 18;
  _min_margin numeric := 10;
  _errors int := 0;
  _warnings int := 0;
  _passed int := 0;
  _total int := 0;
  _started_at timestamptz;
BEGIN
  SELECT * INTO _run FROM public.audit_runs WHERE id = _run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'audit run not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _run.company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  IF _run.status = 'cancelada' THEN
    RETURN jsonb_build_object('cancelled', true);
  END IF;
  IF _run.status = 'concluida' THEN
    RETURN jsonb_build_object(
      'done', true,
      'processed', COALESCE(_run.processed_products,0),
      'total', COALESCE(_run.total_products,0),
      'errors', COALESCE(_run.errors_count,0),
      'warnings', COALESCE(_run.warnings_count,0),
      'passed', COALESCE(_run.passed_count,0)
    );
  END IF;

  _started_at := COALESCE(_run.started_at, now());

  UPDATE public.audit_runs
    SET worker_pid = pg_backend_pid()
    WHERE id = _run_id;

  SELECT array_agg(slug), count(*) INTO _rule_slugs, _rules_count
  FROM public.validation_rules
  WHERE id = ANY(_run.rule_ids) AND active = true;
  IF _rule_slugs IS NULL THEN _rule_slugs := ARRAY[]::text[]; END IF;
  _rules_count := COALESCE(_rules_count, 0);

  SELECT COALESCE((config->>'max')::int, 60) INTO _max_titulo
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'titulo-maximo' LIMIT 1;
  _max_titulo := COALESCE(_max_titulo, 60);

  SELECT COALESCE((config->>'min')::int, 150) INTO _min_desc
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'descricao-curta-minima' LIMIT 1;
  _min_desc := COALESCE(_min_desc, 150);

  SELECT COALESCE((config->>'min')::int, 3) INTO _min_imgs
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'imagens-minimo' LIMIT 1;
  _min_imgs := COALESCE(_min_imgs, 3);

  SELECT COALESCE((config->>'max')::int, 18) INTO _max_imgs
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'imagens-maximo' LIMIT 1;
  _max_imgs := COALESCE(_max_imgs, 18);

  SELECT COALESCE((config->>'min_percent')::numeric, 10) INTO _min_margin
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'margem-minima' LIMIT 1;
  _min_margin := COALESCE(_min_margin, 10);

  CREATE TEMP TABLE _prods ON COMMIT DROP AS
  SELECT p.id, btrim(coalesce(p.codigo,'')) AS codigo, coalesce(p.nome,'') AS nome,
         coalesce(p.descricao_curta,'') AS descricao_curta,
         coalesce(p.descricao_complementar,'') AS descricao_complementar,
         coalesce(p.gtin,'') AS gtin,
         p.preco AS preco,
         p.preco_custo AS preco_custo,
         coalesce(nullif(p.url_imagens_externas,''), p.imagem_principal_url, '') AS imgs_raw
  FROM public.bling_products p
  WHERE p.company_id = _run.company_id
    AND (COALESCE(array_length(_run.product_ids,1),0) = 0 OR p.id = ANY(_run.product_ids))
    AND (_run.only_active IS NOT TRUE OR upper(btrim(coalesce(p.situacao,''))) LIKE 'A%');

  SELECT count(*) INTO _total FROM _prods;

  DELETE FROM public.audit_results ar
  USING _prods p
  WHERE ar.product_id = p.id;

  CREATE TEMP TABLE _sup ON COMMIT DROP AS
  SELECT codigo, id, nome, COALESCE(product_count,0) AS product_count
  FROM public.fornecedores;

  CREATE TEMP TABLE _rule_meta ON COMMIT DROP AS
  SELECT id, slug, category, severity
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids);

  CREATE TEMP TABLE _prod_imgs ON COMMIT DROP AS
  SELECT p.id AS product_id,
         COALESCE(array_length(regexp_split_to_array(btrim(p.imgs_raw), '[|\n\r]+'), 1), 0) AS raw_count,
         (
           SELECT array_agg(u)
           FROM (
             SELECT btrim(x) AS u
             FROM unnest(regexp_split_to_array(btrim(p.imgs_raw), '[|\n\r]+')) AS x
             WHERE btrim(x) <> ''
           ) s
         ) AS urls
  FROM _prods p;

  INSERT INTO public.audit_results
    (run_id, company_id, product_id, rule_id, rule_slug, category, severity, status, message, details)
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='titulo-maximo'),
    'titulo-maximo', 'conteudo', 'error', 'error',
    CASE WHEN char_length(p.nome) = 0 THEN 'Título vazio.'
         ELSE format('Título com %s caracteres (máximo %s).', char_length(p.nome), _max_titulo) END,
    NULL::jsonb
  FROM _prods p
  WHERE 'titulo-maximo' = ANY(_rule_slugs)
    AND (char_length(p.nome) = 0 OR char_length(p.nome) > _max_titulo)
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='descricao-curta-minima'),
    'descricao-curta-minima', 'conteudo', 'error', 'error',
    format('Descrição curta com %s caracteres (mínimo %s).', char_length(btrim(p.descricao_curta)), _min_desc),
    NULL
  FROM _prods p
  WHERE 'descricao-curta-minima' = ANY(_rule_slugs)
    AND char_length(btrim(p.descricao_curta)) < _min_desc
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='descricao-complementar-igual-nome'),
    'descricao-complementar-igual-nome', 'conteudo', 'error', 'error',
    CASE WHEN btrim(p.nome) = '' THEN 'Nome vazio.' ELSE 'Descrição complementar difere do nome (auto-corrigível).' END,
    CASE WHEN btrim(p.nome) <> '' AND btrim(p.nome) <> btrim(p.descricao_complementar)
         THEN jsonb_build_object('autofix', true, 'expected', btrim(p.nome)) ELSE NULL END
  FROM _prods p
  WHERE 'descricao-complementar-igual-nome' = ANY(_rule_slugs)
    AND (btrim(p.nome) = '' OR btrim(p.nome) <> btrim(p.descricao_complementar))
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='ean-obrigatorio'),
    'ean-obrigatorio', 'conteudo', 'error', 'error',
    'EAN/GTIN não preenchido.',
    NULL
  FROM _prods p
  WHERE 'ean-obrigatorio' = ANY(_rule_slugs)
    AND btrim(p.gtin) = ''
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='garantia-anatel-desc-complementar'),
    'garantia-anatel-desc-complementar', 'conteudo', 'error', 'error',
    (
      'Descrição curta não contém ' ||
      array_to_string(
        array_remove(ARRAY[
          CASE WHEN COALESCE(p.descricao_curta,'') !~* 'garantia' THEN '"Garantia"' END,
          CASE WHEN COALESCE(p.descricao_curta,'') !~* 'anatel'   THEN '"Anatel"'   END,
          CASE WHEN COALESCE(p.descricao_curta,'') !~* 'anvisa'   THEN '"Anvisa"'   END
        ], NULL), ' nem ') || '.'
    ),
    NULL
  FROM _prods p
  WHERE 'garantia-anatel-desc-complementar' = ANY(_rule_slugs)
    AND NOT (COALESCE(p.descricao_curta,'') ~* 'garantia' AND COALESCE(p.descricao_curta,'') ~* 'anatel' AND COALESCE(p.descricao_curta,'') ~* 'anvisa')
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='garantia-duplicada-desc-curta'),
    'garantia-duplicada-desc-curta', 'conteudo', 'error', 'error',
    format('Descrição curta contém a palavra "Garantia" %s vezes (máximo 1).', g.count_garantia),
    NULL
  FROM _prods p
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS count_garantia FROM regexp_matches(p.descricao_curta, 'garantia', 'gi')
  ) g
  WHERE 'garantia-duplicada-desc-curta' = ANY(_rule_slugs)
    AND g.count_garantia > 1
  UNION ALL
  -- margem-minima (avalia o preco base e o preco de cada loja vinculada)
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='margem-minima'),
    'margem-minima', 'preco', 'error', 'error',
    format(
      'Preço R$ %s%s não atinge o mínimo R$ %s (custo R$ %s + %s%%).',
      to_char(w.pior_preco, 'FM999999990.00'),
      CASE WHEN w.loja IS NOT NULL THEN ' na loja ' || w.loja ELSE '' END,
      to_char(p.preco_custo * (1 + _min_margin/100.0), 'FM999999990.00'),
      to_char(p.preco_custo, 'FM999999990.00'),
      to_char(_min_margin, 'FM999990.##')
    ),
    jsonb_build_object('loja', w.loja, 'preco_avaliado', w.pior_preco)
  FROM _prods p
  CROSS JOIN LATERAL (
    SELECT x.preco AS pior_preco, x.loja
    FROM (
      SELECT p.preco AS preco, NULL::text AS loja
      UNION ALL
      SELECT COALESCE(bps.current_promotional_price, bps.current_price) AS preco,
             COALESCE(bs.descricao, bps.store_name, 'Loja ' || bps.bling_store_id) AS loja
      FROM public.bling_product_stores bps
      LEFT JOIN public.bling_stores bs
        ON bs.bling_store_id = bps.bling_store_id AND bs.company_id = _run.company_id
      WHERE bps.internal_product_id = p.id
        AND bps.company_id = _run.company_id
        AND COALESCE(bps.is_linked, true) = true
    ) x
    WHERE x.preco IS NOT NULL AND x.preco > 0
    ORDER BY x.preco ASC
    LIMIT 1
  ) w
  WHERE 'margem-minima' = ANY(_rule_slugs)
    AND p.preco_custo IS NOT NULL
    AND p.preco_custo > 0
    AND w.pior_preco < p.preco_custo * (1 + _min_margin/100.0)
  UNION ALL
  SELECT _run_id, _run.company_id, pi.product_id,
    (SELECT id FROM _rule_meta WHERE slug='imagens-minimo'),
    'imagens-minimo', 'imagens', 'error', 'error',
    format('Produto tem %s imagem(ns) (mínimo %s).', COALESCE(array_length(pi.urls,1),0), _min_imgs),
    NULL
  FROM _prod_imgs pi
  WHERE 'imagens-minimo' = ANY(_rule_slugs)
    AND COALESCE(array_length(pi.urls,1),0) < _min_imgs
  UNION ALL
  SELECT _run_id, _run.company_id, pi.product_id,
    (SELECT id FROM _rule_meta WHERE slug='imagens-maximo'),
    'imagens-maximo', 'imagens', 'error', 'error',
    format('Produto tem %s imagens (máximo %s).', COALESCE(array_length(pi.urls,1),0), _max_imgs),
    NULL
  FROM _prod_imgs pi
  WHERE 'imagens-maximo' = ANY(_rule_slugs)
    AND COALESCE(array_length(pi.urls,1),0) > _max_imgs
  UNION ALL
  SELECT _run_id, _run.company_id, pi.product_id,
    (SELECT id FROM _rule_meta WHERE slug='imagens-extensao'),
    'imagens-extensao', 'imagens', 'error', 'error',
    format('%s imagem(ns) sem extensão .png/.jpg.', bad.bad_count),
    jsonb_build_object('urls', bad.samples)
  FROM _prod_imgs pi
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS bad_count,
           COALESCE(jsonb_agg(u ORDER BY u) FILTER (WHERE u IS NOT NULL), '[]'::jsonb) AS samples
    FROM (
      SELECT u
      FROM unnest(COALESCE(pi.urls, ARRAY[]::text[])) AS u
      WHERE u !~* '\.(png|jpe?g)(\?|#|$)'
      LIMIT 5
    ) s
  ) bad
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS total_bad
    FROM unnest(COALESCE(pi.urls, ARRAY[]::text[])) AS u
    WHERE u !~* '\.(png|jpe?g)(\?|#|$)'
  ) tb
  WHERE 'imagens-extensao' = ANY(_rule_slugs)
    AND tb.total_bad > 0
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='produto-em-fornecedor'),
    'produto-em-fornecedor', 'conteudo', 'error',
    CASE WHEN parsed.sku = '' THEN 'error'
         WHEN COALESCE(parsed.prefix,'') = '' THEN 'warning'
         WHEN map.sup_codigo IS NULL THEN 'warning'
         WHEN sup.sup_id IS NULL OR COALESCE(sup.sup_pc,0) = 0 THEN 'warning'
         WHEN COALESCE(parsed.numeric_code,'') = '' THEN 'error'
         ELSE 'error' END,
    CASE WHEN parsed.sku = '' THEN 'SKU vazio.'
         WHEN COALESCE(parsed.prefix,'') = '' THEN format('SKU "%s" fora do padrão esperado.', parsed.sku)
         WHEN map.sup_codigo IS NULL THEN format('Prefixo "%s" não está mapeado a um fornecedor conhecido.', parsed.prefix)
         WHEN sup.sup_id IS NULL OR COALESCE(sup.sup_pc,0) = 0
           THEN format('Base do fornecedor %s está vazia. Atualize o fornecedor antes de auditar.', COALESCE(sup.sup_nome, map.sup_codigo))
         WHEN COALESCE(parsed.numeric_code,'') = ''
           THEN format('SKU "%s" sem código após o prefixo %s.', parsed.sku, parsed.prefix)
         ELSE format('Código %s não foi encontrado na base do fornecedor %s.', parsed.numeric_code, COALESCE(sup.sup_nome, map.sup_codigo)) END,
    NULL
  FROM _prods p
  CROSS JOIN LATERAL (
    SELECT p.codigo AS sku,
      upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix,
      btrim(substring(p.codigo from '^[A-Za-z]+(.*)$')) AS numeric_code
  ) parsed
  CROSS JOIN LATERAL (
    SELECT public.map_supplier_prefix(parsed.prefix) AS sup_codigo
  ) map
  LEFT JOIN LATERAL (
    SELECT s.id AS sup_id, s.nome AS sup_nome, s.product_count AS sup_pc
    FROM _sup s WHERE s.codigo = map.sup_codigo LIMIT 1
  ) sup ON true
  LEFT JOIN LATERAL (
    SELECT fp0.id AS fp_id FROM public.fornecedor_produtos fp0
    WHERE fp0.fornecedor_id = sup.sup_id
      AND btrim(fp0.codigo) = parsed.numeric_code
    LIMIT 1
  ) fp ON true
  WHERE 'produto-em-fornecedor' = ANY(_rule_slugs)
    AND (parsed.sku = ''
      OR COALESCE(parsed.prefix,'') = ''
      OR map.sup_codigo IS NULL
      OR sup.sup_id IS NULL
      OR COALESCE(sup.sup_pc,0) = 0
      OR COALESCE(parsed.numeric_code,'') = ''
      OR fp.fp_id IS NULL);

  IF EXISTS (SELECT 1 FROM public.audit_runs WHERE id = _run_id AND status = 'cancelada') THEN
    DELETE FROM public.audit_results WHERE run_id = _run_id;
    RETURN jsonb_build_object('cancelled', true);
  END IF;

  WITH agg AS (
    SELECT product_id,
      count(*) FILTER (WHERE status='error') AS errs,
      count(*) FILTER (WHERE status='warning') AS warns
    FROM public.audit_results WHERE run_id = _run_id
    GROUP BY product_id
  )
  UPDATE public.bling_products bp SET
    last_audit_at = now(),
    last_audit_errors = COALESCE(a.errs, 0),
    last_audit_warnings = COALESCE(a.warns, 0),
    last_audit_passed = GREATEST(_rules_count - COALESCE(a.errs, 0) - COALESCE(a.warns, 0), 0)
  FROM _prods p
  LEFT JOIN agg a ON a.product_id = p.id
  WHERE bp.id = p.id;

  SELECT
    count(*) FILTER (WHERE COALESCE(errs,0) > 0),
    count(*) FILTER (WHERE COALESCE(errs,0) = 0 AND COALESCE(warns,0) > 0),
    count(*) FILTER (WHERE COALESCE(errs,0) = 0 AND COALESCE(warns,0) = 0)
  INTO _errors, _warnings, _passed
  FROM (
    SELECT p.id,
      COALESCE(a.errs, 0) AS errs,
      COALESCE(a.warns, 0) AS warns
    FROM _prods p
    LEFT JOIN (
      SELECT product_id,
        count(*) FILTER (WHERE status='error') AS errs,
        count(*) FILTER (WHERE status='warning') AS warns
      FROM public.audit_results WHERE run_id = _run_id
      GROUP BY product_id
    ) a ON a.product_id = p.id
  ) t;

  UPDATE public.audit_runs SET
    status = 'concluida',
    processed_products = _total,
    errors_count = COALESCE(_errors,0),
    warnings_count = COALESCE(_warnings,0),
    passed_count = COALESCE(_passed,0),
    finished_at = now(),
    duration_ms = (extract(epoch FROM (now() - _started_at)) * 1000)::int,
    worker_pid = NULL
  WHERE id = _run_id AND status = 'processando';

  RETURN jsonb_build_object(
    'done', true,
    'processed', _total,
    'total', _total,
    'errors', COALESCE(_errors,0),
    'warnings', COALESCE(_warnings,0),
    'passed', COALESCE(_passed,0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.transform_fill_dimensions_from_supplier(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  _updated int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH alvo AS (
    SELECT p.id, p.peso_liquido, p.peso_bruto, p.largura, p.altura, p.profundidade,
           upper(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+')) AS prefix,
           btrim(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
      AND (COALESCE(p.peso_liquido, 0) <= 0 OR COALESCE(p.largura, 0) <= 0
        OR COALESCE(p.altura, 0) <= 0 OR COALESCE(p.profundidade, 0) <= 0)
  ),
  mapped AS (
    SELECT a.*, public.map_supplier_prefix(a.prefix) AS sup_codigo
    FROM alvo a
  ),
  joined AS (
    SELECT m.id,
      COALESCE(NULLIF(m.peso_liquido, 0), NULLIF(fp.peso, 0)) AS peso_liquido,
      COALESCE(NULLIF(m.peso_bruto, 0), NULLIF(fp.peso, 0)) AS peso_bruto,
      COALESCE(NULLIF(m.largura, 0), NULLIF(fp.largura, 0)) AS largura,
      COALESCE(NULLIF(m.altura, 0), NULLIF(fp.altura, 0)) AS altura,
      COALESCE(NULLIF(m.profundidade, 0), NULLIF(fp.comprimento, 0)) AS profundidade
    FROM mapped m
    JOIN public.fornecedores f ON f.codigo = m.sup_codigo
      AND (f.company_id IS NULL OR f.company_id = _company_id)
    JOIN public.fornecedor_produtos fp ON fp.fornecedor_id = f.id
      AND btrim(fp.codigo) = m.num_code
    WHERE m.sup_codigo IS NOT NULL AND COALESCE(m.num_code, '') <> ''
  ),
  upd AS (
    UPDATE public.bling_products bp SET
      peso_liquido = j.peso_liquido,
      peso_bruto = j.peso_bruto,
      largura = j.largura,
      altura = j.altura,
      profundidade = j.profundidade,
      dirty = true,
      updated_at = now()
    FROM joined j
    WHERE bp.id = j.id
      AND (bp.peso_liquido IS DISTINCT FROM j.peso_liquido
        OR bp.peso_bruto IS DISTINCT FROM j.peso_bruto
        OR bp.largura IS DISTINCT FROM j.largura
        OR bp.altura IS DISTINCT FROM j.altura
        OR bp.profundidade IS DISTINCT FROM j.profundidade)
    RETURNING 1
  )
  SELECT count(*)::int INTO _updated FROM upd;

  RETURN jsonb_build_object('updated', _updated);
END;
$function$;

CREATE OR REPLACE FUNCTION public.transform_sync_supplier_stock_price(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
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
  _price_updated int := 0;
  _stock_updated int := 0;
  _both_updated int := 0;
  _unchanged int := 0;
  _no_supplier int := 0;
  _items jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  CREATE TEMP TABLE _work ON COMMIT DROP AS
  WITH prods AS (
    SELECT p.id, p.codigo AS sku, p.nome,
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
      fp.qt_estoque AS fp_estoque,
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
  )
  SELECT * FROM joined;

  SELECT count(*) INTO _total FROM _work;

  UPDATE public.bling_products bp SET
    preco_custo = CASE
      WHEN w.fp_preco IS NOT NULL AND (bp.preco_custo IS DISTINCT FROM w.fp_preco)
      THEN w.fp_preco ELSE bp.preco_custo END,
    estoque = CASE
      WHEN w.fp_estoque IS NOT NULL AND (bp.estoque IS DISTINCT FROM w.fp_estoque)
      THEN w.fp_estoque ELSE bp.estoque END,
    dirty = CASE
      WHEN (w.fp_preco IS NOT NULL AND bp.preco_custo IS DISTINCT FROM w.fp_preco)
        OR (w.fp_estoque IS NOT NULL AND bp.estoque IS DISTINCT FROM w.fp_estoque)
      THEN true ELSE bp.dirty END,
    updated_at = now()
  FROM _work w
  WHERE bp.id = w.id
    AND w.sup_id IS NOT NULL
    AND w.fp_estoque IS NOT NULL;

  SELECT
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL),
    count(*) FILTER (WHERE sup_codigo IS NOT NULL AND (sup_id IS NULL OR fp_estoque IS NULL)),
    count(*) FILTER (WHERE sup_codigo IS NULL),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco
        AND (estoque_atual IS NOT DISTINCT FROM fp_estoque)),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND estoque_atual IS DISTINCT FROM fp_estoque
        AND (fp_preco IS NULL OR preco_atual IS NOT DISTINCT FROM fp_preco)),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco
        AND estoque_atual IS DISTINCT FROM fp_estoque),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND (fp_preco IS NULL OR preco_atual IS NOT DISTINCT FROM fp_preco)
        AND estoque_atual IS NOT DISTINCT FROM fp_estoque)
  INTO _found, _not_found, _no_supplier, _price_updated, _stock_updated, _both_updated, _unchanged
  FROM _work;

  SELECT jsonb_agg(row_to_json(t)) INTO _items FROM (
    SELECT
      sku, nome, sup_codigo AS fornecedor,
      CASE
        WHEN sup_codigo IS NULL THEN 'sem_fornecedor'
        WHEN sup_id IS NULL OR fp_estoque IS NULL THEN 'nao_encontrado'
        WHEN (fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco)
          AND estoque_atual IS DISTINCT FROM fp_estoque THEN 'preco_e_estoque_atualizados'
        WHEN (fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco) THEN 'preco_atualizado'
        WHEN estoque_atual IS DISTINCT FROM fp_estoque THEN 'estoque_atualizado'
        ELSE 'inalterado'
      END AS status,
      preco_atual, fp_preco AS preco_novo,
      estoque_atual, fp_estoque AS estoque_novo
    FROM _work
    ORDER BY sku
  ) t;

  RETURN jsonb_build_object(
    'total', _total,
    'encontrados', _found,
    'nao_encontrados', _not_found,
    'sem_fornecedor', _no_supplier,
    'preco_atualizado', _price_updated,
    'estoque_atualizado', _stock_updated,
    'preco_e_estoque_atualizados', _both_updated,
    'inalterados', _unchanged,
    'items', COALESCE(_items, '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.transform_update_price_stock(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[], _include_stores boolean DEFAULT false, _run_id uuid DEFAULT NULL::uuid, _only_stock boolean DEFAULT false, _only_price boolean DEFAULT false)
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
  _items jsonb;
  _default_comissao numeric;
  _no_default_marketplace boolean := false;
  _pricing pricing_settings%ROWTYPE;
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
        WHEN COALESCE(j.ov_stock_cap, j.sup_stock_cap, _pricing.stock_cap_default) IS NOT NULL
          THEN LEAST(j.fp_estoque_raw, COALESCE(j.ov_stock_cap, j.sup_stock_cap, _pricing.stock_cap_default))
        ELSE j.fp_estoque_raw
      END AS fp_estoque
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
    SELECT _run_id, _company_id, w.id, w.sku, w.nome, 'estoque',
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
    'preco_e_estoque_atualizados', _both_updated,
    'inalterados', _unchanged,
    'stores_updated', COALESCE(_stores_updated, 0),
    'no_default_marketplace', _no_default_marketplace,
    'items', COALESCE(_items, '[]'::jsonb)
  );
END;
$function$;
