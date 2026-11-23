CREATE OR REPLACE FUNCTION public.delete_products_batch(_company_id uuid, _limit integer DEFAULT 500, _product_ids uuid[] DEFAULT NULL::uuid[])
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
  DELETE FROM public.bling_product_stores WHERE company_id = _company_id AND internal_product_id = ANY(_ids);
  UPDATE public.bling_order_items SET product_id = NULL WHERE product_id = ANY(_ids);

  DELETE FROM public.bling_products WHERE id = ANY(_ids);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_store_links_batch(_company_id uuid, _bling_store_id text DEFAULT NULL, _limit integer DEFAULT 2000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo
  ) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.';
  END IF;

  WITH doomed AS (
    SELECT id FROM public.bling_product_stores
    WHERE company_id = _company_id
      AND (_bling_store_id IS NULL OR bling_store_id = _bling_store_id)
    LIMIT GREATEST(1, LEAST(_limit, 5000))
  )
  DELETE FROM public.bling_product_stores s USING doomed d WHERE s.id = d.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_store_links_batch(uuid, text, integer) TO authenticated;