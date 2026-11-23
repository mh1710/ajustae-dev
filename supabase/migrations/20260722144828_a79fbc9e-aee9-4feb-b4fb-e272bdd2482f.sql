
-- 1) Amplia a fila para poder enfileirar itens de lojas específicas.
ALTER TABLE public.bling_push_queue
  ADD COLUMN IF NOT EXISTS bling_product_store_id text;

ALTER TABLE public.bling_push_queue DROP CONSTRAINT IF EXISTS bling_push_queue_tipo_check;
ALTER TABLE public.bling_push_queue ADD CONSTRAINT bling_push_queue_tipo_check
  CHECK (tipo IN ('preco','estoque','produto','criar','excluir','inativar','preco_loja','estoque_loja'));

-- 2) Serviço central de cálculo do preço de venda em SQL (espelha pickPricingBand).
CREATE OR REPLACE FUNCTION public._compute_sale_price(
  _custo_completo numeric,
  _comissao_percent numeric,
  _devolucao_percent numeric,
  _taxa_promocao_percent numeric,
  _bands jsonb
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  _band jsonb;
  _margin numeric;
  _bmin numeric;
  _bmax numeric;
  _soma numeric;
  _preco numeric;
  _first_price numeric;
  _first_min numeric;
  _last_band jsonb;
  _sorted jsonb;
BEGIN
  IF _custo_completo IS NULL OR _custo_completo <= 0 THEN RETURN NULL; END IF;
  IF _bands IS NULL OR jsonb_typeof(_bands) <> 'array' OR jsonb_array_length(_bands) = 0 THEN RETURN NULL; END IF;

  SELECT jsonb_agg(b ORDER BY (b->>'min')::numeric)
    INTO _sorted
    FROM jsonb_array_elements(_bands) b;

  FOR _band IN SELECT * FROM jsonb_array_elements(_sorted)
  LOOP
    _margin := COALESCE((_band->>'margin_percent')::numeric, 0);
    _bmin := COALESCE((_band->>'min')::numeric, 0);
    _bmax := CASE WHEN _band->>'max' IS NULL OR _band->>'max' = '' THEN NULL ELSE (_band->>'max')::numeric END;
    _soma := _margin + COALESCE(_comissao_percent,0) + COALESCE(_devolucao_percent,0) + COALESCE(_taxa_promocao_percent,0);
    IF _soma >= 100 THEN CONTINUE; END IF;
    _preco := _custo_completo / (1 - (_soma / 100));
    IF _preco >= (_bmin - 0.005) AND (_bmax IS NULL OR _preco <= (_bmax + 0.005)) THEN
      RETURN round(_preco::numeric, 2);
    END IF;
  END LOOP;

  -- Fallback: se preço estourou todas → última faixa; se ficou abaixo → primeira.
  _last_band := _sorted -> (jsonb_array_length(_sorted) - 1);
  _band := _sorted -> 0;
  _margin := COALESCE((_band->>'margin_percent')::numeric, 0);
  _first_min := COALESCE((_band->>'min')::numeric, 0);
  _soma := _margin + COALESCE(_comissao_percent,0) + COALESCE(_devolucao_percent,0) + COALESCE(_taxa_promocao_percent,0);
  IF _soma >= 100 THEN RETURN NULL; END IF;
  _first_price := _custo_completo / (1 - (_soma / 100));

  IF _first_price < _first_min THEN
    RETURN round(_first_price::numeric, 2);
  END IF;

  _margin := COALESCE((_last_band->>'margin_percent')::numeric, 0);
  _soma := _margin + COALESCE(_comissao_percent,0) + COALESCE(_devolucao_percent,0) + COALESCE(_taxa_promocao_percent,0);
  IF _soma >= 100 THEN RETURN NULL; END IF;
  RETURN round((_custo_completo / (1 - (_soma / 100)))::numeric, 2);
END;
$$;

-- 3) Nova transformação: atualiza preço de custo/compra, estoque e calcula preço de venda.
CREATE OR REPLACE FUNCTION public.transform_update_price_stock(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL,
  _include_stores boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $$
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
  IF NOT EXISTS (
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
      CASE prefix
        WHEN 'ODS' THEN 'oderco' WHEN 'O' THEN 'oderco'
        WHEN 'HX' THEN 'hayamax' WHEN 'HA' THEN 'hayamax'
        WHEN 'EV' THEN 'evolusom' WHEN 'E' THEN 'evolusom'
        ELSE NULL END AS sup_codigo
    FROM prods pr
  ),
  joined AS (
    SELECT m.*,
      s.id AS sup_id, s.nome AS sup_nome,
      s.preco_embalagem AS sup_emb, s.preco_transporte AS sup_transp,
      s.taxa_devolucao AS sup_devol, s.taxa_promocao AS sup_promo,
      fp.qt_estoque AS fp_estoque,
      COALESCE(
        NULLIF((fp.precos->>'PR')::numeric, 0),
        NULLIF((fp.precos->>'base')::numeric, 0),
        NULLIF((fp.precos->>'dropshipping')::numeric, 0),
        NULLIF((fp.precos->>'crossdocking')::numeric, 0)
      ) AS fp_preco
    FROM mapped m
    LEFT JOIN public.fornecedores s
      ON s.company_id = _company_id AND s.codigo = m.sup_codigo
    LEFT JOIN public.fornecedor_produtos fp
      ON fp.fornecedor_id = s.id AND btrim(fp.codigo) = m.num_code AND m.num_code <> ''
  ),
  calc AS (
    SELECT j.*,
      -- CMV → custo_completo
      (
        COALESCE(j.fp_preco, 0)
        + COALESCE(j.sup_emb, COALESCE(_pricing.embalagem_default, 0))
        + COALESCE(j.sup_transp, COALESCE(_pricing.transporte_default, 0))
        + CASE
            WHEN COALESCE(_pricing.taxa_operacional_valor, 0) > 0
             AND COALESCE(j.fp_preco, 0) >= COALESCE(_pricing.taxa_operacional_min_custo, 0)
            THEN _pricing.taxa_operacional_valor ELSE 0 END
      ) AS cmv_base
    FROM joined j
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
        ELSE public._compute_sale_price(
          c.custo_completo,
          COALESCE(_default_comissao, 0),
          COALESCE(c.sup_devol, 0),
          COALESCE(c.sup_promo, 0),
          COALESCE(_pricing.profit_bands, '[]'::jsonb)
        )
      END AS preco_novo_venda
    FROM calc3 c
  )
  SELECT * FROM priced;

  SELECT count(*) INTO _total FROM _work;

  -- Aplica atualização em bling_products (custo/compra, estoque, preço venda quando calculado).
  WITH upd AS (
    UPDATE public.bling_products bp SET
      preco_custo = CASE
        WHEN w.fp_preco IS NOT NULL AND (bp.preco_custo IS DISTINCT FROM w.fp_preco)
        THEN w.fp_preco ELSE bp.preco_custo END,
      preco_compra = CASE
        WHEN w.fp_preco IS NOT NULL AND (bp.preco_compra IS DISTINCT FROM w.fp_preco)
        THEN w.fp_preco ELSE bp.preco_compra END,
      estoque = CASE
        WHEN w.fp_estoque IS NOT NULL AND (bp.estoque IS DISTINCT FROM w.fp_estoque)
        THEN w.fp_estoque ELSE bp.estoque END,
      preco = CASE
        WHEN w.preco_novo_venda IS NOT NULL AND (bp.preco IS DISTINCT FROM w.preco_novo_venda)
        THEN w.preco_novo_venda ELSE bp.preco END,
      dirty = CASE
        WHEN (w.fp_preco IS NOT NULL AND bp.preco_custo IS DISTINCT FROM w.fp_preco)
          OR (w.fp_estoque IS NOT NULL AND bp.estoque IS DISTINCT FROM w.fp_estoque)
          OR (w.preco_novo_venda IS NOT NULL AND bp.preco IS DISTINCT FROM w.preco_novo_venda)
        THEN true ELSE bp.dirty END,
      updated_at = now()
    FROM _work w
    WHERE bp.id = w.id
      AND w.sup_id IS NOT NULL
      AND w.fp_estoque IS NOT NULL
    RETURNING 1
  )
  SELECT 1 FROM upd LIMIT 1;

  -- Atualiza multilojas se solicitado, usando a comissão do marketplace de cada loja.
  IF _include_stores THEN
    WITH s AS (
      SELECT bps.id AS store_row_id, bps.internal_product_id, bs.marketplace_id, m.taxa_percent
      FROM public.bling_product_stores bps
      JOIN public.bling_stores bs ON bs.bling_store_id = bps.bling_store_id AND bs.company_id = bps.company_id
      LEFT JOIN public.marketplaces m ON m.id = bs.marketplace_id
      WHERE bps.company_id = _company_id
        AND bps.internal_product_id IN (SELECT id FROM _work WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL)
    ),
    calc_store AS (
      SELECT s.store_row_id, s.internal_product_id,
        public._compute_sale_price(
          w.custo_completo,
          COALESCE(s.taxa_percent, _default_comissao, 0),
          COALESCE(w.sup_devol, 0),
          COALESCE(w.sup_promo, 0),
          COALESCE(_pricing.profit_bands, '[]'::jsonb)
        ) AS preco_novo_loja
      FROM s
      JOIN _work w ON w.id = s.internal_product_id
      WHERE w.fp_preco IS NOT NULL AND w.fp_preco > 0
    ),
    upd_stores AS (
      UPDATE public.bling_product_stores bps SET
        current_price = cs.preco_novo_loja,
        updated_at = now()
      FROM calc_store cs
      WHERE bps.id = cs.store_row_id
        AND cs.preco_novo_loja IS NOT NULL
        AND (bps.current_price IS DISTINCT FROM cs.preco_novo_loja)
      RETURNING 1
    )
    SELECT count(*) INTO _stores_updated FROM upd_stores;
  END IF;

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
      estoque_atual, fp_estoque AS estoque_novo,
      preco_atual_venda, preco_novo_venda
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
    'stores_updated', COALESCE(_stores_updated, 0),
    'no_default_marketplace', _no_default_marketplace,
    'items', COALESCE(_items, '[]'::jsonb)
  );
