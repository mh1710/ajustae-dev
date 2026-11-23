CREATE OR REPLACE FUNCTION public.delete_products_batch(_company_id uuid, _limit int DEFAULT 500, _product_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ids uuid[];
  _n integer;
BEGIN
  SELECT array_agg(id) INTO _ids
  FROM (
    SELECT id FROM public.bling_products
    WHERE company_id = _company_id
      AND (_product_ids IS NULL OR id = ANY(_product_ids))
    LIMIT GREATEST(1, LEAST(_limit, 2000))
  ) t;

  IF _ids IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.audit_results WHERE product_id = ANY(_ids);
  DELETE FROM public.bling_push_queue WHERE product_id = ANY(_ids);
  DELETE FROM public.product_cost_overrides WHERE product_id = ANY(_ids);
  DELETE FROM public.bling_product_custom_values WHERE product_id = ANY(_ids);
  DELETE FROM public.ml_product_matches WHERE product_id = ANY(_ids);
  UPDATE public.bling_product_stores SET internal_product_id = NULL WHERE internal_product_id = ANY(_ids);
  UPDATE public.bling_order_items SET product_id = NULL WHERE product_id = ANY(_ids);

  DELETE FROM public.bling_products WHERE id = ANY(_ids);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_products_batch(uuid, int, uuid[]) TO authenticated, service_role;