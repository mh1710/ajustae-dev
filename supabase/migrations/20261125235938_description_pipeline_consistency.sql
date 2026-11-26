-- Padroniza descrições como texto visível, mantém correções pendentes para o
-- Bling e elimina a corrida entre remover e recriar o rodapé obrigatório.

CREATE OR REPLACE FUNCTION public.description_visible_text(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $function$
  SELECT btrim(
    regexp_replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    regexp_replace(
                      regexp_replace(coalesce(_value, ''), '<br\s*/?>', E'\n', 'gi'),
                      '<[^>]+>', ' ', 'g'
                    ),
                    '&nbsp;', ' '
                  ),
                  '&#160;', ' '
                ),
                '&amp;', '&'
              ),
              '&lt;', '<'
            ),
            '&gt;', '>'
          ),
          '&quot;', '"'
        ),
        '&#39;', ''''
      ),
      '\s+', ' ', 'g'
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.description_visible_text(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.description_visible_text(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.transform_strip_html(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $function$
DECLARE _updated integer := 0;
BEGIN
  IF public.is_company_restricted() THEN
    RAISE EXCEPTION 'Acesso restrito por empresa';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH changed AS (
    UPDATE public.bling_products p
    SET nome = public.description_visible_text(p.nome),
        descricao_curta = public.description_visible_text(p.descricao_curta),
        descricao_complementar = public.description_visible_text(p.descricao_complementar),
        observacoes = public.description_visible_text(p.observacoes),
        informacoes_adicionais = public.description_visible_text(p.informacoes_adicionais),
        descricao_fornecedor = public.description_visible_text(p.descricao_fornecedor),
        dirty = true,
        updated_at = now()
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
      AND concat_ws(' ', p.nome, p.descricao_curta, p.descricao_complementar,
        p.observacoes, p.informacoes_adicionais, p.descricao_fornecedor)
        ~* '<[^>]+>|&(nbsp|amp|lt|gt|quot|apos|#39|#160);'
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM changed;

  RETURN jsonb_build_object('updated', _updated);
END;
$function$;

CREATE OR REPLACE FUNCTION public.transform_fill_desc_complementar(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $function$
DECLARE _updated integer := 0;
BEGIN
  IF public.is_company_restricted() THEN
    RAISE EXCEPTION 'Acesso restrito por empresa';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH changed AS (
    UPDATE public.bling_products p
    SET descricao_complementar = btrim(p.nome),
        dirty = true,
        updated_at = now()
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
      AND btrim(coalesce(p.nome, '')) <> ''
      AND btrim(coalesce(p.descricao_complementar, '')) IS DISTINCT FROM btrim(p.nome)
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM changed;

  RETURN jsonb_build_object('updated', _updated);
END;
$function$;

CREATE OR REPLACE FUNCTION public.transform_remove_garantia_anatel(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $function$
DECLARE _updated integer := 0;
BEGIN
  IF public.is_company_restricted() THEN
    RAISE EXCEPTION 'Acesso restrito por empresa';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH normalized AS (
    SELECT p.id,
      public.description_visible_text(
        regexp_replace(
          regexp_replace(coalesce(p.descricao_curta, ''),
            '(Anvisa|Garantia|C[oó]digo\s+Anatel|Anatel)\s*:[^\n\r|.]*\.?', '', 'gi'),
          'Garantia\s+(de\s+)?[0-9]+\s*(meses|mes|m[êe]s|anos|ano)[^\n\r|.]*\.?', '', 'gi'
        )
      ) AS nova_desc
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
  ), changed AS (
    UPDATE public.bling_products p
    SET descricao_curta = n.nova_desc,
        dirty = true,
        updated_at = now()
    FROM normalized n
    WHERE p.id = n.id
      AND coalesce(p.descricao_curta, '') IS DISTINCT FROM n.nova_desc
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM changed;

  RETURN jsonb_build_object('updated', _updated);
END;
$function$;

CREATE OR REPLACE FUNCTION public.transform_fill_garantia_anatel(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $function$
DECLARE _updated integer := 0;
BEGIN
  IF public.is_company_restricted() THEN
    RAISE EXCEPTION 'Acesso restrito por empresa';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH normalized AS (
    SELECT p.id,
      public.description_visible_text(
        regexp_replace(
          regexp_replace(coalesce(p.descricao_curta, ''),
            '(Anvisa|Garantia|C[oó]digo\s+Anatel|Anatel)\s*:[^\n\r|.]*\.?', '', 'gi'),
          'Garantia\s+(de\s+)?[0-9]+\s*(meses|mes|m[êe]s|anos|ano)[^\n\r|.]*\.?', '', 'gi'
        )
      ) AS base,
      public.anatel_code_for(p.codigo, p.gtin) AS anatel_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
  ), final AS (
    SELECT id,
      concat_ws(E'\n\n', nullif(base, ''),
        format('Garantia: 3 meses | Código Anatel: %s | Anvisa: Isento', anatel_code)
      ) AS nova_desc
    FROM normalized
  ), changed AS (
    UPDATE public.bling_products p
    SET descricao_curta = f.nova_desc,
        dirty = true,
        updated_at = now()
    FROM final f
    WHERE p.id = f.id
      AND coalesce(p.descricao_curta, '') IS DISTINCT FROM f.nova_desc
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM changed;

  RETURN jsonb_build_object('updated', _updated);
END;
$function$;

REVOKE ALL ON FUNCTION public.transform_strip_html(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transform_fill_desc_complementar(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transform_remove_garantia_anatel(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transform_fill_garantia_anatel(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transform_strip_html(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transform_fill_desc_complementar(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transform_remove_garantia_anatel(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transform_fill_garantia_anatel(uuid, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.run_audit_extra_rules(_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $function$
DECLARE
  _run public.audit_runs%ROWTYPE;
  _rule_slugs text[];
  _rules_count integer := 0;
  _min_cd integer := 7;
  _min_desc integer := 150;
  _errors integer := 0;
  _warnings integer := 0;
  _passed integer := 0;
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
  _rules_count := coalesce(_rules_count, 0);

  IF NOT (
    'dimensoes-peso-obrigatorios' = ANY(_rule_slugs)
    OR 'crossdocking-minimo' = ANY(_rule_slugs)
    OR 'descricao-curta-minima' = ANY(_rule_slugs)
  ) THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;

  SELECT coalesce((config->>'min_dias')::integer, 7) INTO _min_cd
  FROM public.validation_rules
  WHERE id = ANY(_run.rule_ids) AND slug = 'crossdocking-minimo' LIMIT 1;
  _min_cd := coalesce(_min_cd, 7);

  SELECT coalesce((config->>'min')::integer, 150) INTO _min_desc
  FROM public.validation_rules
  WHERE id = ANY(_run.rule_ids) AND slug = 'descricao-curta-minima' LIMIT 1;
  _min_desc := coalesce(_min_desc, 150);

  CREATE TEMP TABLE _xprods ON COMMIT DROP AS
  SELECT p.id, p.peso_liquido, p.peso_bruto, p.largura, p.altura, p.profundidade,
         btrim(coalesce(p.cross_docking, '')) AS cross_docking,
         public.description_visible_text(p.descricao_curta) AS descricao_visivel
  FROM public.bling_products p
  WHERE p.company_id = _run.company_id
    AND (coalesce(array_length(_run.product_ids, 1), 0) = 0 OR p.id = ANY(_run.product_ids));

  DELETE FROM public.audit_results ar
  USING _xprods p
  WHERE ar.product_id = p.id
    AND ar.run_id = _run_id
    AND ar.rule_slug IN (
      'dimensoes-peso-obrigatorios',
      'crossdocking-minimo',
      'descricao-curta-minima'
    );

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
    AND (coalesce(p.peso_liquido, 0) <= 0
      OR coalesce(p.largura, 0) <= 0
      OR coalesce(p.altura, 0) <= 0
      OR coalesce(p.profundidade, 0) <= 0);

  INSERT INTO public.audit_results
    (run_id, company_id, product_id, rule_id, rule_slug, category, severity, status, message, details)
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'crossdocking-minimo' LIMIT 1),
    'crossdocking-minimo', 'estoque', 'warning', 'warning',
    CASE WHEN p.cross_docking = '' THEN format('Crossdocking não preenchido (mínimo %s dias).', _min_cd)
         ELSE format('Crossdocking de %s dia(s) é menor que o mínimo de %s dias.', p.cross_docking, _min_cd) END,
    jsonb_build_object('autofix', true, 'expected', _min_cd)
  FROM _xprods p
  WHERE 'crossdocking-minimo' = ANY(_rule_slugs)
    AND coalesce(nullif(substring(p.cross_docking from '^[0-9]+'), '')::integer, 0) < _min_cd;

  INSERT INTO public.audit_results
    (run_id, company_id, product_id, rule_id, rule_slug, category, severity, status, message, details)
  SELECT _run_id, _run.company_id, p.id,
    (SELECT id FROM public.validation_rules WHERE id = ANY(_run.rule_ids) AND slug = 'descricao-curta-minima' LIMIT 1),
    'descricao-curta-minima', 'conteudo', 'error', 'error',
    format('Descrição curta com %s caracteres visíveis (mínimo %s).', char_length(p.descricao_visivel), _min_desc),
    jsonb_build_object('visible_length', char_length(p.descricao_visivel), 'minimum', _min_desc)
  FROM _xprods p
  WHERE 'descricao-curta-minima' = ANY(_rule_slugs)
    AND char_length(p.descricao_visivel) < _min_desc;

  WITH agg AS (
    SELECT product_id,
      count(*) FILTER (WHERE status = 'error') AS errs,
      count(*) FILTER (WHERE status = 'warning') AS warns
    FROM public.audit_results WHERE run_id = _run_id
    GROUP BY product_id
  )
  UPDATE public.bling_products bp SET
    last_audit_at = now(),
    last_audit_errors = coalesce(a.errs, 0),
    last_audit_warnings = coalesce(a.warns, 0),
    last_audit_passed = greatest(_rules_count - coalesce(a.errs, 0) - coalesce(a.warns, 0), 0)
  FROM _xprods p
  LEFT JOIN agg a ON a.product_id = p.id
  WHERE bp.id = p.id;

  SELECT
    count(*) FILTER (WHERE errs > 0),
    count(*) FILTER (WHERE errs = 0 AND warns > 0),
    count(*) FILTER (WHERE errs = 0 AND warns = 0)
  INTO _errors, _warnings, _passed
  FROM (
    SELECT p.id, coalesce(a.errs, 0) AS errs, coalesce(a.warns, 0) AS warns
    FROM _xprods p
    LEFT JOIN (
      SELECT product_id,
        count(*) FILTER (WHERE status = 'error') AS errs,
        count(*) FILTER (WHERE status = 'warning') AS warns
      FROM public.audit_results WHERE run_id = _run_id
      GROUP BY product_id
    ) a ON a.product_id = p.id
  ) totals;

  UPDATE public.audit_runs SET
    errors_count = coalesce(_errors, 0),
    warnings_count = coalesce(_warnings, 0),
    passed_count = coalesce(_passed, 0)
  WHERE id = _run_id;

  RETURN jsonb_build_object(
    'done', true,
    'errors', coalesce(_errors, 0),
    'warnings', coalesce(_warnings, 0),
    'passed', coalesce(_passed, 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.run_audit_extra_rules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_audit_extra_rules(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
