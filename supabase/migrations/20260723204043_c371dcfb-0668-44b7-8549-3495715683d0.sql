-- Fix 1000-row PostgREST cap on assisted transform RPCs by returning JSONB (single row).
DROP FUNCTION IF EXISTS public.transform_session_product_ids(UUID);
CREATE OR REPLACE FUNCTION public.transform_session_product_ids(_session_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(bp.id ORDER BY bp.updated_at DESC), '[]'::jsonb)
  FROM public.transform_sessions s
  JOIN public.bling_products bp ON bp.company_id = s.company_id
  WHERE s.id = _session_id
    AND app_private.is_company_member(s.company_id, auth.uid())
    AND bp.updated_at >= s.started_at
    AND bp.updated_at <= COALESCE(s.finished_at, now());
$$;
GRANT EXECUTE ON FUNCTION public.transform_session_product_ids(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.transform_session_products(UUID);
CREATE OR REPLACE FUNCTION public.transform_session_products(_session_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', bp.id, 'codigo', bp.codigo, 'nome', bp.nome,
    'preco', bp.preco, 'estoque', bp.estoque,
    'situacao', bp.situacao, 'updated_at', bp.updated_at
  ) ORDER BY bp.updated_at DESC), '[]'::jsonb)
  FROM public.transform_sessions s
  JOIN public.bling_products bp ON bp.company_id = s.company_id
  WHERE s.id = _session_id
    AND app_private.is_company_member(s.company_id, auth.uid())
    AND bp.updated_at >= s.started_at
    AND bp.updated_at <= COALESCE(s.finished_at, now());
$$;
GRANT EXECUTE ON FUNCTION public.transform_session_products(UUID) TO authenticated;