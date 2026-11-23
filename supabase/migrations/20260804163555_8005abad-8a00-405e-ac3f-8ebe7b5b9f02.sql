CREATE OR REPLACE FUNCTION public.transform_zero_stock(_company_id uuid, _product_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    AND (p.estoque IS DISTINCT FROM 0 OR TRUE);
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_updated);
END;
$$;