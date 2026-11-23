
-- 1) Coluna payload para transportar dados adicionais dos itens da fila (idLojaVirtual, preço, promocional, etc.)
ALTER TABLE public.bling_push_queue
  ADD COLUMN IF NOT EXISTS payload jsonb;

-- 2) Ajusta o índice único para permitir múltiplos itens do mesmo tipo quando o item é por loja
DROP INDEX IF EXISTS public.uniq_push_queue_pending;
CREATE UNIQUE INDEX uniq_push_queue_pending
  ON public.bling_push_queue (integration_id, product_id, tipo)
  WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_push_queue_pending_store
  ON public.bling_push_queue (integration_id, product_id, tipo, bling_product_store_id)
  WHERE status IN ('pendente','processando') AND bling_product_store_id IS NOT NULL;

-- 3) claim_next_push_batch passa a devolver payload
DROP FUNCTION IF EXISTS public.claim_next_push_batch(uuid, integer);
CREATE OR REPLACE FUNCTION public.claim_next_push_batch(
  _integration_id uuid DEFAULT NULL,
  _limit int DEFAULT 5
) RETURNS TABLE (
  id uuid, integration_id uuid, company_id uuid, product_id uuid,
  bling_product_id text, bling_deposit_id text, tipo text,
  valor_novo numeric, tentativas int,
  bling_product_store_id text,
  payload jsonb
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _target uuid;
BEGIN
  IF _integration_id IS NOT NULL THEN
    _target := _integration_id;
  ELSE
    SELECT q.integration_id INTO _target
    FROM public.bling_push_queue q
    WHERE q.status = 'pendente' AND q.proxima_tentativa_em <= now()
    ORDER BY q.created_at
    LIMIT 1;
  END IF;
  IF _target IS NULL THEN RETURN; END IF;

  IF NOT pg_try_advisory_xact_lock(hashtextextended(_target::text, 42)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT q.id FROM public.bling_push_queue q
    WHERE q.integration_id = _target
      AND q.status = 'pendente'
      AND q.proxima_tentativa_em <= now()
    ORDER BY q.created_at
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.bling_push_queue q
       SET status = 'processando', claimed_at = now(), tentativas = q.tentativas + 1
      FROM picked WHERE q.id = picked.id
    RETURNING q.*
  )
  SELECT u.id, u.integration_id, u.company_id, u.product_id,
         u.bling_product_id, u.bling_deposit_id, u.tipo,
         u.valor_novo, u.tentativas, u.bling_product_store_id, u.payload
  FROM upd u;
END; $$;

-- 4) Enfileira vínculo/desvínculo de produtos com uma multiloja
CREATE OR REPLACE FUNCTION public.enqueue_bling_link_store(
  _company_id uuid,
  _product_ids uuid[],
  _bling_store_id text,
  _action text  -- 'link' | 'unlink'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _integration_id uuid;
  _pricing pricing_settings%ROWTYPE;
  _store_comissao numeric;
  _enqueued int := 0;
  _skipped int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
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
        ON bps.internal_product_id = p.id AND bps.company_id = p.company_id
      WHERE p.company_id = _company_id
        AND p.id = ANY(_product_ids)
        AND bps.bling_store_id = _bling_store_id
        AND bps.bling_product_store_id IS NOT NULL
        AND btrim(bps.bling_product_store_id) <> ''
        AND p.bling_product_id IS NOT NULL
        AND btrim(p.bling_product_id) <> ''
    ), ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_product_store_id,
         tipo, valor_novo, payload, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, s.product_id, s.bling_product_id, s.bling_product_store_id,
             'desvincular_loja', 0,
             jsonb_build_object('bling_store_id', _bling_store_id),
             'pendente', now()
      FROM src s
      ON CONFLICT (integration_id, product_id, tipo, bling_product_store_id)
        WHERE status IN ('pendente','processando')
        DO UPDATE SET
          proxima_tentativa_em = now(),
          tentativas = 0,
          erro = NULL,
          status = 'pendente'
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

  -- action = 'link': calcula preço via marketplace da loja + promocional via taxa do fornecedor
  SELECT * INTO _pricing FROM public.pricing_settings WHERE company_id = _company_id;

  SELECT m.taxa_percent INTO _store_comissao
  FROM public.bling_stores bs
  LEFT JOIN public.marketplaces m ON m.id = bs.marketplace_id
  WHERE bs.company_id = _company_id AND bs.bling_store_id = _bling_store_id
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
      s.id AS sup_id,
      s.preco_embalagem AS sup_emb, s.preco_transporte AS sup_transp,
      s.taxa_devolucao AS sup_devol, s.taxa_promocao AS sup_promo,
      COALESCE(
        NULLIF((fp.precos->>'PR')::numeric, 0),
        NULLIF((fp.precos->>'base')::numeric, 0),
        NULLIF((fp.precos->>'dropshipping')::numeric, 0),
        NULLIF((fp.precos->>'crossdocking')::numeric, 0)
      ) AS fp_preco,
      ov.embalagem AS ov_emb, ov.transporte AS ov_transp, ov.taxa_operacional AS ov_taxa_op
    FROM mapped m
    LEFT JOIN public.fornecedores s ON s.codigo = m.sup_codigo
    LEFT JOIN public.fornecedor_produtos fp
      ON fp.fornecedor_id = s.id AND btrim(fp.codigo) = m.num_code AND m.num_code <> ''
    LEFT JOIN public.product_cost_overrides ov
      ON ov.product_id = m.id AND ov.company_id = _company_id
  ),
  calc AS (
    SELECT j.*,
      (
        COALESCE(j.fp_preco, 0)
        + COALESCE(j.ov_emb, j.sup_emb, COALESCE(_pricing.embalagem_default, 0))
        + COALESCE(j.ov_transp, j.sup_transp, COALESCE(_pricing.transporte_default, 0))
        + CASE
            WHEN COALESCE(j.ov_taxa_op, _pricing.taxa_operacional_valor, 0) > 0
             AND COALESCE(j.fp_preco, 0) >= COALESCE(_pricing.taxa_operacional_min_custo, 0)
            THEN COALESCE(j.ov_taxa_op, _pricing.taxa_operacional_valor) ELSE 0 END
      ) AS cmv_base
    FROM joined j
  ),
  calc2 AS (
    SELECT c.*, (c.cmv_base * (1 + COALESCE(_pricing.frete_medio_percent, 0)/100)) AS cmv_total FROM calc c
  ),
  calc3 AS (
    SELECT c.*,
      (c.cmv_total
       + c.cmv_total * COALESCE(_pricing.custo_fixo_percent, 0)/100
       + c.cmv_total * COALESCE(_pricing.devolucao_percent, 0)/100
      ) AS custo_completo
    FROM calc2 c
  ),
  priced AS (
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
  SELECT id, codigo, bling_product_id, sup_promo,
         preco_venda,
         CASE
           WHEN preco_venda IS NULL THEN NULL
           ELSE round((preco_venda * (1 - COALESCE(sup_promo, 0)/100))::numeric, 2)
         END AS preco_promo
  FROM priced;

  WITH ins AS (
    INSERT INTO public.bling_push_queue AS q
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
    ON CONFLICT (integration_id, product_id, tipo, bling_product_store_id)
      WHERE status IN ('pendente','processando')
      DO UPDATE SET
        bling_product_id = EXCLUDED.bling_product_id,
        valor_novo = EXCLUDED.valor_novo,
        payload = EXCLUDED.payload,
        proxima_tentativa_em = now(),
        tentativas = 0,
        erro = NULL,
        status = 'pendente'
    RETURNING 1
  )
  SELECT count(*) INTO _enqueued FROM ins;

  SELECT count(*) INTO _skipped FROM _work WHERE preco_venda IS NULL;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'action', _action,
    'bling_store_id', _bling_store_id,
    'enqueued', _enqueued,
    'skipped', _skipped
  );
END; $$;

REVOKE ALL ON FUNCTION public.enqueue_bling_link_store(uuid, uuid[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_bling_link_store(uuid, uuid[], text, text) TO authenticated;
