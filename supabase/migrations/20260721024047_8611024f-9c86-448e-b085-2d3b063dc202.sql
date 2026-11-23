CREATE INDEX IF NOT EXISTS idx_audit_runs_company_status_created
  ON public.audit_runs (company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_results_run_rule_status_product
  ON public.audit_results (run_id, rule_slug, status, product_id);

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
  _rules_count int := 0;
  _min_desc int := 150;
  _max_titulo int := 60;
  _errors int := 0;
  _warnings int := 0;
  _passed int := 0;
  _total int := 0;
  _started_at timestamptz;
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
  IF _run.status = 'concluida' THEN
    RETURN jsonb_build_object(
      'done', true,
      'processed', COALESCE(_run.processed_products,0),
      'total', COALESCE(_run.total_products,0),
      'errors', COALESCE(_run.errors_count,0),
      'warnings', COALESCE(_run.warnings_count,0),
      'passed', COALESCE(_run.passed_count,0)
    );
  END IF;

  _started_at := COALESCE(_run.started_at, now());

  UPDATE public.audit_runs
    SET worker_pid = pg_backend_pid()
    WHERE id = _run_id;

  SELECT array_agg(slug), count(*) INTO _rule_slugs, _rules_count
  FROM public.validation_rules
  WHERE id = ANY(_run.rule_ids) AND active = true;
  IF _rule_slugs IS NULL THEN _rule_slugs := ARRAY[]::text[]; END IF;
  _rules_count := COALESCE(_rules_count, 0);

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
  FROM public.fornecedores;

  CREATE TEMP TABLE _rule_meta ON COMMIT DROP AS
  SELECT id, slug, category, severity
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids);

  -- Grava somente problemas. Resultados "pass" são refletidos nos contadores do produto/run,
  -- mas não ficam na tabela de detalhes para evitar centenas de milhares de linhas por auditoria.
  INSERT INTO public.audit_results
    (run_id, company_id, product_id, rule_id, rule_slug, category, severity, status, message, details)
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='titulo-maximo'),
    'titulo-maximo', 'conteudo', 'error', 'error',
    CASE WHEN char_length(p.nome) = 0 THEN 'Título vazio.'
         ELSE format('Título com %s caracteres (máximo %s).', char_length(p.nome), _max_titulo) END,
    NULL::jsonb
  FROM _prods p
  WHERE 'titulo-maximo' = ANY(_rule_slugs)
    AND (char_length(p.nome) = 0 OR char_length(p.nome) > _max_titulo)
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='descricao-curta-minima'),
    'descricao-curta-minima', 'conteudo', 'error', 'error',
    format('Descrição curta com %s caracteres (mínimo %s).', char_length(btrim(p.descricao_curta)), _min_desc),
    NULL
  FROM _prods p
  WHERE 'descricao-curta-minima' = ANY(_rule_slugs)
    AND char_length(btrim(p.descricao_curta)) < _min_desc
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='descricao-complementar-igual-nome'),
    'descricao-complementar-igual-nome', 'conteudo', 'error', 'error',
    CASE WHEN btrim(p.nome) = '' THEN 'Nome vazio.' ELSE 'Descrição complementar difere do nome (auto-corrigível).' END,
    CASE WHEN btrim(p.nome) <> '' AND btrim(p.nome) <> btrim(p.descricao_complementar)
         THEN jsonb_build_object('autofix', true, 'expected', btrim(p.nome)) ELSE NULL END
  FROM _prods p
  WHERE 'descricao-complementar-igual-nome' = ANY(_rule_slugs)
    AND (btrim(p.nome) = '' OR btrim(p.nome) <> btrim(p.descricao_complementar))
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='ean-obrigatorio'),
    'ean-obrigatorio', 'conteudo', 'error', 'error',
    'EAN/GTIN não preenchido.',
    NULL
  FROM _prods p
  WHERE 'ean-obrigatorio' = ANY(_rule_slugs)
    AND btrim(p.gtin) = ''
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='garantia-anatel-desc-complementar'),
    'garantia-anatel-desc-complementar', 'conteudo', 'error', 'error',
    CASE WHEN p.descricao_curta !~* 'garantia' AND p.descricao_curta !~* 'anatel'
           THEN 'Descrição curta não contém "Garantia" nem "Anatel".'
         WHEN p.descricao_curta !~* 'garantia'
           THEN 'Descrição curta não contém "Garantia".'
         ELSE 'Descrição curta não contém "Anatel".' END,
    NULL
  FROM _prods p
  WHERE 'garantia-anatel-desc-complementar' = ANY(_rule_slugs)
    AND NOT (p.descricao_curta ~* 'garantia' AND p.descricao_curta ~* 'anatel')
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='garantia-duplicada-desc-curta'),
    'garantia-duplicada-desc-curta', 'conteudo', 'error', 'error',
    format('Descrição curta contém a palavra "Garantia" %s vezes (máximo 1).', g.count_garantia),
    NULL
  FROM _prods p
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS count_garantia FROM regexp_matches(p.descricao_curta, 'garantia', 'gi')
  ) g
  WHERE 'garantia-duplicada-desc-curta' = ANY(_rule_slugs)
    AND g.count_garantia > 1
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='produto-em-fornecedor'),
    'produto-em-fornecedor', 'conteudo', 'error',
    CASE WHEN parsed.sku = '' THEN 'error'
         WHEN COALESCE(parsed.prefix,'') = '' THEN 'warning'
         WHEN map.sup_codigo IS NULL THEN 'warning'
         WHEN sup.sup_id IS NULL OR COALESCE(sup.sup_pc,0) = 0 THEN 'warning'
         WHEN COALESCE(parsed.numeric_code,'') = '' THEN 'error'
         ELSE 'error' END,
    CASE WHEN parsed.sku = '' THEN 'SKU vazio.'
         WHEN COALESCE(parsed.prefix,'') = '' THEN format('SKU "%s" fora do padrão esperado.', parsed.sku)
         WHEN map.sup_codigo IS NULL THEN format('Prefixo "%s" não está mapeado a um fornecedor conhecido.', parsed.prefix)
         WHEN sup.sup_id IS NULL OR COALESCE(sup.sup_pc,0) = 0
           THEN format('Base do fornecedor %s está vazia. Atualize o fornecedor antes de auditar.', COALESCE(sup.sup_nome, map.sup_codigo))
         WHEN COALESCE(parsed.numeric_code,'') = ''
           THEN format('SKU "%s" sem código após o prefixo %s.', parsed.sku, parsed.prefix)
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
  WHERE 'produto-em-fornecedor' = ANY(_rule_slugs)
    AND (parsed.sku = ''
      OR COALESCE(parsed.prefix,'') = ''
      OR map.sup_codigo IS NULL
      OR sup.sup_id IS NULL
      OR COALESCE(sup.sup_pc,0) = 0
      OR COALESCE(parsed.numeric_code,'') = ''
      OR fp.fp_id IS NULL);

  IF EXISTS (SELECT 1 FROM public.audit_runs WHERE id = _run_id AND status = 'cancelada') THEN
    DELETE FROM public.audit_results WHERE run_id = _run_id;
    RETURN jsonb_build_object('cancelled', true);
  END IF;

  WITH agg AS (
    SELECT product_id,
      count(*) FILTER (WHERE status='error') AS errs,
      count(*) FILTER (WHERE status='warning') AS warns
    FROM public.audit_results WHERE run_id = _run_id
    GROUP BY product_id
  )
  UPDATE public.bling_products bp SET
    last_audit_at = now(),
    last_audit_errors = COALESCE(a.errs, 0),
    last_audit_warnings = COALESCE(a.warns, 0),
    last_audit_passed = GREATEST(_rules_count - COALESCE(a.errs, 0) - COALESCE(a.warns, 0), 0)
  FROM _prods p
  LEFT JOIN agg a ON a.product_id = p.id
  WHERE bp.id = p.id;

  SELECT
    count(*) FILTER (WHERE COALESCE(errs,0) > 0),
    count(*) FILTER (WHERE COALESCE(errs,0) = 0 AND COALESCE(warns,0) > 0),
    count(*) FILTER (WHERE COALESCE(errs,0) = 0 AND COALESCE(warns,0) = 0)
  INTO _errors, _warnings, _passed
  FROM (
    SELECT p.id,
      COALESCE(a.errs, 0) AS errs,
      COALESCE(a.warns, 0) AS warns
    FROM _prods p
    LEFT JOIN (
      SELECT product_id,
        count(*) FILTER (WHERE status='error') AS errs,
        count(*) FILTER (WHERE status='warning') AS warns
      FROM public.audit_results WHERE run_id = _run_id
      GROUP BY product_id
    ) a ON a.product_id = p.id
  ) t;

  UPDATE public.audit_runs SET
    status = 'concluida',
    processed_products = _total,
    errors_count = COALESCE(_errors,0),
    warnings_count = COALESCE(_warnings,0),
    passed_count = COALESCE(_passed,0),
    finished_at = now(),
    duration_ms = (extract(epoch FROM (now() - _started_at)) * 1000)::int,
    worker_pid = NULL
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

