-- Permite filtrar produtos SEM erros/avisos de auditoria usando o slug especial '__clean__'
CREATE OR REPLACE FUNCTION public.list_products_fast(_company_id uuid, _search text DEFAULT NULL::text, _situacao text DEFAULT NULL::text, _tipo text DEFAULT NULL::text, _detail_filter text DEFAULT 'all'::text, _audit_rule_slug text DEFAULT NULL::text, _audit_status text DEFAULT 'any'::text, _audit_run_id uuid DEFAULT NULL::uuid, _page integer DEFAULT 1, _page_size integer DEFAULT 25, _stores_filter text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _offset int := GREATEST(COALESCE(_page, 1), 1) - 1;
  _rows jsonb;
  _count int;
  _sf text := COALESCE(_stores_filter, 'all');
  _sit_norm text := CASE WHEN _situacao IS NULL OR btrim(_situacao) = '' THEN NULL ELSE upper(left(btrim(_situacao),1)) END;
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
           p.preco, p.preco_custo, p.gtin, p.imagem_principal_url, p.url_imagens_externas,
           p.detail_synced, p.detail_synced_at, p.updated_at, p.marca, p.last_audit_errors,
           p.last_audit_warnings, p.last_audit_at,
           (SELECT count(*)::int FROM public.bling_product_stores s
             WHERE s.internal_product_id = p.id AND s.is_linked = true) AS stores_count
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_search IS NULL OR btrim(_search) = '' OR p.nome ILIKE '%' || btrim(_search) || '%' OR p.codigo ILIKE '%' || btrim(_search) || '%' OR p.gtin ILIKE '%' || btrim(_search) || '%')
      AND (_sit_norm IS NULL OR upper(left(COALESCE(p.situacao,''),1)) = _sit_norm)
      AND (_tipo IS NULL OR p.tipo = _tipo)
      AND (COALESCE(_detail_filter, 'all') = 'all'
        OR (COALESCE(_detail_filter, 'all') = 'synced' AND p.detail_synced = true)
        OR (COALESCE(_detail_filter, 'all') = 'pending' AND p.detail_synced = false))
      AND (_sf = 'all' OR (
        SELECT count(*) FROM public.bling_product_stores s
        WHERE s.internal_product_id = p.id AND s.is_linked = true
      ) OPERATOR(pg_catalog.=) ANY (
        CASE _sf
          WHEN '0' THEN ARRAY[0]::bigint[]
          WHEN '1' THEN ARRAY[1]::bigint[]
          WHEN '2' THEN ARRAY[2]::bigint[]
          WHEN '3' THEN ARRAY[3]::bigint[]
          ELSE ARRAY[]::bigint[]
        END
      ) OR (_sf = 'any' AND (
        SELECT count(*) FROM public.bling_product_stores s
        WHERE s.internal_product_id = p.id AND s.is_linked = true) > 0)
        OR (_sf = '4plus' AND (
        SELECT count(*) FROM public.bling_product_stores s
        WHERE s.internal_product_id = p.id AND s.is_linked = true) >= 4))
      AND (_audit_rule_slug IS NULL OR _audit_run_id IS NULL
        OR (_audit_rule_slug = '__clean__' AND NOT EXISTS (
          SELECT 1 FROM public.audit_results ar
          WHERE ar.product_id = p.id
            AND ar.run_id = _audit_run_id
            AND ar.status IN ('error','warning')
        ))
        OR (_audit_rule_slug <> '__clean__' AND EXISTS (
          SELECT 1 FROM public.audit_results ar
          WHERE ar.product_id = p.id
            AND ar.run_id = _audit_run_id
            AND ar.rule_slug = _audit_rule_slug
            AND ((COALESCE(_audit_status, 'any') = 'any' AND ar.status IN ('error','warning')) OR ar.status = _audit_status)
        ))
      )
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

CREATE OR REPLACE FUNCTION public.list_product_ids_fast(_company_id uuid, _search text DEFAULT NULL::text, _situacao text DEFAULT NULL::text, _tipo text DEFAULT NULL::text, _detail_filter text DEFAULT 'all'::text, _audit_rule_slug text DEFAULT NULL::text, _audit_status text DEFAULT 'any'::text, _audit_run_id uuid DEFAULT NULL::uuid, _stores_filter text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ids jsonb;
  _sf text := COALESCE(_stores_filter, 'all');
  _sit_norm text := CASE WHEN _situacao IS NULL OR btrim(_situacao) = '' THEN NULL ELSE upper(left(btrim(_situacao),1)) END;
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
    AND (_sit_norm IS NULL OR upper(left(COALESCE(p.situacao,''),1)) = _sit_norm)
    AND (_tipo IS NULL OR p.tipo = _tipo)
    AND (COALESCE(_detail_filter, 'all') = 'all'
      OR (COALESCE(_detail_filter, 'all') = 'synced' AND p.detail_synced = true)
      OR (COALESCE(_detail_filter, 'all') = 'pending' AND p.detail_synced = false))
    AND (_sf = 'all'
      OR (_sf = 'any' AND (SELECT count(*) FROM public.bling_product_stores s WHERE s.internal_product_id = p.id AND s.is_linked = true) > 0)
      OR (_sf = '4plus' AND (SELECT count(*) FROM public.bling_product_stores s WHERE s.internal_product_id = p.id AND s.is_linked = true) >= 4)
      OR (_sf IN ('0','1','2','3') AND (SELECT count(*) FROM public.bling_product_stores s WHERE s.internal_product_id = p.id AND s.is_linked = true) = _sf::bigint))
    AND (_audit_rule_slug IS NULL OR _audit_run_id IS NULL
      OR (_audit_rule_slug = '__clean__' AND NOT EXISTS (
        SELECT 1 FROM public.audit_results ar
        WHERE ar.product_id = p.id
          AND ar.run_id = _audit_run_id
          AND ar.status IN ('error','warning')
      ))
      OR (_audit_rule_slug <> '__clean__' AND EXISTS (
        SELECT 1 FROM public.audit_results ar
        WHERE ar.product_id = p.id
          AND ar.run_id = _audit_run_id
          AND ar.rule_slug = _audit_rule_slug
          AND ((COALESCE(_audit_status, 'any') = 'any' AND ar.status IN ('error','warning')) OR ar.status = _audit_status)
      ))
    );

  RETURN jsonb_build_object('ids', COALESCE(_ids, '[]'::jsonb));
END;
$function$;
