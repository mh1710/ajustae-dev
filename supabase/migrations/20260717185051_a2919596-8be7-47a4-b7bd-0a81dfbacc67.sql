
CREATE OR REPLACE FUNCTION public.transform_remove_garantia_anatel(_company_id uuid)
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

  WITH cleaned AS (
    SELECT id,
      COALESCE(descricao_curta,'') AS original,
      btrim(
        regexp_replace(
          COALESCE(descricao_curta,''),
          '(\s*\n)*\s*Garantia:\s*3\s*meses\s*\|\s*Código\s+Anatel\s*:[^\n\r]*',
          '',
          'gi'
        )
      ) AS novo
    FROM public.bling_products
    WHERE company_id = _company_id
      AND descricao_curta ~* 'Garantia:\s*3\s*meses\s*\|\s*Código\s+Anatel\s*:'
  ),
  upd AS (
    UPDATE public.bling_products bp
       SET descricao_curta = c.novo
      FROM cleaned c
     WHERE bp.id = c.id
       AND COALESCE(bp.descricao_curta,'') <> c.novo
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM upd;

  RETURN jsonb_build_object('updated', _updated);
END;
$function$;
