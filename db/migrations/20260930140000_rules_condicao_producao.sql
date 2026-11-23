INSERT INTO public.validation_rules (company_id, slug, name, description, category, severity, active, config)
SELECT NULL, 'condicao-novo', 'Condição sempre Novo', 'A condição do produto deve ser sempre Novo.', 'cadastro', 'error', true, '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.validation_rules WHERE slug = 'condicao-novo' AND company_id IS NULL);
INSERT INTO public.validation_rules (company_id, slug, name, description, category, severity, active, config)
SELECT NULL, 'producao-terceiros', 'Produção sempre Terceiros', 'A produção do produto deve ser sempre Terceiros.', 'cadastro', 'error', true, '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.validation_rules WHERE slug = 'producao-terceiros' AND company_id IS NULL);

CREATE OR REPLACE FUNCTION public.run_audit_extra_rules(_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  _run public.audit_runs%ROWTYPE;
  _rule_slugs text[];
  _rules_count int := 0;
  _min_cd int := 7;
  _errors int := 0;
  _warnings int := 0;
  _passed int := 0;
BEGIN
  SELECT * INTO _run FROM public.audit_runs WHERE id = _run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'audit run not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _run.company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  IF _run.status = 'cancelada' THEN
    RETURN jsonb_build_object('cancelled', true);
  END IF;

  SELECT array_agg(slug), count(*) INTO _rule_slugs, _rules_count
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND active = true;
  IF _rule_slugs IS NULL THEN _rule_slugs := ARRAY[]::text[]; END IF;
  _rules_count := COALESCE(_rules_count, 0);

  IF NOT ('dimensoes-peso-obrigatorios' = ANY(_rule_slugs) OR 'crossdocking-minimo' = ANY(_rule_slugs) OR 'unidade-medida-centimetros' = ANY(_rule_slugs) OR 'condicao-novo' = ANY(_rule_slugs) OR 'producao-terceiros' = ANY(_rule_slugs)) THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;

  SELECT COALESCE((config->>'min_dias')::int, 7) INTO _min_cd
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'crossdocking-minimo' LIMIT 1;
  _min_cd := COALESCE(_min_cd, 7);

  CREATE TEMP TABLE _xprods ON COMMIT DROP AS
  SELECT p.id, p.peso_liquido, p.peso_bruto, p.largura, p.altura, p.profundidade,
         btrim(coalesce(p.cross_docking, '')) AS cross_docking,
         btrim(coalesce(p.unidade_medida, '')) AS unidade_medida,
         btrim(coalesce(p.condicao_produto, '')) AS condicao_produto,
         btrim(coalesce(p.tipo_producao, '')) AS tipo_producao
  FROM public.bling_products p
  WHERE p.company_id = _run.company_id
    AND (COALESCE(array_length(_run.product_ids, 1), 0) = 0 OR p.id = ANY(_run.product_ids))
    AND (_run.only_active IS NOT TRUE OR upper(btrim(coalesce(p.situacao,''))) LIKE 'A%');

  DELETE FROM public.audit_results ar
  USING _xprods p
  WHERE ar.product_id = p.id
    AND ar.rule_slug IN ('dimensoes-peso-obrigatorios', 'crossdocking-minimo', 'unidade-medida-centimetros', 'condicao-novo', 'producao-terceiros');

  INSERT INTO public.audit_results
    (run_id, company_id, product_id, rule_id, rule_slug, category, severity, status, message, details)
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'dimensoes-peso-obrigatorios' LIMIT 1),
    'dimensoes-peso-obrigatorios', 'dimensoes', 'error', 'error',
    'Peso e/ou dimensões ausentes ou zerados (peso, largura, altura, profundidade).',
    jsonb_build_object('autofix', true, 'peso_liquido', p.peso_liquido, 'largura', p.largura,
                       'altura', p.altura, 'profundidade', p.profundidade)
  FROM _xprods p
  WHERE 'dimensoes-peso-obrigatorios' = ANY(_rule_slugs)
    AND (COALESCE(p.peso_liquido, 0) <= 0
      OR COALESCE(p.largura, 0) <= 0
      OR COALESCE(p.altura, 0) <= 0
      OR COALESCE(p.profundidade, 0) <= 0)
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'crossdocking-minimo' LIMIT 1),
    'crossdocking-minimo', 'estoque', 'warning', 'warning',
    CASE WHEN p.cross_docking = '' THEN format('Crossdocking não preenchido (mínimo %s dias).', _min_cd)
         ELSE format('Crossdocking de %s dia(s) é menor que o mínimo de %s dias.', p.cross_docking, _min_cd) END,
    jsonb_build_object('autofix', true, 'expected', _min_cd)
  FROM _xprods p
  WHERE 'crossdocking-minimo' = ANY(_rule_slugs)
    AND COALESCE(NULLIF(substring(p.cross_docking from '^[0-9]+'), '')::int, 0) < _min_cd
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'unidade-medida-centimetros' LIMIT 1),
    'unidade-medida-centimetros', 'dimensoes', 'error', 'error',
    CASE WHEN p.unidade_medida = '' THEN 'Unidade de medida não preenchida; deve ser Centímetros.'
         ELSE format('Unidade de medida está em "%s"; deve ser Centímetros.', p.unidade_medida) END,
    jsonb_build_object('autofix', true)
  FROM _xprods p
  WHERE 'unidade-medida-centimetros' = ANY(_rule_slugs)
    AND NOT (lower(translate(p.unidade_medida,'íÍ','iI')) LIKE 'centimetro%' OR lower(p.unidade_medida) = 'cm')
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'condicao-novo' LIMIT 1),
    'condicao-novo', 'cadastro', 'error', 'error',
    CASE WHEN p.condicao_produto = '' THEN 'Condição não preenchida; deve ser Novo.'
         ELSE format('Condição está como "%s"; deve ser Novo.', p.condicao_produto) END,
    jsonb_build_object('autofix', true)
  FROM _xprods p
  WHERE 'condicao-novo' = ANY(_rule_slugs)
    AND upper(p.condicao_produto) NOT LIKE 'NOVO%'
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'producao-terceiros' LIMIT 1),
    'producao-terceiros', 'cadastro', 'error', 'error',
    CASE WHEN p.tipo_producao = '' THEN 'Produção não preenchida; deve ser Terceiros.'
         ELSE format('Produção está como "%s"; deve ser Terceiros.', p.tipo_producao) END,
    jsonb_build_object('autofix', true)
  FROM _xprods p
  WHERE 'producao-terceiros' = ANY(_rule_slugs)
    AND upper(p.tipo_producao) NOT LIKE 'T%';


  WITH agg AS (
    SELECT product_id,
      count(*) FILTER (WHERE status = 'error') AS errs,
      count(*) FILTER (WHERE status = 'warning') AS warns
    FROM public.audit_results WHERE run_id = _run_id
    GROUP BY product_id
  )
  UPDATE public.bling_products bp SET
    last_audit_at = now(),
    last_audit_errors = COALESCE(a.errs, 0),
    last_audit_warnings = COALESCE(a.warns, 0),
    last_audit_passed = GREATEST(_rules_count - COALESCE(a.errs, 0) - COALESCE(a.warns, 0), 0)
  FROM _xprods p
  LEFT JOIN agg a ON a.product_id = p.id
  WHERE bp.id = p.id;

  SELECT
    count(*) FILTER (WHERE errs > 0),
    count(*) FILTER (WHERE errs = 0 AND warns > 0),
    count(*) FILTER (WHERE errs = 0 AND warns = 0)
  INTO _errors, _warnings, _passed
  FROM (
    SELECT p.id, COALESCE(a.errs, 0) AS errs, COALESCE(a.warns, 0) AS warns
    FROM _xprods p
    LEFT JOIN (
      SELECT product_id,
        count(*) FILTER (WHERE status = 'error') AS errs,
        count(*) FILTER (WHERE status = 'warning') AS warns
      FROM public.audit_results WHERE run_id = _run_id
      GROUP BY product_id
    ) a ON a.product_id = p.id
  ) t;

  UPDATE public.audit_runs SET
    errors_count = COALESCE(_errors, 0),
    warnings_count = COALESCE(_warnings, 0),
    passed_count = COALESCE(_passed, 0)
  WHERE id = _run_id;

  RETURN jsonb_build_object('done', true, 'errors', COALESCE(_errors, 0),
                            'warnings', COALESCE(_warnings, 0), 'passed', COALESCE(_passed, 0));
END;
$function$

;
