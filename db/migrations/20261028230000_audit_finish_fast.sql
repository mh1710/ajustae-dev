-- Etapa final da auditoria: regra de fotos inválidas passa a ser uma consulta única
-- (antes varria o cache de fotos por produto, ~7 min por empresa), tabelas temporárias
-- analisadas e até 4 etapas finais em paralelo.

CREATE OR REPLACE FUNCTION public.run_audit_sql(_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
 SET lock_timeout TO '20s'
AS $function$
DECLARE
  _run public.audit_runs%ROWTYPE;
  _rule_slugs text[];
  _rules_count int := 0;
  _min_desc int := 150;
  _max_titulo int := 60;
  _min_imgs int := 3;
  _max_imgs int := 18;
  _min_margin numeric := 10;
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

  SELECT COALESCE((config->>'min_percent')::numeric, 10) INTO _min_margin
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'margem-minima' LIMIT 1;
  _min_margin := COALESCE(_min_margin, 10);

  CREATE TEMP TABLE _prods ON COMMIT DROP AS
  SELECT p.id, btrim(coalesce(p.codigo,'')) AS codigo, coalesce(p.nome,'') AS nome,
         coalesce(p.descricao_curta,'') AS descricao_curta,
         coalesce(p.descricao_complementar,'') AS descricao_complementar,
         coalesce(p.gtin,'') AS gtin,
         p.preco AS preco,
         p.preco_custo AS preco_custo,
         coalesce(nullif(p.url_imagens_externas,''), p.imagem_principal_url, '') AS imgs_raw
  FROM public.bling_products p
  WHERE p.company_id = _run.company_id
    AND (COALESCE(array_length(_run.product_ids,1),0) = 0 OR p.id = ANY(_run.product_ids))
    AND (_run.only_active IS NOT TRUE OR upper(btrim(coalesce(p.situacao,''))) LIKE 'A%');
  ANALYZE _prods;

  SELECT count(*) INTO _total FROM _prods;

  -- Limpa apenas resultados de execucoes iniciadas ANTES desta: uma auditoria
  -- antiga que termine depois nao apaga os resultados de uma mais nova.
  DELETE FROM public.audit_results ar
  USING _prods p
  WHERE ar.product_id = p.id
    AND ar.run_id <> _run_id
    AND EXISTS (
      SELECT 1 FROM public.audit_runs older
      WHERE older.id = ar.run_id
        AND older.started_at < _started_at
    );

  CREATE TEMP TABLE _sup ON COMMIT DROP AS
  SELECT codigo, id, nome, COALESCE(product_count,0) AS product_count
  FROM public.fornecedores;

  CREATE TEMP TABLE _rule_meta ON COMMIT DROP AS
  SELECT id, slug, category, severity
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids);

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
    (
      'Descrição curta não contém ' ||
      array_to_string(
        array_remove(ARRAY[
          CASE WHEN COALESCE(p.descricao_curta,'') !~* 'garantia' THEN '"Garantia"' END,
          CASE WHEN COALESCE(p.descricao_curta,'') !~* 'anatel'   THEN '"Anatel"'   END,
          CASE WHEN COALESCE(p.descricao_curta,'') !~* 'anvisa'   THEN '"Anvisa"'   END
        ], NULL), ' nem ') || '.'
    ),
    NULL
  FROM _prods p
  WHERE 'garantia-anatel-desc-complementar' = ANY(_rule_slugs)
    AND NOT (COALESCE(p.descricao_curta,'') ~* 'garantia' AND COALESCE(p.descricao_curta,'') ~* 'anatel' AND COALESCE(p.descricao_curta,'') ~* 'anvisa')
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
  -- margem-minima (avalia o preco base e o preco de cada loja vinculada)
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM _rule_meta WHERE slug='margem-minima'),
    'margem-minima', 'preco', 'error', 'error',
    format(
      'Preço R$ %s%s não atinge o mínimo R$ %s (custo R$ %s + %s%%).',
      to_char(w.pior_preco, 'FM999999990.00'),
      CASE WHEN w.loja IS NOT NULL THEN ' na loja ' || w.loja ELSE '' END,
      to_char(p.preco_custo * (1 + _min_margin/100.0), 'FM999999990.00'),
      to_char(p.preco_custo, 'FM999999990.00'),
      to_char(_min_margin, 'FM999990.##')
    ),
    jsonb_build_object('loja', w.loja, 'preco_avaliado', w.pior_preco)
  FROM _prods p
  CROSS JOIN LATERAL (
    SELECT x.preco AS pior_preco, x.loja
    FROM (
      SELECT p.preco AS preco, NULL::text AS loja
      UNION ALL
      SELECT COALESCE(bps.current_promotional_price, bps.current_price) AS preco,
             COALESCE(bs.descricao, bps.store_name, 'Loja ' || bps.bling_store_id) AS loja
      FROM public.bling_product_stores bps
      LEFT JOIN public.bling_stores bs
        ON bs.bling_store_id = bps.bling_store_id AND bs.company_id = _run.company_id
      WHERE bps.internal_product_id = p.id
        AND bps.company_id = _run.company_id
        AND COALESCE(bps.is_linked, true) = true
    ) x
    WHERE x.preco IS NOT NULL AND x.preco > 0
    ORDER BY x.preco ASC
    LIMIT 1
  ) w
  WHERE 'margem-minima' = ANY(_rule_slugs)
    AND p.preco_custo IS NOT NULL
    AND p.preco_custo > 0
    AND w.pior_preco < p.preco_custo * (1 + _min_margin/100.0)
  UNION ALL
  SELECT _run_id, _run.company_id, pi.product_id,
    (SELECT id FROM _rule_meta WHERE slug='imagens-minimo'),
    'imagens-minimo', 'imagens', 'error', 'error',
    format('Produto tem %s imagem(ns) (mínimo %s).', COALESCE(array_length(pi.urls,1),0), _min_imgs),
    NULL
  FROM _prod_imgs pi
  WHERE 'imagens-minimo' = ANY(_rule_slugs)
    AND COALESCE(array_length(pi.urls,1),0) < _min_imgs
  UNION ALL
  SELECT _run_id, _run.company_id, pi.product_id,
    (SELECT id FROM _rule_meta WHERE slug='imagens-maximo'),
    'imagens-maximo', 'imagens', 'error', 'error',
    format('Produto tem %s imagens (máximo %s).', COALESCE(array_length(pi.urls,1),0), _max_imgs),
    NULL
  FROM _prod_imgs pi
  WHERE 'imagens-maximo' = ANY(_rule_slugs)
    AND COALESCE(array_length(pi.urls,1),0) > _max_imgs
  UNION ALL
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
    SELECT public.map_supplier_prefix(parsed.prefix) AS sup_codigo
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
  WHERE bp.id = p.id
    AND (bp.last_audit_errors IS DISTINCT FROM COALESCE(a.errs, 0)
      OR bp.last_audit_warnings IS DISTINCT FROM COALESCE(a.warns, 0)
      OR bp.last_audit_passed IS DISTINCT FROM GREATEST(_rules_count - COALESCE(a.errs, 0) - COALESCE(a.warns, 0), 0));

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

