CREATE OR REPLACE FUNCTION public.transform_zero_stock(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '0'
AS $function$
DECLARE
  v_updated int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  UPDATE public.bling_products p
  SET estoque = 0, updated_at = now()
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
    AND COALESCE(p.estoque, 0) <> 0;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_updated);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.transform_zero_stock(uuid, uuid[]) TO authenticated;