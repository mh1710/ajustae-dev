CREATE OR REPLACE FUNCTION public.get_bling_stores_progress(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _res jsonb; _job record; _checked bigint := 0; _total_products bigint := 0; _with bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT bj.* INTO _job
  FROM public.bling_store_sync_jobs bj
  WHERE bj.company_id = _company_id
  ORDER BY bj.created_at DESC LIMIT 1;

  SELECT count(*) INTO _total_products FROM public.bling_products WHERE company_id = _company_id;

  SELECT count(DISTINCT internal_product_id) INTO _with
  FROM public.bling_product_stores
  WHERE company_id = _company_id AND is_linked AND internal_product_id IS NOT NULL;

  IF _job.id IS NOT NULL THEN
    SELECT count(DISTINCT bling_product_id) INTO _checked
    FROM public.bling_product_stores
    WHERE company_id = _company_id AND last_seen_run_id = _job.id;
  END IF;

  SELECT jsonb_build_object(
    'job', CASE WHEN _job.id IS NULL THEN NULL ELSE
      to_jsonb(_job) || jsonb_build_object(
        'percent', CASE WHEN _job.total_estimate IS NOT NULL AND _job.total_estimate > 0
                        THEN LEAST(100, ROUND(100.0 * _job.vinculos_encontrados / _job.total_estimate))
                        ELSE NULL END,
        'produtos_verificados', _checked,
        'produtos_restantes', GREATEST(0, COALESCE(_job.total_estimate, _total_products) - _checked)
      ) END,
    'totals', (SELECT jsonb_build_object(
      'total_links', count(*),
      'active_links', count(*) FILTER (WHERE is_linked),
      'inactive_links', count(*) FILTER (WHERE NOT is_linked),
      'unmatched', count(*) FILTER (WHERE internal_product_id IS NULL AND is_linked),
      'distinct_stores', count(DISTINCT bling_store_id) FILTER (WHERE is_linked),
      'products_with_stores', _with,
      'total_products', _total_products,
      'products_without_stores', GREATEST(0, _total_products - _with),
      'last_run_checked_products', _checked,
      'last_imported', max(last_imported_at)
    ) FROM public.bling_product_stores WHERE company_id = _company_id),
    'channels', (SELECT count(*) FROM public.bling_stores WHERE company_id = _company_id)
  ) INTO _res;

  RETURN COALESCE(_res, '{}'::jsonb);
END; $function$;