END;
$$;

-- 4) enqueue_bling_push com opção de multilojas.
CREATE OR REPLACE FUNCTION public.enqueue_bling_push(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL::uuid[],
  _scope text DEFAULT 'ambos'::text,
  _include_stores boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
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

  DELETE FROM public.bling_push_queue WHERE company_id = _company_id;

  CREATE TEMP TABLE _pending ON COMMIT DROP AS
  SELECT p.id AS product_id, p.bling_product_id,
         COALESCE(p.bling_deposit_id, _default_dep) AS bling_deposit_id,
         p.preco, p.estoque,
         p.ultimo_preco_sincronizado, p.ultimo_estoque_sincronizado
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids));

  IF _scope = 'criar' THEN
    WITH ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, NULL, p.bling_deposit_id,
             'criar', NULL, COALESCE(p.preco, 0), 'pendente', now()
      FROM _pending p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando')
        DO UPDATE SET
          valor_novo = EXCLUDED.valor_novo,
          proxima_tentativa_em = now(),
          tentativas = 0, erro = NULL, status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
      INTO _created_criar, _updated_existing FROM ins;

    RETURN jsonb_build_object(
      'created_preco', 0,
      'created_estoque', 0,
      'created_produto', 0,
      'created_criar', _created_criar,
      'created_lojas', 0,
      'updated_existing', _updated_existing,
      'skipped_sem_bling_id', 0,
      'skipped_sem_deposito', 0
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
             'criar', NULL, COALESCE(p.preco, 0), 'pendente', now()
      FROM _pending_no_id p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando')
        DO UPDATE SET
          valor_novo = EXCLUDED.valor_novo,
          proxima_tentativa_em = now(),
          tentativas = 0, erro = NULL, status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
      INTO _created_criar, _updated_existing FROM ins;
  ELSE
    SELECT count(*) INTO _skipped_sem_bling FROM _pending_no_id;
  END IF;

  IF _scope = 'preco' OR _scope = 'ambos' THEN
    WITH ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, p.bling_deposit_id,
             'preco', p.ultimo_preco_sincronizado, p.preco, 'pendente', now()
      FROM _pending p
      WHERE p.preco IS NOT NULL
        AND (p.ultimo_preco_sincronizado IS DISTINCT FROM p.preco)
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando')
        DO UPDATE SET
          valor_novo = EXCLUDED.valor_novo,
          valor_anterior = EXCLUDED.valor_anterior,
          proxima_tentativa_em = now(),
          tentativas = 0, erro = NULL, status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), _updated_existing + count(*) FILTER (WHERE NOT inserted)
      INTO _created_preco, _updated_existing FROM ins;
  END IF;

  IF _scope = 'todos' THEN
    WITH ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, p.bling_deposit_id,
             'produto', p.ultimo_preco_sincronizado, COALESCE(p.preco, 0), 'pendente', now()
      FROM _pending p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando')
        DO UPDATE SET
          valor_novo = EXCLUDED.valor_novo,
          valor_anterior = EXCLUDED.valor_anterior,
          proxima_tentativa_em = now(),
          tentativas = 0, erro = NULL, status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), _updated_existing + count(*) FILTER (WHERE NOT inserted)
      INTO _created_produto, _updated_existing FROM ins;
  END IF;

  IF _scope = 'estoque' OR _scope = 'ambos' OR _scope = 'todos' THEN
    SELECT count(*) INTO _skipped_sem_dep
      FROM _pending WHERE bling_deposit_id IS NULL;

    WITH ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, p.bling_deposit_id,
             'estoque', p.ultimo_estoque_sincronizado, p.estoque, 'pendente', now()
      FROM _pending p
      WHERE p.estoque IS NOT NULL
        AND p.bling_deposit_id IS NOT NULL
        AND (p.ultimo_estoque_sincronizado IS DISTINCT FROM p.estoque)
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando')
        DO UPDATE SET
          valor_novo = EXCLUDED.valor_novo,
          valor_anterior = EXCLUDED.valor_anterior,
          proxima_tentativa_em = now(),
          tentativas = 0, erro = NULL, status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT _created_estoque + count(*) FILTER (WHERE inserted),
           _updated_existing + count(*) FILTER (WHERE NOT inserted)
      INTO _created_estoque, _updated_existing FROM ins;
  END IF;

  -- Multilojas: enfileira 1 item por loja vinculada, do tipo preco_loja/estoque_loja.
  IF _include_stores THEN
    -- Preço por loja
    IF _scope IN ('preco','ambos','todos') THEN
      WITH ins AS (
        INSERT INTO public.bling_push_queue AS q
          (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
           bling_product_store_id, tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
        SELECT _company_id, _integration_id, bps.internal_product_id, bps.bling_product_id, NULL,
               bps.bling_product_store_id, 'preco_loja', bps.current_price, bps.current_price,
               'pendente', now()
        FROM public.bling_product_stores bps
        JOIN _pending p ON p.product_id = bps.internal_product_id
        WHERE bps.company_id = _company_id
          AND bps.is_linked = true
          AND bps.current_price IS NOT NULL
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT _created_lojas + count(*) INTO _created_lojas FROM ins;
    END IF;
    -- Estoque por loja (mesmo valor do produto pai — Bling normalmente respeita)
    IF _scope IN ('estoque','ambos','todos') THEN
      WITH ins AS (
        INSERT INTO public.bling_push_queue AS q
          (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
           bling_product_store_id, tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
        SELECT _company_id, _integration_id, bps.internal_product_id, bps.bling_product_id, p.bling_deposit_id,
               bps.bling_product_store_id, 'estoque_loja', NULL, p.estoque, 'pendente', now()
        FROM public.bling_product_stores bps
        JOIN _pending p ON p.product_id = bps.internal_product_id
        WHERE bps.company_id = _company_id
          AND bps.is_linked = true
          AND p.estoque IS NOT NULL
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT _created_lojas + count(*) INTO _created_lojas FROM ins;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'created_preco', _created_preco,
    'created_estoque', _created_estoque,
    'created_produto', _created_produto,
    'created_criar', _created_criar,
    'created_lojas', _created_lojas,
    'updated_existing', _updated_existing,
    'skipped_sem_bling_id', _skipped_sem_bling,
    'skipped_sem_deposito', _skipped_sem_dep
  );
END;
$function$;
