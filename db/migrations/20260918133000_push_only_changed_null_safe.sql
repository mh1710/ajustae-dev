-- Corrige reenvio desnecessário: produtos com estoque/preço NULL eram tratados
-- como 'mudou' e iam para a fila do Bling toda automação (0 -> 0).

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
      LEFT JOIN public.fornecedores sup ON sup.codigo = (CASE upper(substring(p.codigo from '^[A-Za-z]+'))
             WHEN 'ODS' THEN 'oderco' WHEN 'ODR' THEN 'oderco' WHEN 'O' THEN 'oderco'
             WHEN 'HX' THEN 'hayamax' WHEN 'HAY' THEN 'hayamax' WHEN 'HA' THEN 'hayamax'
             WHEN 'EVS' THEN 'evolusom' WHEN 'EV' THEN 'evolusom' WHEN 'E' THEN 'evolusom'
             ELSE NULL END)
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
END; $function$


