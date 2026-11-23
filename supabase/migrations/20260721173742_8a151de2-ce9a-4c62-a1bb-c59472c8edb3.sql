
-- Insert new global rules (idempotent)
INSERT INTO public.validation_rules (slug, name, description, category, severity, config, active, company_id)
VALUES
  ('imagens-minimo', 'Mínimo de 3 imagens', 'O produto deve ter no mínimo 3 imagens.', 'imagens', 'error', '{"min":3}'::jsonb, true, NULL),
  ('imagens-maximo', 'Máximo de 18 imagens', 'O produto deve ter no máximo 18 imagens.', 'imagens', 'error', '{"max":18}'::jsonb, true, NULL),
  ('imagens-extensao', 'Extensão das imagens (.png/.jpg)', 'Todas as URLs de imagem devem terminar em .png, .jpg ou .jpeg.', 'imagens', 'error', '{}'::jsonb, true, NULL)
ON CONFLICT DO NOTHING;

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
  _min_imgs int := 3;
  _max_imgs int := 18;
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

  SELECT COALESCE((config->>'min')::int, 3) INTO _min_imgs
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'imagens-minimo' LIMIT 1;
  _min_imgs := COALESCE(_min_imgs, 3);

  SELECT COALESCE((config->>'max')::int, 18) INTO _max_imgs
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'imagens-maximo' LIMIT 1;
  _max_imgs := COALESCE(_max_imgs, 18);

  CREATE TEMP TABLE _prods ON COMMIT DROP AS
  SELECT p.id, btrim(coalesce(p.codigo,'')) AS codigo, coalesce(p.nome,'') AS nome,
         coalesce(p.descricao_curta,'') AS descricao_curta,
         coalesce(p.descricao_complementar,'') AS descricao_complementar,
         coalesce(p.gtin,'') AS gtin,
         coalesce(nullif(p.url_imagens_externas,''), p.imagem_principal_url, '') AS imgs_raw
  FROM public.bling_products p
  WHERE p.company_id = _run.company_id
    AND (COALESCE(array_length(_run.product_ids,1),0) = 0 OR p.id = ANY(_run.product_ids));

  SELECT count(*) INTO _total FROM _prods;

  -- Mantém apenas a auditoria mais recente por produto no detalhamento.
  DELETE FROM public.audit_results ar
  USING _prods p
  WHERE ar.product_id = p.id;

  CREATE TEMP TABLE _sup ON COMMIT DROP AS
  SELECT codigo, id, nome, COALESCE(product_count,0) AS product_count
  FROM public.fornecedores;

  CREATE TEMP TABLE _rule_meta ON COMMIT DROP AS
  SELECT id, slug, category, severity
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids);

  -- Prepara URLs de imagem por produto
  CREATE TEMP TABLE _prod_imgs ON COMMIT DROP AS
  SELECT p.id AS product_id,
         COALESCE(array_length(regexp_split_to_array(btrim(p.imgs_raw), '[|\n\r]+'), 1), 0) AS raw_count,
         (
           SELECT array_agg(u)
           FROM (
             SELECT btrim(x) AS u
             FROM unnest(regexp_split_to_array(btrim(p.imgs_raw), '[|\n\r]+')) AS x
             WHERE btrim(x) <> ''
           ) s
         ) AS urls
  FROM _prods p;

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
  -- imagens-minimo
  SELECT _run_id, _run.company_id, pi.product_id,
    (SELECT id FROM _rule_meta WHERE slug='imagens-minimo'),
    'imagens-minimo', 'imagens', 'error', 'error',
    format('Produto tem %s imagem(ns) (mínimo %s).', COALESCE(array_length(pi.urls,1),0), _min_imgs),
    NULL
  FROM _prod_imgs pi
  WHERE 'imagens-minimo' = ANY(_rule_slugs)
    AND COALESCE(array_length(pi.urls,1),0) < _min_imgs
  UNION ALL
  -- imagens-maximo
  SELECT _run_id, _run.company_id, pi.product_id,
    (SELECT id FROM _rule_meta WHERE slug='imagens-maximo'),
    'imagens-maximo', 'imagens', 'error', 'error',
    format('Produto tem %s imagens (máximo %s).', COALESCE(array_length(pi.urls,1),0), _max_imgs),
    NULL
  FROM _prod_imgs pi
  WHERE 'imagens-maximo' = ANY(_rule_slugs)
    AND COALESCE(array_length(pi.urls,1),0) > _max_imgs
  UNION ALL
  -- imagens-extensao
  SELECT _run_id, _run.company_id, pi.product_id,
    (SELECT id FROM _rule_meta WHERE slug='imagens-extensao'),
    'imagens-extensao', 'imagens', 'error', 'error',
    format('%s imagem(ns) sem extensão .png/.jpg.', bad.bad_count),
    jsonb_build_object('urls', bad.samples)
  FROM _prod_imgs pi
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS bad_count,
           COALESCE(jsonb_agg(u ORDER BY u) FILTER (WHERE u IS NOT NULL), '[]'::jsonb) AS samples
    FROM (
      SELECT u
      FROM unnest(COALESCE(pi.urls, ARRAY[]::text[])) AS u
      WHERE u !~* '\.(png|jpe?g)(\?|#|$)'
      LIMIT 5
    ) s
  ) bad
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS total_bad
    FROM unnest(COALESCE(pi.urls, ARRAY[]::text[])) AS u
    WHERE u !~* '\.(png|jpe?g)(\?|#|$)'
  ) tb
  WHERE 'imagens-extensao' = ANY(_rule_slugs)
    AND tb.total_bad > 0
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
