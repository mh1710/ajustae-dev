
DROP FUNCTION IF EXISTS public.claim_next_push_batch(uuid, integer);
CREATE OR REPLACE FUNCTION public.claim_next_push_batch(
  _integration_id uuid DEFAULT NULL,
  _limit int DEFAULT 5
) RETURNS TABLE (
  id uuid, integration_id uuid, company_id uuid, product_id uuid,
  bling_product_id text, bling_deposit_id text, tipo text,
  valor_novo numeric, tentativas int,
  bling_product_store_id text
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
         u.valor_novo, u.tentativas, u.bling_product_store_id
  FROM upd u;
END; $$;
