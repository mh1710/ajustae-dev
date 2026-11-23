-- Mantém a correção automática alinhada ao texto exibido no Bling.
CREATE OR REPLACE FUNCTION public.transform_fill_garantia_anatel(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '0'
AS $function$
DECLARE _updated int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH src AS (
    SELECT p.id,
           COALESCE(p.descricao_curta,'') AS desc_atual,
           COALESCE(NULLIF(btrim(a.codigo_anatel), ''), 'isento') AS anatel_code
    FROM public.bling_products p
    LEFT JOIN public.anatel_products a
      ON btrim(a.codigo) = btrim(COALESCE(p.codigo,''))
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
  ),
  cleaned AS (
    SELECT id,
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(desc_atual,
              '(^|\n|\r|\|)\s*Anvisa\s*:[^\n\r|]*', '', 'gi'),
            '(^|\n|\r|\|)\s*Código\s+Anatel\s*:[^\n\r|]*', '', 'gi'),
          '(^|\n|\r|\|)\s*Garantia\s*:[^\n\r|]*', '', 'gi')
      ) AS base,
      anatel_code
    FROM src
  ),
  final AS (
    SELECT id,
      CASE
        WHEN base = '' THEN
          format('Garantia: 3 meses | Código Anatel: %s | Anvisa: Isento', anatel_code)
        ELSE
          base || E'\n\n' || format('Garantia: 3 meses | Código Anatel: %s | Anvisa: Isento', anatel_code)
      END AS nova_desc
    FROM cleaned
  ),
  upd AS (
    UPDATE public.bling_products bp
       SET descricao_curta = f.nova_desc,
           dirty = true,
           updated_at = now()
      FROM final f
     WHERE bp.id = f.id
       AND COALESCE(bp.descricao_curta,'') <> f.nova_desc
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM upd;

  RETURN jsonb_build_object('updated', _updated);
END;
$function$;