-- Estoque por depósito do Bling: cada depósito tem sua regra (completo, sem ML,
-- não atualizar) e uma lista de fornecedores zerados. A fila continua com um item
-- 'estoque' por produto; o worker envia um POST /estoques por depósito pendente.

CREATE TABLE IF NOT EXISTS public.bling_stock_deposits (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bling_deposit_id text NOT NULL,
  descricao text,
  padrao boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  modo text NOT NULL DEFAULT 'completo' CHECK (modo IN ('completo','sem_ml','nao_atualizar')),
  zerar_fornecedores text[] NOT NULL DEFAULT '{}',
  synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, bling_deposit_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bling_stock_deposits TO authenticated;
GRANT ALL ON public.bling_stock_deposits TO service_role;
ALTER TABLE public.bling_stock_deposits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read stock deposits" ON public.bling_stock_deposits;
CREATE POLICY "members read stock deposits" ON public.bling_stock_deposits FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = bling_stock_deposits.company_id AND cu.user_id = auth.uid() AND cu.ativo));
DROP POLICY IF EXISTS "members write stock deposits" ON public.bling_stock_deposits;
CREATE POLICY "members write stock deposits" ON public.bling_stock_deposits FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = bling_stock_deposits.company_id AND cu.user_id = auth.uid() AND cu.ativo))
  WITH CHECK (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = bling_stock_deposits.company_id AND cu.user_id = auth.uid() AND cu.ativo));
DROP POLICY IF EXISTS company_restricted_read ON public.bling_stock_deposits;
CREATE POLICY company_restricted_read ON public.bling_stock_deposits AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((NOT public.is_company_restricted()) OR app_private.is_company_member(company_id, auth.uid()));
DROP POLICY IF EXISTS company_restricted_insert ON public.bling_stock_deposits;
CREATE POLICY company_restricted_insert ON public.bling_stock_deposits AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_company_restricted());
DROP POLICY IF EXISTS company_restricted_update ON public.bling_stock_deposits;
CREATE POLICY company_restricted_update ON public.bling_stock_deposits AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
DROP POLICY IF EXISTS company_restricted_delete ON public.bling_stock_deposits;
CREATE POLICY company_restricted_delete ON public.bling_stock_deposits AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_company_restricted());

CREATE TABLE IF NOT EXISTS public.bling_product_deposit_stock (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.bling_products(id) ON DELETE CASCADE,
  bling_deposit_id text NOT NULL,
  estoque_alvo numeric(14,4) NOT NULL DEFAULT 0,
  ultimo_estoque_sincronizado numeric(14,4),
  pendente boolean NOT NULL DEFAULT false,
  sincronizado_em timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, bling_deposit_id)
);
CREATE INDEX IF NOT EXISTS idx_product_deposit_stock_company ON public.bling_product_deposit_stock (company_id, bling_deposit_id);
CREATE INDEX IF NOT EXISTS idx_product_deposit_stock_pending ON public.bling_product_deposit_stock (product_id) WHERE pendente;
GRANT SELECT ON public.bling_product_deposit_stock TO authenticated;
GRANT ALL ON public.bling_product_deposit_stock TO service_role;
ALTER TABLE public.bling_product_deposit_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read product deposit stock" ON public.bling_product_deposit_stock;
CREATE POLICY "members read product deposit stock" ON public.bling_product_deposit_stock FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = bling_product_deposit_stock.company_id AND cu.user_id = auth.uid() AND cu.ativo));

