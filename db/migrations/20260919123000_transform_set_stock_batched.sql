-- Processa a alteração de estoque em lotes curtos para evitar statement timeout.
DROP FUNCTION IF EXISTS public.transform_set_stock(uuid, uuid[], numeric);

CREATE OR REPLACE FUNCTION public.transform_set_stock(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL::uuid[],
  _value numeric DEFAULT 0,
  _limit integer DEFAULT 250
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '20s'
AS $function$
DECLARE
  v_updated integer := 0;
  v_has_more boolean := false;
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 250), 1), 500);
BEGIN
  IF _value IS NULL OR _value < 0 THEN
    RAISE EXCEPTION 'invalid stock value';
  END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH target AS (
    SELECT p.id
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
      AND p.estoque IS DISTINCT FROM _value
    ORDER BY p.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.bling_products p
  SET estoque = _value, updated_at = now()
  FROM target
  WHERE p.id = target.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT EXISTS (
    SELECT 1
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
      AND p.estoque IS DISTINCT FROM _value
  ) INTO v_has_more;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'value', _value,
    'has_more', v_has_more
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.transform_set_stock(uuid, uuid[], numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transform_set_stock(uuid, uuid[], numeric, integer) TO service_role;