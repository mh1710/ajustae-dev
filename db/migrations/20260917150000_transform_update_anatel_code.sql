-- Atualiza SOMENTE o "Código Anatel" dentro da descrição curta,
-- preservando Garantia, Anvisa e todo o restante do texto.
CREATE OR REPLACE FUNCTION public.transform_update_anatel_code(
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
  final AS (
    SELECT id,
      CASE
        -- já existe "Código Anatel: ..." -> troca apenas o valor
        WHEN desc_atual ~* 'C[oó]digo\s+Anatel\s*:' THEN
          regexp_replace(desc_atual, '(C[oó]digo\s+Anatel\s*:\s*)[^\n\r|]*',
                         '\1' || anatel_code, 'gi')
        -- descrição vazia -> só o campo da Anatel
        WHEN btrim(desc_atual) = '' THEN
          format('Código Anatel: %s', anatel_code)
        -- já existe bloco Garantia/Anvisa na última linha -> anexa com separador " | "
        WHEN (regexp_replace(desc_atual, '^.*(\n|\r)', '')) ~* '(Garantia\s*:|Anvisa\s*:)' THEN
          btrim(desc_atual) || format(' | Código Anatel: %s', anatel_code)
        ELSE
          btrim(desc_atual) || E'\n\n' || format('Código Anatel: %s', anatel_code)
      END AS nova_desc
    FROM src
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

GRANT EXECUTE ON FUNCTION public.transform_update_anatel_code(uuid, uuid[]) TO authenticated;