CREATE OR REPLACE FUNCTION public.list_audit_issue_types_fast(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _run_id uuid;
  _issues jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT id INTO _run_id
  FROM public.audit_runs
  WHERE company_id = _company_id AND status = 'concluida'
  ORDER BY created_at DESC
  LIMIT 1;

  IF _run_id IS NULL THEN
    RETURN jsonb_build_object('run_id', NULL, 'issues', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY (x.error_count + x.warning_count) DESC), '[]'::jsonb)
  INTO _issues
  FROM (
    SELECT ar.rule_slug,
           COALESCE(vr.name, ar.rule_slug) AS name,
           ar.category,
           count(*) FILTER (WHERE ar.status = 'error')::int AS error_count,
           count(*) FILTER (WHERE ar.status = 'warning')::int AS warning_count
    FROM public.audit_results ar
    LEFT JOIN public.validation_rules vr ON vr.slug = ar.rule_slug AND vr.company_id IS NULL
    WHERE ar.company_id = _company_id
      AND ar.run_id = _run_id
      AND ar.status IN ('error','warning')
    GROUP BY ar.rule_slug, COALESCE(vr.name, ar.rule_slug), ar.category
  ) x;

  RETURN jsonb_build_object('run_id', _run_id, 'issues', COALESCE(_issues, '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_products_fast(
  _company_id uuid,
  _search text DEFAULT NULL,
  _situacao text DEFAULT NULL,
  _tipo text DEFAULT NULL,
  _detail_filter text DEFAULT 'all',
  _audit_rule_slug text DEFAULT NULL,
  _audit_status text DEFAULT 'any',
  _audit_run_id uuid DEFAULT NULL,
  _page int DEFAULT 1,
  _page_size int DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _offset int := GREATEST(COALESCE(_page, 1), 1) - 1;
  _rows jsonb;
  _count int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  _offset := _offset * LEAST(GREATEST(COALESCE(_page_size, 25), 1), 100);
  _page_size := LEAST(GREATEST(COALESCE(_page_size, 25), 1), 100);

  WITH filtered AS MATERIALIZED (
    SELECT p.id, p.bling_product_id, p.codigo, p.nome, p.tipo, p.formato, p.situacao,
           p.preco, p.preco_custo, p.gtin, p.imagem_principal_url, p.detail_synced,
           p.detail_synced_at, p.updated_at, p.marca, p.last_audit_errors,
           p.last_audit_warnings, p.last_audit_at
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_search IS NULL OR btrim(_search) = '' OR p.nome ILIKE '%' || btrim(_search) || '%' OR p.codigo ILIKE '%' || btrim(_search) || '%' OR p.gtin ILIKE '%' || btrim(_search) || '%')
      AND (_situacao IS NULL OR p.situacao = _situacao)
      AND (_tipo IS NULL OR p.tipo = _tipo)
      AND (COALESCE(_detail_filter, 'all') = 'all'
        OR (COALESCE(_detail_filter, 'all') = 'synced' AND p.detail_synced = true)
        OR (COALESCE(_detail_filter, 'all') = 'pending' AND p.detail_synced = false))
      AND (_audit_rule_slug IS NULL OR _audit_run_id IS NULL OR EXISTS (
        SELECT 1 FROM public.audit_results ar
        WHERE ar.product_id = p.id
          AND ar.run_id = _audit_run_id
          AND ar.rule_slug = _audit_rule_slug
          AND ((COALESCE(_audit_status, 'any') = 'any' AND ar.status IN ('error','warning')) OR ar.status = _audit_status)
      ))
  ), total AS (
    SELECT count(*)::int AS c FROM filtered
  ), page_rows AS (
    SELECT * FROM filtered
    ORDER BY nome ASC NULLS LAST, codigo ASC NULLS LAST, id ASC
    LIMIT _page_size OFFSET _offset
  )
  SELECT
    (SELECT c FROM total),
    COALESCE((SELECT jsonb_agg(to_jsonb(page_rows)) FROM page_rows), '[]'::jsonb)
  INTO _count, _rows;

  RETURN jsonb_build_object('rows', COALESCE(_rows, '[]'::jsonb), 'count', COALESCE(_count, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_product_ids_fast(
  _company_id uuid,
  _search text DEFAULT NULL,
  _situacao text DEFAULT NULL,
  _tipo text DEFAULT NULL,
  _detail_filter text DEFAULT 'all',
  _audit_rule_slug text DEFAULT NULL,
  _audit_status text DEFAULT 'any',
  _audit_run_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ids jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT COALESCE(jsonb_agg(p.id ORDER BY p.nome ASC NULLS LAST, p.codigo ASC NULLS LAST, p.id ASC), '[]'::jsonb)
  INTO _ids
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND (_search IS NULL OR btrim(_search) = '' OR p.nome ILIKE '%' || btrim(_search) || '%' OR p.codigo ILIKE '%' || btrim(_search) || '%' OR p.gtin ILIKE '%' || btrim(_search) || '%')
    AND (_situacao IS NULL OR p.situacao = _situacao)
    AND (_tipo IS NULL OR p.tipo = _tipo)
    AND (COALESCE(_detail_filter, 'all') = 'all'
      OR (COALESCE(_detail_filter, 'all') = 'synced' AND p.detail_synced = true)
      OR (COALESCE(_detail_filter, 'all') = 'pending' AND p.detail_synced = false))
    AND (_audit_rule_slug IS NULL OR _audit_run_id IS NULL OR EXISTS (
      SELECT 1 FROM public.audit_results ar
      WHERE ar.product_id = p.id
        AND ar.run_id = _audit_run_id
        AND ar.rule_slug = _audit_rule_slug
        AND ((COALESCE(_audit_status, 'any') = 'any' AND ar.status IN ('error','warning')) OR ar.status = _audit_status)
    ));

  RETURN jsonb_build_object('ids', COALESCE(_ids, '[]'::jsonb));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.run_audit_sql(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_audit_issue_types_fast(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_products_fast(uuid, text, text, text, text, text, text, uuid, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_product_ids_fast(uuid, text, text, text, text, text, text, uuid) TO authenticated;