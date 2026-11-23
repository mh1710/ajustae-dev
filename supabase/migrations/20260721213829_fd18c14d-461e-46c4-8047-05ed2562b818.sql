
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
