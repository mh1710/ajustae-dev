CREATE OR REPLACE FUNCTION public.list_products_without_stores(_company_id uuid, _limit integer DEFAULT 50, _offset integer DEFAULT 0, _after text DEFAULT NULL)
RETURNS TABLE(bling_product_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.bling_product_id
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND p.bling_product_id IS NOT NULL
    AND (_after IS NULL OR p.bling_product_id > _after)
    AND NOT EXISTS (
      SELECT 1 FROM public.bling_product_stores s
      WHERE s.company_id = p.company_id
        AND s.is_linked
        AND (s.internal_product_id = p.id OR s.bling_product_id = p.bling_product_id)
    )
  ORDER BY p.bling_product_id
  LIMIT GREATEST(_limit, 0) OFFSET GREATEST(_offset, 0)
$function$;

GRANT EXECUTE ON FUNCTION public.list_products_without_stores(uuid, integer, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_bling_stores_job_cursor(_job_id uuid, _cursor text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.bling_store_sync_jobs SET bling_product_id = _cursor WHERE id = _job_id;
$function$;

GRANT EXECUTE ON FUNCTION public.set_bling_stores_job_cursor(uuid, text) TO service_role;