CREATE OR REPLACE FUNCTION public.run_audit_extra_rules(_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
 SET lock_timeout TO '20s'
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

  IF NOT ('dimensoes-peso-obrigatorios' = ANY(_rule_slugs) OR 'crossdocking-minimo' = ANY(_rule_slugs) OR 'unidade-medida-centimetros' = ANY(_rule_slugs) OR 'condicao-novo' = ANY(_rule_slugs) OR 'producao-terceiros' = ANY(_rule_slugs) OR 'fornecedor-vinculado' = ANY(_rule_slugs) OR 'ncm-obrigatorio' = ANY(_rule_slugs) OR 'imagem-placeholder' = ANY(_rule_slugs) OR 'marca-obrigatoria' = ANY(_rule_slugs)) THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;

  SELECT COALESCE((config->>'min_dias')::int, 7) INTO _min_cd
  FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'crossdocking-minimo' LIMIT 1;
  _min_cd := COALESCE(_min_cd, 7);

  CREATE TEMP TABLE _xprods ON COMMIT DROP AS
  SELECT p.id, btrim(coalesce(p.ncm, '')) AS ncm, btrim(coalesce(p.marca, '')) AS marca, p.peso_liquido, p.peso_bruto, p.largura, p.altura, p.profundidade,
         btrim(coalesce(p.cross_docking, '')) AS cross_docking,
         btrim(coalesce(p.unidade_medida, '')) AS unidade_medida,
         btrim(coalesce(p.condicao_produto, '')) AS condicao_produto,
         btrim(coalesce(p.tipo_producao, '')) AS tipo_producao,
         btrim(coalesce(p.fornecedor_id, '')) AS fornecedor_id, coalesce(nullif(p.url_imagens_externas, ''), p.imagem_principal_url, '') AS imgs_raw
  FROM public.bling_products p
  WHERE p.company_id = _run.company_id
    AND (COALESCE(array_length(_run.product_ids, 1), 0) = 0 OR p.id = ANY(_run.product_ids))
    AND (_run.only_active IS NOT TRUE OR upper(btrim(coalesce(p.situacao,''))) LIKE 'A%');
  ANALYZE _xprods;

  DELETE FROM public.audit_results ar
  USING _xprods p
  WHERE ar.product_id = p.id
    AND ar.rule_slug IN ('dimensoes-peso-obrigatorios', 'crossdocking-minimo', 'unidade-medida-centimetros', 'condicao-novo', 'producao-terceiros', 'fornecedor-vinculado', 'ncm-obrigatorio', 'imagem-placeholder', 'marca-obrigatoria');

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
    AND upper(p.tipo_producao) NOT LIKE 'T%'
  UNION ALL
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'fornecedor-vinculado' LIMIT 1),
    'fornecedor-vinculado', 'cadastro', 'error', 'error',
    'Produto sem fornecedor vinculado no Bling.',
    jsonb_build_object('autofix', false)
  FROM _xprods p
  WHERE 'fornecedor-vinculado' = ANY(_rule_slugs)
    AND NOT EXISTS (SELECT 1 FROM public.bling_product_suppliers bps
                    WHERE bps.company_id = _run.company_id AND bps.product_id = p.id);


  INSERT INTO public.audit_results
    (run_id, company_id, product_id, rule_id, rule_slug, category, severity, status, message, details)
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'ncm-obrigatorio' LIMIT 1),
    'ncm-obrigatorio', 'fiscal', 'error', 'error',
    'NCM não preenchido no Bling.', jsonb_build_object('autofix', true)
  FROM _xprods p
  WHERE 'ncm-obrigatorio' = ANY(_rule_slugs) AND p.ncm = '';

  INSERT INTO public.audit_results
    (run_id, company_id, product_id, rule_id, rule_slug, category, severity, status, message, details)
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'marca-obrigatoria' LIMIT 1),
    'marca-obrigatoria', 'cadastro', 'error', 'error',
    'Marca não preenchida no Bling.', jsonb_build_object('autofix', true)
  FROM _xprods p
  WHERE 'marca-obrigatoria' = ANY(_rule_slugs) AND p.marca = '';



  -- Conjunto único: explode as fotos de todos os produtos e consulta o cache
  -- uma vez (antes era um join por produto que varria o cache inteiro).
  INSERT INTO public.audit_results
    (run_id, company_id, product_id, rule_id, rule_slug, category, severity, status, message, details)
  WITH rule AS (
    SELECT id, config FROM public.validation_rules
    WHERE id = ANY(_run.rule_ids) AND active = true AND slug = 'imagem-placeholder' LIMIT 1
  ), known AS (
    SELECT DISTINCT public.normalize_audit_image_url(k) AS k
    FROM rule, jsonb_array_elements_text(coalesce(rule.config->'urls', '[]'::jsonb)) k
  ), u AS (
    SELECT p.id AS product_id, btrim(x.u) AS url, x.ord,
           public.normalize_audit_image_url(x.u) AS k
    FROM _xprods p
    CROSS JOIN LATERAL regexp_split_to_table(p.imgs_raw, E'[|\\n\\r]+') WITH ORDINALITY AS x(u, ord)
    WHERE EXISTS (SELECT 1 FROM rule) AND btrim(x.u) <> ''
  ), bad AS (
    SELECT u.product_id, u.url, u.ord, c.status, c.reason
    FROM u
    LEFT JOIN public.image_audit_cache c ON c.url_key = u.k AND c.version = 1
    WHERE u.k IN (SELECT k FROM known) OR c.status IN ('placeholder', 'unknown')
  )
  SELECT _run_id, _run.company_id, b.product_id, (SELECT id FROM rule),
    'imagem-placeholder', 'imagens', 'error', 'error',
    'Foto inválida: imagem padrão, inacessível ou formato não suportado. Consulte os motivos por link.',
    jsonb_build_object('autofix', true,
      'urls', jsonb_agg(b.url ORDER BY b.ord),
      'failures', jsonb_agg(jsonb_build_object('url', b.url, 'status', coalesce(b.status, 'placeholder'),
        'reason', CASE WHEN b.status = 'unknown' THEN coalesce(b.reason, 'Foto inacessível ou formato não suportado.') ELSE 'Imagem padrão no lugar da foto real.' END) ORDER BY b.ord))
  FROM bad b
  GROUP BY b.product_id;

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
  WHERE bp.id = p.id
    AND (bp.last_audit_errors IS DISTINCT FROM COALESCE(a.errs, 0)
      OR bp.last_audit_warnings IS DISTINCT FROM COALESCE(a.warns, 0)
      OR bp.last_audit_passed IS DISTINCT FROM GREATEST(_rules_count - COALESCE(a.errs, 0) - COALESCE(a.warns, 0), 0));

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
$function$;

