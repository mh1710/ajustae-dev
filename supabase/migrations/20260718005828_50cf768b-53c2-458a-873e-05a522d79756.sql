
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

  IF _scope IN ('preco','ambos') THEN
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

  IF _scope IN ('estoque','ambos') THEN
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
    'updated_existing', _updated_existing,
    'skipped_sem_bling_id', _skipped_sem_bling,
    'skipped_sem_deposito', _skipped_sem_dep
  );
END; $$;

CREATE OR REPLACE FUNCTION public.claim_next_push_batch(
  _integration_id uuid DEFAULT NULL,
  _limit int DEFAULT 5
) RETURNS TABLE (
  id uuid, integration_id uuid, company_id uuid, product_id uuid,
  bling_product_id text, bling_deposit_id text, tipo text,
  valor_novo numeric, tentativas int
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
         u.valor_novo, u.tentativas
  FROM upd u;
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
  IF _tipo = 'preco' THEN
    UPDATE public.bling_products SET
      ultimo_preco_sincronizado = _valor,
      sincronizado_em = now(),
      sincronizacao_status = 'ok',
      sincronizacao_erro = NULL
    WHERE id = _pid;
  ELSE
    UPDATE public.bling_products SET
      ultimo_estoque_sincronizado = _valor,
      sincronizado_em = now(),
      sincronizacao_status = 'ok',
      sincronizacao_erro = NULL
    WHERE id = _pid;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.finish_bling_push_error(
  _item_id uuid,
  _erro text,
  _status_code int DEFAULT NULL,
  _body_safe text DEFAULT NULL,
  _retry_in_seconds int DEFAULT NULL,
  _max_attempts int DEFAULT 5
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tent int; _pid uuid;
BEGIN
  SELECT tentativas, product_id INTO _tent, _pid
    FROM public.bling_push_queue WHERE id = _item_id;

  IF _retry_in_seconds IS NOT NULL AND _tent < _max_attempts THEN
    UPDATE public.bling_push_queue SET
      status = 'pendente',
      proxima_tentativa_em = now() + make_interval(secs => _retry_in_seconds),
      erro = _erro,
      last_response_status = _status_code,
      last_response_body_safe = _body_safe,
      updated_at = now()
    WHERE id = _item_id;
  ELSE
    UPDATE public.bling_push_queue SET
      status = 'erro',
      erro = _erro,
      last_response_status = _status_code,
      last_response_body_safe = _body_safe,
      processed_at = now(),
      updated_at = now()
    WHERE id = _item_id;
    IF _pid IS NOT NULL THEN
      UPDATE public.bling_products SET
        sincronizacao_status = 'erro',
        sincronizacao_erro = _erro
      WHERE id = _pid;
    END IF;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.retry_bling_push_errors(_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  WITH upd AS (
    UPDATE public.bling_push_queue SET
      status = 'pendente', tentativas = 0, proxima_tentativa_em = now(), erro = NULL
    WHERE company_id = _company_id AND status = 'erro'
    RETURNING 1
  ) SELECT count(*) INTO _n FROM upd;
  RETURN jsonb_build_object('reenfileirados', _n);
END; $$;

CREATE OR REPLACE FUNCTION public.get_bling_push_progress(_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _res jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  SELECT jsonb_build_object(
    'total', count(*),
    'pendentes', count(*) FILTER (WHERE status IN ('pendente','processando')),
    'concluidos', count(*) FILTER (WHERE status = 'concluido'),
    'erros', count(*) FILTER (WHERE status = 'erro'),
    'oldest_pending', min(created_at) FILTER (WHERE status IN ('pendente','processando')),
    'last_processed', max(updated_at) FILTER (WHERE status IN ('concluido','erro'))
  ) INTO _res FROM public.bling_push_queue WHERE company_id = _company_id;
  RETURN COALESCE(_res, '{}'::jsonb);
END; $$;
