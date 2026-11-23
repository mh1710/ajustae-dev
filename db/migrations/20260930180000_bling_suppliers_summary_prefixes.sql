CREATE OR REPLACE FUNCTION public.list_bling_suppliers_summary(_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _r jsonb;
BEGIN
  IF NOT app_private.is_company_member(_company_id, auth.uid()) THEN RAISE EXCEPTION 'not a member of company'; END IF;
  SELECT jsonb_build_object(
    'suppliers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('bling_supplier_id', m.bling_supplier_id, 'nome', m.nome,
               'supplier_codigo', m.supplier_codigo,
               'products', (SELECT count(DISTINCT s.bling_product_id) FROM public.bling_product_suppliers s
                            WHERE s.company_id = _company_id AND s.bling_supplier_id = m.bling_supplier_id),
               'prefixes', COALESCE((SELECT jsonb_agg(jsonb_build_object('prefix', x.pfx, 'count', x.n) ORDER BY x.n DESC)
                  FROM (SELECT COALESCE(upper(substring(p.codigo from '^[A-Za-z]+')), '(sem prefixo)') pfx, count(*) n
                        FROM public.bling_product_suppliers s JOIN public.bling_products p ON p.id = s.product_id
                        WHERE s.company_id = _company_id AND s.bling_supplier_id = m.bling_supplier_id
                        GROUP BY 1) x), '[]'::jsonb))
             ORDER BY m.nome NULLS LAST)
      FROM public.bling_supplier_map m WHERE m.company_id = _company_id), '[]'::jsonb),
    'total_products', (SELECT count(*) FROM public.bling_products WHERE company_id = _company_id),
    'with_supplier', (SELECT count(*) FROM public.bling_products p WHERE p.company_id = _company_id
                        AND EXISTS (SELECT 1 FROM public.bling_product_suppliers s WHERE s.company_id = _company_id AND s.product_id = p.id)),
    'job', (SELECT to_jsonb(j) FROM public.bling_supplier_sync_jobs j WHERE j.company_id = _company_id ORDER BY created_at DESC LIMIT 1)
  ) INTO _r;
  RETURN _r;
END $function$;
NOTIFY pgrst, 'reload schema';
