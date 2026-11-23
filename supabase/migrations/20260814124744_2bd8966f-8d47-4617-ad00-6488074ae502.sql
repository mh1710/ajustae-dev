CREATE INDEX IF NOT EXISTS bps_company_blingprod_linked_idx
  ON public.bling_product_stores (company_id, bling_product_id) WHERE is_linked;
CREATE INDEX IF NOT EXISTS bps_company_internal_linked_idx
  ON public.bling_product_stores (company_id, internal_product_id) WHERE is_linked;

CREATE OR REPLACE FUNCTION public.count_products_without_stores(_company_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT count(*)
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND NOT EXISTS (
      SELECT 1 FROM public.bling_product_stores s
      WHERE s.company_id = _company_id AND s.is_linked AND s.internal_product_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bling_product_stores s2
      WHERE s2.company_id = _company_id AND s2.is_linked AND s2.bling_product_id = p.bling_product_id
    )
$function$;

CREATE OR REPLACE FUNCTION public.list_products_without_stores(_company_id uuid, _limit integer DEFAULT 50, _offset integer DEFAULT 0, _after text DEFAULT NULL::text)
RETURNS TABLE(bling_product_id text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.bling_product_id
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND p.bling_product_id IS NOT NULL
    AND (_after IS NULL OR p.bling_product_id > _after)
    AND NOT EXISTS (
      SELECT 1 FROM public.bling_product_stores s
      WHERE s.company_id = _company_id AND s.is_linked AND s.internal_product_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bling_product_stores s2
      WHERE s2.company_id = _company_id AND s2.is_linked AND s2.bling_product_id = p.bling_product_id
    )
  ORDER BY p.bling_product_id
  LIMIT GREATEST(_limit, 0) OFFSET GREATEST(_offset, 0)
$function$;

CREATE OR REPLACE FUNCTION public.list_products_without_stores(_company_id uuid, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS TABLE(bling_product_id text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT * FROM public.list_products_without_stores(_company_id, _limit, _offset, NULL::text)
$function$;