-- Define o estoque dos produtos para um valor fixo informado pelo usuário.
CREATE OR REPLACE FUNCTION public.transform_set_stock(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL::uuid[],
  _value numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated int := 0;
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

  UPDATE public.bling_products p
  SET estoque = _value, updated_at = now()
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
    AND p.estoque IS DISTINCT FROM _value;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_updated, 'value', _value);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.transform_set_stock(uuid, uuid[], numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transform_set_stock(uuid, uuid[], numeric) TO service_role;
