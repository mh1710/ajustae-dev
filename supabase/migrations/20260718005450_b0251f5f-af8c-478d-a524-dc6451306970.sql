
-- Columns on integrations
ALTER TABLE public.bling_integrations
  ADD COLUMN IF NOT EXISTS default_deposito_id text;

-- Columns on products (sync-to-bling state)
ALTER TABLE public.bling_products
  ADD COLUMN IF NOT EXISTS bling_deposit_id text,
  ADD COLUMN IF NOT EXISTS ultimo_preco_sincronizado numeric(14,4),
  ADD COLUMN IF NOT EXISTS ultimo_estoque_sincronizado numeric(14,4),
  ADD COLUMN IF NOT EXISTS sincronizacao_status text,
  ADD COLUMN IF NOT EXISTS sincronizacao_erro text,
  ADD COLUMN IF NOT EXISTS sincronizado_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_bling_products_sync_status
  ON public.bling_products (company_id, sincronizacao_status);

-- Push queue table
CREATE TABLE IF NOT EXISTS public.bling_push_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.bling_products(id) ON DELETE CASCADE,
  bling_product_id text NOT NULL,
  bling_deposit_id text,
  tipo text NOT NULL CHECK (tipo IN ('preco','estoque')),
  valor_anterior numeric(14,4),
  valor_novo numeric(14,4) NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','processando','concluido','erro','cancelado')),
  tentativas int NOT NULL DEFAULT 0,
  proxima_tentativa_em timestamptz NOT NULL DEFAULT now(),
  erro text,
  last_response_status int,
  last_response_body_safe text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

GRANT SELECT ON public.bling_push_queue TO authenticated;
GRANT ALL ON public.bling_push_queue TO service_role;
ALTER TABLE public.bling_push_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view push queue" ON public.bling_push_queue
  FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

CREATE INDEX IF NOT EXISTS idx_push_queue_integration_status
  ON public.bling_push_queue (integration_id, status, proxima_tentativa_em);

CREATE INDEX IF NOT EXISTS idx_push_queue_company_status
  ON public.bling_push_queue (company_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_push_queue_pending
  ON public.bling_push_queue (integration_id, product_id, tipo)
  WHERE status IN ('pendente','processando');

CREATE TRIGGER trg_push_queue_updated_at
  BEFORE UPDATE ON public.bling_push_queue
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Enqueue function
CREATE OR REPLACE FUNCTION public.enqueue_bling_push(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL,
  _scope text DEFAULT 'ambos'  -- 'preco' | 'estoque' | 'ambos'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _integration_id uuid;
  _default_dep text;
  _created_preco int := 0;
  _created_estoque int := 0;
  _updated int := 0;
  _skipped_sem_id int := 0;
  _skipped_sem_deposito int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN RAISE EXCEPTION 'not a member of company'; END IF;

  SELECT id, default_deposito_id INTO _integration_id, _default_dep
  FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada';
  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Integração com Bling não está conectada.';
  END IF;

  CREATE TEMP TABLE _candidates ON COMMIT DROP AS
  SELECT p.id AS product_id,
         p.bling_product_id,
         COALESCE(p.bling_deposit_id, _default_dep) AS deposito,
         p.preco,
         p.ultimo_preco_sincronizado,
         p.estoque,
         p.ultimo_estoque_sincronizado
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids));

  SELECT count(*) FILTER (WHERE bling_product_id IS NULL OR bling_product_id = '')
    INTO _skipped_sem_id FROM _candidates;

  -- PREÇO
  IF _scope IN ('preco','ambos') THEN
    WITH ins AS (
      INSERT INTO public.bling_push_queue
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, c.product_id, c.bling_product_id, NULL,
             'preco', c.ultimo_preco_sincronizado, c.preco, 'pendente', now()
      FROM _candidates c
      WHERE c.bling_product_id IS NOT NULL AND c.bling_product_id <> ''
        AND c.preco IS NOT NULL
        AND c.preco IS DISTINCT FROM c.ultimo_preco_sincronizado
      ON CONFLICT (integration_id, product_id, tipo) WHERE status IN ('pendente','processando')
      DO UPDATE SET valor_novo = EXCLUDED.valor_novo,
                    valor_anterior = EXCLUDED.valor_anterior,
                    proxima_tentativa_em = now(),
                    erro = NULL,
                    updated_at = now()
      RETURNING (xmax = 0) AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
      INTO _created_preco, _updated FROM ins;
  END IF;

  -- ESTOQUE
  IF _scope IN ('estoque','ambos') THEN
    SELECT count(*) FILTER (
      WHERE (bling_product_id IS NOT NULL AND bling_product_id <> '')
        AND (deposito IS NULL OR deposito = '')
        AND estoque IS NOT NULL
        AND estoque IS DISTINCT FROM ultimo_estoque_sincronizado
    ) INTO _skipped_sem_deposito FROM _candidates;

    WITH ins AS (
      INSERT INTO public.bling_push_queue
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, c.product_id, c.bling_product_id, c.deposito,
             'estoque', c.ultimo_estoque_sincronizado, c.estoque, 'pendente', now()
      FROM _candidates c
      WHERE c.bling_product_id IS NOT NULL AND c.bling_product_id <> ''
        AND c.deposito IS NOT NULL AND c.deposito <> ''
        AND c.estoque IS NOT NULL
        AND c.estoque IS DISTINCT FROM c.ultimo_estoque_sincronizado
      ON CONFLICT (integration_id, product_id, tipo) WHERE status IN ('pendente','processando')
      DO UPDATE SET valor_novo = EXCLUDED.valor_novo,
                    valor_anterior = EXCLUDED.valor_anterior,
                    bling_deposit_id = EXCLUDED.bling_deposit_id,
                    proxima_tentativa_em = now(),
                    erro = NULL,
                    updated_at = now()
      RETURNING (xmax = 0) AS inserted
    )
    SELECT _created_estoque + count(*) FILTER (WHERE inserted),
           _updated + count(*) FILTER (WHERE NOT inserted)
      INTO _created_estoque, _updated FROM ins;
  END IF;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'created_preco', _created_preco,
    'created_estoque', _created_estoque,
    'updated_existing', _updated,
    'skipped_sem_bling_id', _skipped_sem_id,
    'skipped_sem_deposito', _skipped_sem_deposito
  );