-- Calcula o estoque de cada depósito configurado para os produtos informados.
--   completo      → estoque do produto como já calculado (fornecedor + ML, quando a
--                   atualização considerou o ML)
--   sem_ml        → estoque do fornecedor com teto (nunca acima do estoque atual)
--   fornecedor marcado em zerar_fornecedores → 0
--   nao_atualizar → não envia
-- Retorna quantos produtos ficaram com algum depósito pendente.
CREATE OR REPLACE FUNCTION public.prepare_deposit_stock_targets(_company_id uuid, _product_ids uuid[], _only_changed boolean DEFAULT true)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _default_dep text;
  _n integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bling_stock_deposits WHERE company_id = _company_id AND ativo) THEN
    RETURN 0;
  END IF;
  SELECT default_deposito_id INTO _default_dep
    FROM public.bling_integrations WHERE company_id = _company_id AND status = 'conectada' LIMIT 1;

  DROP TABLE IF EXISTS pg_temp._dep_calc;
  CREATE TEMP TABLE _dep_calc ON COMMIT DROP AS
  WITH mapped AS (
    SELECT p.id, p.estoque, p.ultimo_estoque_sincronizado,
      public.map_supplier_prefix(upper(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+'))) AS sup_codigo,
      btrim(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id AND p.id = ANY(_product_ids)
  ), base AS (
    SELECT m.id, COALESCE(m.estoque, 0) AS estoque, m.ultimo_estoque_sincronizado, m.sup_codigo,
      CASE
        WHEN fp.qt_estoque IS NULL THEN NULL
        WHEN COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default) IS NOT NULL
          THEN LEAST(fp.qt_estoque, COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default))
        ELSE fp.qt_estoque
      END AS estoque_fornecedor
    FROM mapped m
    LEFT JOIN public.fornecedores f
      ON f.codigo = m.sup_codigo AND (f.company_id IS NULL OR f.company_id = _company_id)
    LEFT JOIN public.fornecedor_produtos fp
      ON fp.fornecedor_id = f.id AND btrim(fp.codigo) = m.num_code AND m.num_code <> ''
    LEFT JOIN public.product_cost_overrides ov
      ON ov.product_id = m.id AND ov.company_id = _company_id
    LEFT JOIN public.pricing_settings ps ON ps.company_id = _company_id
  )
  SELECT DISTINCT ON (b.id, d.bling_deposit_id)
    b.id AS product_id, d.bling_deposit_id, d.modo,
    CASE
      WHEN b.sup_codigo IS NOT NULL AND b.sup_codigo = ANY(d.zerar_fornecedores) THEN 0
      WHEN d.modo = 'sem_ml' AND b.estoque_fornecedor IS NOT NULL THEN LEAST(b.estoque, b.estoque_fornecedor)
      ELSE b.estoque
    END::numeric(14,4) AS alvo,
    CASE WHEN d.bling_deposit_id = _default_dep THEN b.ultimo_estoque_sincronizado END AS ultimo_inicial
  FROM base b
  CROSS JOIN public.bling_stock_deposits d
  WHERE d.company_id = _company_id AND d.ativo
  ORDER BY b.id, d.bling_deposit_id;

  -- Depósitos que não devem ser atualizados nunca ficam pendentes.
  UPDATE public.bling_product_deposit_stock s
     SET pendente = false, updated_at = now()
    FROM _dep_calc c
   WHERE c.modo = 'nao_atualizar' AND s.product_id = c.product_id
     AND s.bling_deposit_id = c.bling_deposit_id AND s.pendente;

  INSERT INTO public.bling_product_deposit_stock AS s
    (company_id, product_id, bling_deposit_id, estoque_alvo, ultimo_estoque_sincronizado, pendente, updated_at)
  SELECT _company_id, c.product_id, c.bling_deposit_id, c.alvo, c.ultimo_inicial,
         (NOT COALESCE(_only_changed, true)) OR c.ultimo_inicial IS DISTINCT FROM c.alvo,
         now()
  FROM _dep_calc c
  WHERE c.modo <> 'nao_atualizar'
  ON CONFLICT (product_id, bling_deposit_id) DO UPDATE SET
    estoque_alvo = EXCLUDED.estoque_alvo,
    pendente = (NOT COALESCE(_only_changed, true)) OR s.ultimo_estoque_sincronizado IS DISTINCT FROM EXCLUDED.estoque_alvo,
    updated_at = now();

  SELECT count(DISTINCT s.product_id) INTO _n
    FROM public.bling_product_deposit_stock s
   WHERE s.product_id = ANY(_product_ids) AND s.pendente;
  RETURN _n;
END;
$function$;
REVOKE ALL ON FUNCTION public.prepare_deposit_stock_targets(uuid, uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_deposit_stock_targets(uuid, uuid[], boolean) TO service_role;

-- Marca um depósito como enviado (chamado pelo worker após cada POST /estoques).
CREATE OR REPLACE FUNCTION public.finish_deposit_stock_sent(_product_id uuid, _deposit_id text, _valor numeric)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.bling_product_deposit_stock
     SET ultimo_estoque_sincronizado = _valor,
         pendente = CASE WHEN estoque_alvo IS NOT DISTINCT FROM _valor THEN false ELSE pendente END,
         sincronizado_em = now(), updated_at = now()
   WHERE product_id = _product_id AND bling_deposit_id = _deposit_id;
$function$;
REVOKE ALL ON FUNCTION public.finish_deposit_stock_sent(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_deposit_stock_sent(uuid, text, numeric) TO service_role;

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
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
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
    -- Depósitos configurados: calcula o valor de cada depósito e marca o que mudou.
    PERFORM public.prepare_deposit_stock_targets(
      _company_id,
      ARRAY(SELECT product_id FROM _pending WHERE bling_deposit_id IS NOT NULL AND btrim(bling_deposit_id) <> ''),
      _only_changed);
    WITH src AS (
      SELECT * FROM _pending p
      WHERE p.bling_deposit_id IS NOT NULL AND btrim(p.bling_deposit_id) <> ''
        AND (NOT _only_changed
             OR p.ultimo_estoque_sincronizado IS DISTINCT FROM COALESCE(p.estoque, 0)
             OR EXISTS (SELECT 1 FROM public.bling_product_deposit_stock d
                        WHERE d.product_id = p.product_id AND d.pendente))
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
        AND p.ultimo_estoque_sincronizado IS NOT DISTINCT FROM COALESCE(p.estoque, 0)
        AND NOT EXISTS (SELECT 1 FROM public.bling_product_deposit_stock d
                        WHERE d.product_id = p.product_id AND d.pendente);
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
