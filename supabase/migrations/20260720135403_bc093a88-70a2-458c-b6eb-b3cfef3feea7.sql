
CREATE OR REPLACE FUNCTION public.enqueue_bling_inactivate(_company_id uuid, _product_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _integration_id uuid;
  _created int := 0;
  _updated int := 0;
  _skipped_sem_bling int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  IF _product_ids IS NULL OR array_length(_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecione ao menos um produto para inativar.';
  END IF;

  SELECT id INTO _integration_id
  FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada'
  LIMIT 1;
  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada para esta empresa.';
  END IF;

  CREATE TEMP TABLE _pending_inact ON COMMIT DROP AS
  SELECT p.id AS product_id, p.bling_product_id
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND p.id = ANY(_product_ids);

  SELECT count(*) INTO _skipped_sem_bling
    FROM _pending_inact WHERE bling_product_id IS NULL OR btrim(bling_product_id) = '';
  DELETE FROM _pending_inact WHERE bling_product_id IS NULL OR btrim(bling_product_id) = '';

  -- Cancel any previously queued push for these products to avoid conflicts.
  UPDATE public.bling_push_queue
     SET status = 'cancelado', updated_at = now()
   WHERE integration_id = _integration_id
     AND product_id IN (SELECT product_id FROM _pending_inact)
     AND tipo IN ('preco','estoque','produto')
     AND status IN ('pendente','processando');

  WITH ins AS (
    INSERT INTO public.bling_push_queue AS q
      (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
       tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
    SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, NULL,
           'inativar', NULL, 0, 'pendente', now()
    FROM _pending_inact p
    ON CONFLICT (integration_id, product_id, tipo)
      WHERE status IN ('pendente','processando')
      DO UPDATE SET
        proxima_tentativa_em = now(),
        tentativas = 0, erro = NULL, status = 'pendente'
    RETURNING xmax = 0 AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
    INTO _created, _updated FROM ins;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'created', _created,
    'updated_existing', _updated,
    'skipped_sem_bling_id', _skipped_sem_bling
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.enqueue_bling_inactivate(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.finish_bling_push_success(_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  ELSIF _tipo = 'inativar' THEN
    UPDATE public.bling_products SET
      situacao = 'Inativo',
      sincronizado_em = now(),
      sincronizacao_status = 'ok',
      sincronizacao_erro = NULL
    WHERE id = _pid;
  ELSIF _tipo = 'excluir' THEN
    DELETE FROM public.bling_products WHERE id = _pid;
  END IF;
END; $$;
