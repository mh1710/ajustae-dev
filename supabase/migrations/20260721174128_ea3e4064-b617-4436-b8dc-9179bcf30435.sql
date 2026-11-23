
-- 1) Allow the new "criar" tipo (keep previous ones)
ALTER TABLE public.bling_push_queue DROP CONSTRAINT IF EXISTS bling_push_queue_tipo_check;
ALTER TABLE public.bling_push_queue ADD CONSTRAINT bling_push_queue_tipo_check
  CHECK (tipo IN ('preco','estoque','produto','criar','excluir','inativar'));

-- 2) enqueue_bling_push: adds "criar" branch (products without bling_product_id, only when scope='todos')
CREATE OR REPLACE FUNCTION public.enqueue_bling_push(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL,
  _scope text DEFAULT 'ambos'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _integration_id uuid;
  _default_dep text;
  _created_preco int := 0;
  _created_estoque int := 0;
  _created_produto int := 0;
  _created_criar int := 0;
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

  -- Split: without bling_product_id -> candidates for "criar" (only if scope='todos')
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
    _skipped_sem_bling := (SELECT count(*) FROM _pending_no_id);
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

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'created_preco', _created_preco,
    'created_estoque', _created_estoque,
    'created_produto', _created_produto,
    'created_criar', _created_criar,
    'updated_existing', _updated_existing,
    'skipped_sem_bling_id', _skipped_sem_bling,
    'skipped_sem_deposito', _skipped_sem_dep
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.enqueue_bling_push(uuid, uuid[], text) TO authenticated;

-- 3) Function called by worker after a successful CREATE to persist returned Bling ID.
CREATE OR REPLACE FUNCTION public.finish_bling_push_created(_item_id uuid, _bling_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _pid uuid;
BEGIN
  UPDATE public.bling_push_queue
     SET status = 'concluido', erro = NULL, processed_at = now(), updated_at = now(),
         bling_product_id = _bling_id
   WHERE id = _item_id
   RETURNING product_id INTO _pid;

  IF _pid IS NULL THEN RETURN; END IF;

  UPDATE public.bling_products SET
    bling_product_id = _bling_id,
    sincronizado_em = now(),
    sincronizacao_status = 'ok',
    sincronizacao_erro = NULL
  WHERE id = _pid;
END; $$;
