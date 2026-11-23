
CREATE OR REPLACE FUNCTION public.transform_fill_ean_from_supplier(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_updated int := 0;
  v_candidates int := 0;
  v_not_found int := 0;
BEGIN
  WITH candidates AS (
    SELECT p.id, p.codigo,
      CASE
        WHEN p.codigo ~* '^ODS' THEN 'oderco'
        WHEN p.codigo ~* '^HX' THEN 'hayamax'
        WHEN p.codigo ~* '^HA' THEN 'hayamax'
        WHEN p.codigo ~* '^EV' THEN 'evolusom'
        WHEN p.codigo ~* '^O'  THEN 'oderco'
        WHEN p.codigo ~* '^E'  THEN 'evolusom'
        ELSE NULL
      END AS sup_codigo,
      btrim(regexp_replace(p.codigo, '^[A-Za-z]+', '')) AS numeric_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
      AND (p.gtin IS NULL OR btrim(p.gtin) = '')
      AND p.codigo IS NOT NULL AND btrim(p.codigo) <> ''
  ),
  matched AS (
    SELECT DISTINCT ON (c.id) c.id, fp.codigobarras
    FROM candidates c
    JOIN public.fornecedores f ON f.codigo = c.sup_codigo
    JOIN public.fornecedor_produtos fp
      ON fp.fornecedor_id = f.id AND fp.codigo = c.numeric_code
    WHERE c.sup_codigo IS NOT NULL
      AND c.numeric_code <> ''
      AND fp.codigobarras IS NOT NULL
      AND btrim(fp.codigobarras) <> ''
    ORDER BY c.id, fp.updated_at DESC NULLS LAST
  ),
  upd AS (
    UPDATE public.bling_products p
      SET gtin = m.codigobarras,
          dirty = true,
          updated_at = now()
    FROM matched m
    WHERE p.id = m.id
    RETURNING p.id
  )
  SELECT COUNT(*) INTO v_updated FROM upd;

  SELECT COUNT(*) INTO v_candidates
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
    AND (p.gtin IS NULL OR btrim(p.gtin) = '');

  v_not_found := GREATEST(v_candidates - v_updated, 0);

  RETURN jsonb_build_object(
    'updated', v_updated,
    'candidates', v_candidates,
    'not_found', v_not_found
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transform_fill_ean_from_supplier(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transform_fill_ean_from_supplier(uuid, uuid[]) TO authenticated, service_role;
