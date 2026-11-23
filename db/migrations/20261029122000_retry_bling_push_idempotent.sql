-- Preserve pending/processing work; retry the newest failed item per unique key.
CREATE OR REPLACE FUNCTION public.retry_bling_push_errors(_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _n int := 0; _ignored int := 0; _row record;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.company_users WHERE company_id = _company_id
    AND user_id = auth.uid() AND ativo = true) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  FOR _row IN SELECT id FROM public.bling_push_queue
    WHERE company_id = _company_id AND status = 'erro'
    ORDER BY updated_at DESC, created_at DESC, id DESC
  LOOP
    BEGIN
      UPDATE public.bling_push_queue q SET status = 'pendente', tentativas = 0,
        proxima_tentativa_em = now(), erro = NULL, claimed_at = NULL, processed_at = NULL
      WHERE q.id = _row.id AND q.status = 'erro'
        AND NOT EXISTS (SELECT 1 FROM public.bling_push_queue active
          WHERE active.integration_id = q.integration_id AND active.product_id = q.product_id
            AND active.tipo = q.tipo AND active.status IN ('pendente','processando')
            AND active.bling_product_store_id IS NOT DISTINCT FROM q.bling_product_store_id);
      IF FOUND THEN _n := _n + 1; ELSE _ignored := _ignored + 1; END IF;
    EXCEPTION WHEN unique_violation THEN
      -- A concurrent enqueue won the unique index. Do not abort other retries.
      _ignored := _ignored + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('reenfileirados', _n, 'ja_na_fila', _ignored);
END;
$$;
GRANT EXECUTE ON FUNCTION public.retry_bling_push_errors(uuid) TO authenticated;