END; $$;

-- Retry errored items (resets status)
CREATE OR REPLACE FUNCTION public.retry_bling_push_errors(_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN RAISE EXCEPTION 'not a member of company'; END IF;

  UPDATE public.bling_push_queue
     SET status = 'pendente', tentativas = 0, proxima_tentativa_em = now(),
         erro = NULL, updated_at = now()
   WHERE company_id = _company_id AND status = 'erro';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('reenfileirados', _n);
END; $$;

-- Progress
CREATE OR REPLACE FUNCTION public.get_bling_push_progress(_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'total', count(*),
    'pendentes', count(*) FILTER (WHERE status IN ('pendente','processando')),
    'concluidos', count(*) FILTER (WHERE status = 'concluido'),
    'erros', count(*) FILTER (WHERE status = 'erro'),
    'oldest_pending', min(created_at) FILTER (WHERE status IN ('pendente','processando')),
    'last_processed', max(processed_at)
  )
  FROM public.bling_push_queue
  WHERE company_id = _company_id
    AND EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = _company_id AND cu.user_id = auth.uid() AND cu.ativo = true
    );
$$;

-- Claim next batch for a given integration (advisory lock per integration)
CREATE OR REPLACE FUNCTION public.claim_next_push_batch(
  _integration_id uuid DEFAULT NULL,
  _limit int DEFAULT 5
) RETURNS TABLE(
  id uuid, integration_id uuid, company_id uuid, product_id uuid,
  bling_product_id text, bling_deposit_id text, tipo text,
  valor_novo numeric, tentativas int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _int uuid;
BEGIN
  -- pick integration to work on
  IF _integration_id IS NOT NULL THEN _int := _integration_id;
  ELSE
    SELECT q.integration_id INTO _int
    FROM public.bling_push_queue q
    WHERE q.status = 'pendente' AND q.proxima_tentativa_em <= now()
    GROUP BY q.integration_id
    ORDER BY min(q.created_at)
    LIMIT 1;
  END IF;

  IF _int IS NULL THEN RETURN; END IF;

  IF NOT pg_try_advisory_xact_lock(hashtextextended(_int::text, 42)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT q.id FROM public.bling_push_queue q
    WHERE q.integration_id = _int
      AND q.status = 'pendente'
      AND q.proxima_tentativa_em <= now()
    ORDER BY q.created_at
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.bling_push_queue q
       SET status = 'processando', claimed_at = now(),
           tentativas = q.tentativas + 1, updated_at = now()
      FROM picked
     WHERE q.id = picked.id
    RETURNING q.*
  )
  SELECT u.id, u.integration_id, u.company_id, u.product_id,
         u.bling_product_id, u.bling_deposit_id, u.tipo, u.valor_novo, u.tentativas
  FROM upd u;
END; $$;

-- Mark success (and update product cache)
CREATE OR REPLACE FUNCTION public.finish_bling_push_success(_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record;
BEGIN
  SELECT * INTO _r FROM public.bling_push_queue WHERE id = _item_id;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.bling_push_queue
     SET status = 'concluido', processed_at = now(), erro = NULL, updated_at = now()
   WHERE id = _item_id;

  IF _r.tipo = 'preco' THEN
    UPDATE public.bling_products
       SET ultimo_preco_sincronizado = _r.valor_novo,
           sincronizado_em = now(),
           sincronizacao_status = 'sincronizado',
           sincronizacao_erro = NULL
     WHERE id = _r.product_id;
  ELSE
    UPDATE public.bling_products
       SET ultimo_estoque_sincronizado = _r.valor_novo,
           sincronizado_em = now(),
           sincronizacao_status = 'sincronizado',
           sincronizacao_erro = NULL
     WHERE id = _r.product_id;
  END IF;
END; $$;

-- Mark failure (with optional next retry delay)
CREATE OR REPLACE FUNCTION public.finish_bling_push_error(
  _item_id uuid,
  _erro text,
  _status_code int DEFAULT NULL,
  _body_safe text DEFAULT NULL,
  _retry_in_seconds int DEFAULT NULL,
  _max_attempts int DEFAULT 5
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record;
BEGIN
  SELECT * INTO _r FROM public.bling_push_queue WHERE id = _item_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF _retry_in_seconds IS NOT NULL AND _r.tentativas < _max_attempts THEN
    UPDATE public.bling_push_queue
       SET status = 'pendente',
           proxima_tentativa_em = now() + make_interval(secs => _retry_in_seconds),
           erro = _erro, last_response_status = _status_code,
           last_response_body_safe = _body_safe, updated_at = now()
     WHERE id = _item_id;
  ELSE
    UPDATE public.bling_push_queue
       SET status = 'erro', processed_at = now(),
           erro = _erro, last_response_status = _status_code,
           last_response_body_safe = _body_safe, updated_at = now()
     WHERE id = _item_id;

    UPDATE public.bling_products
       SET sincronizacao_status = 'erro',
           sincronizacao_erro = _erro
     WHERE id = _r.product_id;
  END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.enqueue_bling_push(uuid, uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_bling_push_errors(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_bling_push_progress(uuid) TO authenticated;
