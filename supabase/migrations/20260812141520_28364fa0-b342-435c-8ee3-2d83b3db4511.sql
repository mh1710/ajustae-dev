DROP FUNCTION IF EXISTS public.transform_session_product_ids(UUID);
CREATE OR REPLACE FUNCTION public.transform_session_product_ids(_session_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH s AS (
    SELECT id, company_id, started_at, COALESCE(finished_at, now()) AS ended_at
    FROM public.transform_sessions
    WHERE id = _session_id
      AND app_private.is_company_member(company_id, auth.uid())
  ),
  base AS (
    SELECT bp.id, bp.updated_at AS ts
    FROM s JOIN public.bling_products bp ON bp.company_id = s.company_id
    WHERE bp.updated_at >= s.started_at AND bp.updated_at <= s.ended_at
    UNION
    SELECT ps.internal_product_id AS id, ps.updated_at AS ts
    FROM s JOIN public.bling_product_stores ps ON ps.company_id = s.company_id
    WHERE ps.internal_product_id IS NOT NULL
      AND ps.updated_at >= s.started_at AND ps.updated_at <= s.ended_at
  )
  SELECT COALESCE(jsonb_agg(id ORDER BY ts DESC), '[]'::jsonb)
  FROM (SELECT id, MAX(ts) AS ts FROM base GROUP BY id) d;
$$;
GRANT EXECUTE ON FUNCTION public.transform_session_product_ids(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.transform_session_products(UUID);
CREATE OR REPLACE FUNCTION public.transform_session_products(_session_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH s AS (
    SELECT id, company_id, started_at, COALESCE(finished_at, now()) AS ended_at
    FROM public.transform_sessions
    WHERE id = _session_id
      AND app_private.is_company_member(company_id, auth.uid())
  ),
  stores AS (
    SELECT ps.internal_product_id AS pid,
           COUNT(*)::int AS lojas_alteradas,
           MAX(ps.updated_at) AS ts
    FROM s JOIN public.bling_product_stores ps ON ps.company_id = s.company_id
    WHERE ps.internal_product_id IS NOT NULL
      AND ps.updated_at >= s.started_at AND ps.updated_at <= s.ended_at
    GROUP BY ps.internal_product_id
  ),
  prods AS (
    SELECT bp.id AS pid, bp.updated_at AS ts
    FROM s JOIN public.bling_products bp ON bp.company_id = s.company_id
    WHERE bp.updated_at >= s.started_at AND bp.updated_at <= s.ended_at
  ),
  ids AS (
    SELECT pid, MAX(ts) AS ts FROM (
      SELECT pid, ts FROM prods
      UNION ALL
      SELECT pid, ts FROM stores
    ) u GROUP BY pid
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', bp.id, 'codigo', bp.codigo, 'nome', bp.nome,
    'preco', bp.preco, 'estoque', bp.estoque,
    'situacao', bp.situacao,
    'updated_at', i.ts,
    'lojas_alteradas', COALESCE(st.lojas_alteradas, 0)
  ) ORDER BY i.ts DESC), '[]'::jsonb)
  FROM ids i
  JOIN public.bling_products bp ON bp.id = i.pid
  LEFT JOIN stores st ON st.pid = i.pid;
$$;
GRANT EXECUTE ON FUNCTION public.transform_session_products(UUID) TO authenticated;