CREATE OR REPLACE FUNCTION public.resume_audit_run(_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
 SET lock_timeout TO '20s'
AS $function$
DECLARE r public.audit_runs%ROWTYPE; result jsonb;
BEGIN
  SELECT * INTO r FROM public.audit_runs WHERE id = _run_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'processando' THEN
    PERFORM public.unschedule_audit_finish(_run_id);
    RETURN jsonb_build_object('skipped', true);
  END IF;

  -- O dono da auditoria saiu da empresa: nada a retomar, encerra a corrida.
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = r.company_id AND user_id = r.user_id AND ativo = true
  ) THEN
    UPDATE public.audit_runs SET status = 'cancelada', finished_at = now() WHERE id = _run_id;
    PERFORM public.unschedule_audit_finish(_run_id);
    RETURN jsonb_build_object('cancelled', true);
  END IF;

  -- Corridas de semanas atrás: a duração não cabe no campo inteiro e reprocessar
  -- um catálogo tão antigo não vale a pena; encerra para a empresa poder auditar.
  IF r.started_at IS NOT NULL AND r.started_at < now() - interval '7 days' THEN
    UPDATE public.audit_runs SET status = 'cancelada', finished_at = now() WHERE id = _run_id;
    PERFORM public.unschedule_audit_finish(_run_id);
    RETURN jsonb_build_object('cancelled', 'antiga');
  END IF;

  PERFORM set_config('request.jwt.claim.sub', r.user_id::text, true);

  IF EXISTS (
      SELECT 1 FROM public.validation_rules vr
      WHERE vr.slug = 'imagem-placeholder' AND vr.active = true AND vr.id = ANY(r.rule_ids)
    ) AND NOT r.image_scan_done THEN
    -- Ainda faltam fotos: devolve o comando para a varredura, que o vigia segue
    -- reenfileirando a cada minuto.
    UPDATE public.audit_runs SET image_scan_started = true WHERE id = _run_id;
    PERFORM public.unschedule_audit_finish(_run_id);
    RETURN jsonb_build_object('resumed', 'imagens');
  END IF;

  -- Várias etapas finais simultâneas disputam memória/disco e travam todas.
  -- Até 4 etapas finais em paralelo (uma por empresa); as demais aguardam vaga.
  IF NOT (pg_try_advisory_xact_lock(hashtext('audit-finish-slot'), 1)
          OR pg_try_advisory_xact_lock(hashtext('audit-finish-slot'), 2)
          OR pg_try_advisory_xact_lock(hashtext('audit-finish-slot'), 3)
          OR pg_try_advisory_xact_lock(hashtext('audit-finish-slot'), 4)) THEN
    RETURN jsonb_build_object('aguardando', 'vaga');
  END IF;

  result := public.run_audit_sql(_run_id);
  PERFORM public.run_audit_extra_rules(_run_id);
  PERFORM public.unschedule_audit_finish(_run_id);
  RETURN result;
END;
$function$;
