
-- 1) Sessions table for "Transformação Assistida"
CREATE TABLE public.transform_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'Transformação',
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transform_sessions_status_check CHECK (status IN ('active','finished','cancelled'))
);
CREATE INDEX transform_sessions_company_idx ON public.transform_sessions(company_id, started_at DESC);
CREATE UNIQUE INDEX transform_sessions_one_active
  ON public.transform_sessions(company_id, user_id) WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transform_sessions TO authenticated;
GRANT ALL ON public.transform_sessions TO service_role;
ALTER TABLE public.transform_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions_select_members" ON public.transform_sessions FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));
CREATE POLICY "sessions_insert_members" ON public.transform_sessions FOR INSERT TO authenticated
  WITH CHECK (app_private.is_company_member(company_id, auth.uid()) AND user_id = auth.uid());
CREATE POLICY "sessions_update_members" ON public.transform_sessions FOR UPDATE TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()) AND user_id = auth.uid());
CREATE POLICY "sessions_delete_members" ON public.transform_sessions FOR DELETE TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()) AND user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER transform_sessions_updated_at BEFORE UPDATE ON public.transform_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) List product ids modified during a session window
CREATE OR REPLACE FUNCTION public.transform_session_product_ids(_session_id UUID)
RETURNS TABLE(id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT bp.id
  FROM public.transform_sessions s
  JOIN public.bling_products bp ON bp.company_id = s.company_id
  WHERE s.id = _session_id
    AND app_private.is_company_member(s.company_id, auth.uid())
    AND bp.updated_at >= s.started_at
    AND bp.updated_at <= COALESCE(s.finished_at, now())
  ORDER BY bp.updated_at DESC
$$;
GRANT EXECUTE ON FUNCTION public.transform_session_product_ids(UUID) TO authenticated;

-- 3) Consolidated dashboard stats (removes N round-trips + in-memory paging)
CREATE OR REPLACE FUNCTION public.dashboard_stats(_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  IF NOT app_private.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.';
  END IF;

  WITH prods AS (
    SELECT last_audit_errors, last_audit_warnings, last_audit_at, categoria_produto
    FROM public.bling_products WHERE company_id = _company_id
  ),
  agg AS (
    SELECT
      count(*) AS total_products,
      count(*) FILTER (WHERE last_audit_errors > 0) AS com_erro,
      count(*) FILTER (WHERE last_audit_errors = 0 AND last_audit_warnings > 0) AS com_aviso,
      count(*) FILTER (WHERE last_audit_errors = 0 AND last_audit_warnings = 0 AND last_audit_at IS NOT NULL) AS sem_erro,
      count(*) FILTER (WHERE last_audit_at IS NOT NULL) AS auditados
    FROM prods
  ),
  cats AS (
    SELECT COALESCE(NULLIF(TRIM(categoria_produto), ''), '(sem categoria)') AS name, count(*) AS value
    FROM prods GROUP BY 1 ORDER BY count(*) DESC LIMIT 10
  ),
  rules AS (
    SELECT count(*) AS n FROM public.validation_rules
    WHERE company_id IS NULL OR company_id = _company_id
  ),
  runs AS (
    SELECT count(*) AS n FROM public.audit_runs WHERE company_id = _company_id
  )
  SELECT jsonb_build_object(
    'totalProducts', agg.total_products,
    'totalRules', rules.n,
    'totalRuns', runs.n,
    'comErro', agg.com_erro,
    'comAviso', agg.com_aviso,
    'semErro', agg.sem_erro,
    'naoAuditados', GREATEST(0, agg.total_products - agg.auditados),
    'categorias', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'value', value)) FROM cats), '[]'::jsonb)
  ) INTO result
  FROM agg, rules, runs;

  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dashboard_stats(UUID) TO authenticated;

-- 4) Index to speed the session window filter and dashboard category scan
CREATE INDEX IF NOT EXISTS bling_products_company_updated_idx
  ON public.bling_products(company_id, updated_at DESC);
