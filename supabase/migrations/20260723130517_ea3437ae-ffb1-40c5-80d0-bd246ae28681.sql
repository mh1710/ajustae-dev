
CREATE OR REPLACE FUNCTION public.get_bling_push_progress(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _res jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  SELECT jsonb_build_object(
    'total', count(*),
    'pendentes', count(*) FILTER (WHERE status IN ('pendente','processando')),
    'pausados', count(*) FILTER (WHERE status = 'pausado'),
    'concluidos', count(*) FILTER (WHERE status = 'concluido'),
    'erros', count(*) FILTER (WHERE status = 'erro'),
    'products_total', count(DISTINCT product_id),
    'products_done', count(DISTINCT product_id) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM public.bling_push_queue q2
        WHERE q2.company_id = _company_id
          AND q2.product_id = public.bling_push_queue.product_id
          AND q2.status IN ('pendente','processando','pausado')
      )
    ),
    'oldest_pending', min(created_at) FILTER (WHERE status IN ('pendente','processando')),
    'last_processed', max(updated_at) FILTER (WHERE status IN ('concluido','erro'))
  ) INTO _res FROM public.bling_push_queue WHERE company_id = _company_id;
  RETURN COALESCE(_res, '{}'::jsonb);
END; $function$;

CREATE OR REPLACE FUNCTION public.transform_session_products(_session_id UUID)
RETURNS TABLE(
  id UUID,
  codigo TEXT,
  nome TEXT,
  preco NUMERIC,
  estoque NUMERIC,
  situacao TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT bp.id, bp.codigo, bp.nome, bp.preco, bp.estoque, bp.situacao, bp.updated_at
  FROM public.transform_sessions s
  JOIN public.bling_products bp ON bp.company_id = s.company_id
  WHERE s.id = _session_id
    AND app_private.is_company_member(s.company_id, auth.uid())
    AND bp.updated_at >= s.started_at
    AND bp.updated_at <= COALESCE(s.finished_at, now())
  ORDER BY bp.updated_at DESC
$$;
GRANT EXECUTE ON FUNCTION public.transform_session_products(UUID) TO authenticated;
