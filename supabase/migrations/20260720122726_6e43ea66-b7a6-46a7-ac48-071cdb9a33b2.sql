
-- Allow 'produto' in tipo check
ALTER TABLE public.bling_push_queue DROP CONSTRAINT IF EXISTS bling_push_queue_tipo_check;
ALTER TABLE public.bling_push_queue ADD CONSTRAINT bling_push_queue_tipo_check
  CHECK (tipo IN ('preco','estoque','produto'));

CREATE OR REPLACE FUNCTION public.enqueue_bling_push(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL,
  _scope text DEFAULT 'ambos'  -- 'preco' | 'estoque' | 'ambos' | 'todos'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _integration_id uuid;
  _default_dep text;
  _created_preco int := 0;
  _created_estoque int := 0;
  _created_produto int := 0;
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

  CREATE TEMP TABLE _pending ON COMMIT DROP AS
  SELECT p.id AS product_id, p.bling_product_id,
         COALESCE(p.bling_deposit_id, _default_dep) AS bling_deposit_id,
         p.preco, p.estoque,
         p.ultimo_preco_sincronizado, p.ultimo_estoque_sincronizado
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids));

  SELECT count(*) INTO _skipped_sem_bling
    FROM _pending WHERE bling_product_id IS NULL OR btrim(bling_product_id) = '';
  DELETE FROM _pending WHERE bling_product_id IS NULL OR btrim(bling_product_id) = '';

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
    SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
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

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'created_preco', _created_preco,
    'created_estoque', _created_estoque,
    'created_produto', _created_produto,
    'updated_existing', _updated_existing,
    'skipped_sem_bling_id', _skipped_sem_bling,
    'skipped_sem_deposito', _skipped_sem_dep
  );
END; $$;

CREATE OR REPLACE FUNCTION public.finish_bling_push_success(_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tipo text; _pid uuid; _valor numeric;
BEGIN
  UPDATE public.bling_push_queue
     SET status = 'concluido', erro = NULL, processed_at = now(), updated_at = now()
   WHERE id = _item_id
   RETURNING tipo, product_id, valor_novo INTO _tipo, _pid, _valor;

  IF _pid IS NULL THEN RETURN; END IF;
  IF _tipo = 'preco' OR _tipo = 'produto' THEN
    UPDATE public.bling_products SET
      ultimo_preco_sincronizado = _valor,
      sincronizado_em = now(),
      sincronizacao_status = 'ok',
      sincronizacao_erro = NULL
    WHERE id = _pid;
  ELSIF _tipo = 'estoque' THEN
    UPDATE public.bling_products SET
      ultimo_estoque_sincronizado = _valor,
      sincronizado_em = now(),
      sincronizacao_status = 'ok',
      sincronizacao_erro = NULL
    WHERE id = _pid;
  END IF;
END; $$;
