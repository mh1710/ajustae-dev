
-- Insert the new "garantia duplicada" rule for every company that has rules configured
INSERT INTO public.validation_rules (company_id, slug, name, description, category, severity, active, config)
SELECT DISTINCT c.id, 'garantia-duplicada-desc-curta',
  'Descrição curta não pode ter "Garantia" duplicado',
  'A descrição curta não pode conter a palavra "Garantia" mais de uma vez (case-insensitive: Garantia, GARANTIA, garantia).',
  'conteudo', 'error', true, '{}'::jsonb
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.validation_rules vr
  WHERE vr.company_id = c.id AND vr.slug = 'garantia-duplicada-desc-curta'
);

-- Recreate run_audit_sql with the new rule included
CREATE OR REPLACE FUNCTION public.run_audit_sql(_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  _run public.audit_runs%ROWTYPE;
  _rule_slugs text[];
  _min_desc int := 150;
  _max_titulo int := 60;
  _errors int := 0;
  _warnings int := 0;
  _passed int := 0;
  _total int := 0;
  _started_at timestamptz;
BEGIN
  SELECT * INTO _run FROM public.audit_runs WHERE id = _run_id FOR UPDATE;
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

  _started_at := COALESCE(_run.started_at, now());

  SELECT array_agg(slug) INTO _rule_slugs
  FROM public.validation_rules
  WHERE id = ANY(_run.rule_ids) AND active = true;
  IF _rule_slugs IS NULL THEN _rule_slugs := ARRAY[]::text[]; END IF;

  SELECT COALESCE((config->>'max')::int, 60) INTO _max_titulo
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'titulo-maximo' LIMIT 1;
  _max_titulo := COALESCE(_max_titulo, 60);

  SELECT COALESCE((config->>'min')::int, 150) INTO _min_desc
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'descricao-curta-minima' LIMIT 1;
  _min_desc := COALESCE(_min_desc, 150);

  DELETE FROM public.audit_results WHERE run_id = _run_id;

  CREATE TEMP TABLE _prods ON COMMIT DROP AS
  SELECT p.id, btrim(coalesce(p.codigo,'')) AS codigo, coalesce(p.nome,'') AS nome,
         coalesce(p.descricao_curta,'') AS descricao_curta,
         coalesce(p.descricao_complementar,'') AS descricao_complementar,
         coalesce(p.gtin,'') AS gtin
  FROM public.bling_products p
  WHERE p.company_id = _run.company_id
    AND (COALESCE(array_length(_run.product_ids,1),0) = 0 OR p.id = ANY(_run.product_ids));

  SELECT count(*) INTO _total FROM _prods;

  CREATE TEMP TABLE _sup ON COMMIT DROP AS
  SELECT codigo, id, nome, COALESCE(product_count,0) AS product_count
  FROM public.fornecedores WHERE company_id = _run.company_id;

  CREATE TEMP TABLE _rule_meta ON COMMIT DROP AS
  SELECT id, slug, category, severity
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids);

  INSERT INTO public.audit_results
    (run_id, company_id, product_id, rule_id, rule_slug, category, severity, status, message, details)
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='titulo-maximo'),
    'titulo-maximo', 'conteudo', 'error',
    CASE WHEN char_length(p.nome) = 0 THEN 'error'
         WHEN char_length(p.nome) > _max_titulo THEN 'error'
         ELSE 'pass' END,
    CASE WHEN char_length(p.nome) = 0 THEN 'Título vazio.'
         WHEN char_length(p.nome) > _max_titulo THEN format('Título com %s caracteres (máximo %s).', char_length(p.nome), _max_titulo)
         ELSE NULL END,
    NULL::jsonb
  FROM _prods p WHERE 'titulo-maximo' = ANY(_rule_slugs)
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='descricao-curta-minima'),
    'descricao-curta-minima', 'conteudo', 'error',
    CASE WHEN char_length(btrim(p.descricao_curta)) >= _min_desc THEN 'pass' ELSE 'error' END,
    CASE WHEN char_length(btrim(p.descricao_curta)) >= _min_desc THEN NULL
         ELSE format('Descrição curta com %s caracteres (mínimo %s).', char_length(btrim(p.descricao_curta)), _min_desc) END,
    NULL
  FROM _prods p WHERE 'descricao-curta-minima' = ANY(_rule_slugs)
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='descricao-complementar-igual-nome'),
    'descricao-complementar-igual-nome', 'conteudo', 'error',
    CASE WHEN btrim(p.nome) = '' THEN 'error'
         WHEN btrim(p.nome) = btrim(p.descricao_complementar) THEN 'pass'
         ELSE 'error' END,
    CASE WHEN btrim(p.nome) = '' THEN 'Nome vazio.'
         WHEN btrim(p.nome) = btrim(p.descricao_complementar) THEN NULL
         ELSE 'Descrição complementar difere do nome (auto-corrigível).' END,
    CASE WHEN btrim(p.nome) <> '' AND btrim(p.nome) <> btrim(p.descricao_complementar)
         THEN jsonb_build_object('autofix', true, 'expected', btrim(p.nome)) ELSE NULL END
  FROM _prods p WHERE 'descricao-complementar-igual-nome' = ANY(_rule_slugs)
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='ean-obrigatorio'),
    'ean-obrigatorio', 'conteudo', 'warning',
    CASE WHEN char_length(btrim(p.gtin)) > 0 THEN 'pass' ELSE 'warning' END,
    CASE WHEN char_length(btrim(p.gtin)) > 0 THEN NULL ELSE 'GTIN/EAN não informado.' END,
    NULL
  FROM _prods p WHERE 'ean-obrigatorio' = ANY(_rule_slugs)
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='garantia-anatel-desc-complementar'),
    'garantia-anatel-desc-complementar', 'conteudo', 'error',
    CASE WHEN p.descricao_curta ~* 'garantia' AND p.descricao_curta ~* 'anatel' THEN 'pass'
         ELSE 'error' END,
    CASE WHEN p.descricao_curta ~* 'garantia' AND p.descricao_curta ~* 'anatel' THEN NULL
         WHEN p.descricao_curta !~* 'garantia' AND p.descricao_curta !~* 'anatel'
           THEN 'Descrição curta não contém "Garantia" nem "Anatel".'
         WHEN p.descricao_curta !~* 'garantia'
           THEN 'Descrição curta não contém "Garantia".'
         ELSE 'Descrição curta não contém "Anatel".' END,
    NULL
  FROM _prods p WHERE 'garantia-anatel-desc-complementar' = ANY(_rule_slugs)
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='garantia-duplicada-desc-curta'),
    'garantia-duplicada-desc-curta', 'conteudo', 'error',
    CASE WHEN (
      SELECT count(*) FROM regexp_matches(p.descricao_curta, 'garantia', 'gi')
    ) > 1 THEN 'error' ELSE 'pass' END,
    CASE WHEN (
      SELECT count(*) FROM regexp_matches(p.descricao_curta, 'garantia', 'gi')
    ) > 1 THEN format('Descrição curta contém a palavra "Garantia" %s vezes (máximo 1).',
      (SELECT count(*) FROM regexp_matches(p.descricao_curta, 'garantia', 'gi')))
    ELSE NULL END,
    NULL
  FROM _prods p WHERE 'garantia-duplicada-desc-curta' = ANY(_rule_slugs)
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='produto-em-fornecedor'),
    'produto-em-fornecedor', 'conteudo', 'error',
    CASE WHEN parsed.sku = '' THEN 'error'
         WHEN COALESCE(parsed.prefix,'') = '' THEN 'warning'
         WHEN map.sup_codigo IS NULL THEN 'warning'
         WHEN sup.sup_id IS NULL OR COALESCE(sup.sup_pc,0) = 0 THEN 'warning'
         WHEN COALESCE(parsed.numeric_code,'') = '' THEN 'error'
         WHEN fp.fp_id IS NOT NULL THEN 'pass'
         ELSE 'error' END,
    CASE WHEN parsed.sku = '' THEN 'SKU vazio.'
         WHEN COALESCE(parsed.prefix,'') = '' THEN format('SKU "%s" fora do padrão esperado.', parsed.sku)
         WHEN map.sup_codigo IS NULL THEN format('Prefixo "%s" não está mapeado a um fornecedor conhecido.', parsed.prefix)
         WHEN sup.sup_id IS NULL OR COALESCE(sup.sup_pc,0) = 0
           THEN format('Base do fornecedor %s está vazia. Atualize o fornecedor antes de auditar.', COALESCE(sup.sup_nome, map.sup_codigo))
         WHEN COALESCE(parsed.numeric_code,'') = ''
           THEN format('SKU "%s" sem código após o prefixo %s.', parsed.sku, parsed.prefix)
         WHEN fp.fp_id IS NOT NULL THEN NULL
         ELSE format('Código %s não foi encontrado na base do fornecedor %s.', parsed.numeric_code, COALESCE(sup.sup_nome, map.sup_codigo)) END,
    NULL
  FROM _prods p
  CROSS JOIN LATERAL (
    SELECT p.codigo AS sku,
      upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix,
      btrim(substring(p.codigo from '^[A-Za-z]+(.*)$')) AS numeric_code
  ) parsed
  CROSS JOIN LATERAL (
    SELECT CASE parsed.prefix
      WHEN 'ODS' THEN 'oderco' WHEN 'O' THEN 'oderco'
      WHEN 'HX' THEN 'hayamax' WHEN 'HA' THEN 'hayamax'
      WHEN 'EV' THEN 'evolusom' WHEN 'E' THEN 'evolusom'
      ELSE NULL END AS sup_codigo
  ) map
  LEFT JOIN LATERAL (
    SELECT s.id AS sup_id, s.nome AS sup_nome, s.product_count AS sup_pc
    FROM _sup s WHERE s.codigo = map.sup_codigo LIMIT 1
  ) sup ON true
  LEFT JOIN LATERAL (
    SELECT fp0.id AS fp_id FROM public.fornecedor_produtos fp0
    WHERE fp0.fornecedor_id = sup.sup_id
      AND btrim(fp0.codigo) = parsed.numeric_code
    LIMIT 1
  ) fp ON true
  WHERE 'produto-em-fornecedor' = ANY(_rule_slugs);

  WITH agg AS (
    SELECT product_id,
      count(*) FILTER (WHERE status='pass') AS passed,
      count(*) FILTER (WHERE status='error') AS errs,
      count(*) FILTER (WHERE status='warning') AS warns
    FROM public.audit_results WHERE run_id = _run_id
    GROUP BY product_id
  )
  UPDATE public.bling_products bp SET
    last_audit_at = now(),
    last_audit_passed = a.passed,
    last_audit_errors = a.errs,
    last_audit_warnings = a.warns
  FROM agg a WHERE a.product_id = bp.id;

  SELECT
    count(*) FILTER (WHERE errs > 0),
    count(*) FILTER (WHERE errs = 0 AND warns > 0),
    count(*) FILTER (WHERE errs = 0 AND warns = 0)
  INTO _errors, _warnings, _passed
  FROM (
    SELECT product_id,
      count(*) FILTER (WHERE status='error') AS errs,
      count(*) FILTER (WHERE status='warning') AS warns
    FROM public.audit_results WHERE run_id = _run_id
    GROUP BY product_id
  ) t;

  UPDATE public.audit_runs SET
    status = 'concluida',
    processed_products = _total,
    errors_count = COALESCE(_errors,0),
    warnings_count = COALESCE(_warnings,0),
    passed_count = COALESCE(_passed,0),
    finished_at = now(),
    duration_ms = (extract(epoch FROM (now() - _started_at)) * 1000)::int
  WHERE id = _run_id AND status = 'processando';

  RETURN jsonb_build_object(
    'done', true,
    'processed', _total,
    'total', _total,
    'errors', COALESCE(_errors,0),
    'warnings', COALESCE(_warnings,0),
    'passed', COALESCE(_passed,0)
  );
END;
$function$;
