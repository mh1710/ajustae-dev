CREATE TABLE IF NOT EXISTS public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  slug text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  current_step text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_runs TO authenticated;
GRANT ALL ON public.automation_runs TO service_role;

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members manage automation runs"
ON public.automation_runs FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = automation_runs.company_id AND cu.user_id = auth.uid() AND cu.ativo = true))
WITH CHECK (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = automation_runs.company_id AND cu.user_id = auth.uid() AND cu.ativo = true));

CREATE INDEX IF NOT EXISTS automation_runs_company_created_idx ON public.automation_runs (company_id, created_at DESC);

DROP TRIGGER IF EXISTS automation_runs_set_updated_at ON public.automation_runs;
CREATE TRIGGER automation_runs_set_updated_at
BEFORE UPDATE ON public.automation_runs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.automation_apply_supplier_status(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '300s'
AS $function$
DECLARE
  _inact uuid[] := '{}';
  _act uuid[] := '{}';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  CREATE TEMP TABLE _tmp_status ON COMMIT DROP AS
  WITH alvo AS (
    SELECT p.id, p.situacao,
           upper(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+')) AS prefix,
           btrim(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
  ),
  mapped AS (
    SELECT a.*, CASE a.prefix
      WHEN 'ODS' THEN 'oderco' WHEN 'O' THEN 'oderco'
      WHEN 'HX' THEN 'hayamax' WHEN 'HA' THEN 'hayamax'
      WHEN 'EV' THEN 'evolusom' WHEN 'E' THEN 'evolusom'
      ELSE NULL END AS sup_codigo
    FROM alvo a
  )
  SELECT m.id,
         upper(btrim(coalesce(m.situacao, ''))) AS sit,
         fp.id IS NOT NULL AS tem_fornecedor,
         COALESCE(fp.qt_estoque, 0) AS qt_estoque
  FROM mapped m
  LEFT JOIN public.fornecedores f ON f.codigo = m.sup_codigo
    AND (f.company_id IS NULL OR f.company_id = _company_id)
  LEFT JOIN public.fornecedor_produtos fp ON fp.fornecedor_id = f.id
    AND btrim(fp.codigo) = m.num_code;

  WITH upd AS (
    UPDATE public.bling_products bp
    SET situacao = 'I', dirty = true, updated_at = now()
    FROM _tmp_status t
    WHERE bp.id = t.id
      AND t.tem_fornecedor = false
      AND t.sit NOT IN ('I', 'INATIVO')
    RETURNING bp.id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO _inact FROM upd;

  WITH upd2 AS (
    UPDATE public.bling_products bp
    SET situacao = 'A', dirty = true, updated_at = now()
    FROM _tmp_status t
    WHERE bp.id = t.id
      AND t.tem_fornecedor = true
      AND t.qt_estoque > 0
      AND t.sit NOT IN ('A', 'ATIVO')
    RETURNING bp.id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO _act FROM upd2;

  RETURN jsonb_build_object(
    'inactivated', COALESCE(array_length(_inact, 1), 0),
    'activated', COALESCE(array_length(_act, 1), 0),
    'inactivate_ids', to_jsonb(_inact),
    'activate_ids', to_jsonb(_act)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.automation_apply_supplier_status(uuid) TO authenticated;