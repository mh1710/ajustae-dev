CREATE OR REPLACE FUNCTION public.finish_bling_push_success(_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _tipo text; _pid uuid; _valor numeric; _store text;
BEGIN
  UPDATE public.bling_push_queue
     SET status = 'concluido', erro = NULL, processed_at = now(), updated_at = now()
   WHERE id = _item_id
   RETURNING tipo, product_id, valor_novo, bling_product_store_id
        INTO _tipo, _pid, _valor, _store;

  IF _pid IS NULL THEN RETURN; END IF;

  IF _tipo = 'preco' THEN
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
      situacao = 'I',
      dirty = false,
      sincronizado_em = now(),
      sincronizacao_status = 'ok',
      sincronizacao_erro = NULL
    WHERE id = _pid;
  ELSIF _tipo = 'preco_loja' AND _store IS NOT NULL THEN
    UPDATE public.bling_product_stores SET
      ultimo_preco_sincronizado = _valor,
      sincronizado_em = now()
    WHERE bling_product_store_id = _store;
    UPDATE public.bling_products SET
      sincronizado_em = now(),
      sincronizacao_status = 'ok',
      sincronizacao_erro = NULL
    WHERE id = _pid;
  ELSE
    UPDATE public.bling_products SET
      sincronizado_em = now(),
      sincronizacao_status = 'ok',
      sincronizacao_erro = NULL
    WHERE id = _pid;
  END IF;
END;
$$;