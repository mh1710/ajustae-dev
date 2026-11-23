-- Correção automática da regra "Extensão das imagens (.png/.jpg)":
-- remove APENAS as URLs de imagem que não terminam em .png/.jpg/.jpeg, mantendo as demais.
CREATE OR REPLACE FUNCTION public.transform_remove_invalid_image_urls(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated int := 0;
  v_removed_total bigint := 0;
  r record;
  arr text[];
  kept text[];
  new_val text;
  removed int;
BEGIN
  FOR r IN
    SELECT id, url_imagens_externas
    FROM public.bling_products
    WHERE company_id = _company_id
      AND (_product_ids IS NULL OR id = ANY(_product_ids))
      AND url_imagens_externas IS NOT NULL
      AND url_imagens_externas <> ''
  LOOP
    arr := ARRAY(
      SELECT btrim(u)
      FROM regexp_split_to_table(r.url_imagens_externas, E'[|\n\r]+') AS u
      WHERE btrim(u) <> ''
    );
    IF array_length(arr, 1) IS NULL THEN
      CONTINUE;
    END IF;

    kept := ARRAY(
      SELECT u
      FROM unnest(arr) AS u
      -- ignora query string (?) e âncora (#) ao checar a extensão
      WHERE split_part(split_part(u, '?', 1), '#', 1) ~* '\.(png|jpe?g)$'
    );

    removed := array_length(arr, 1) - COALESCE(array_length(kept, 1), 0);
    IF removed <= 0 THEN
      CONTINUE;
    END IF;

    new_val := COALESCE(array_to_string(kept, '|'), '');

    UPDATE public.bling_products
    SET url_imagens_externas = new_val,
        dirty = true,
        updated_at = now()
    WHERE id = r.id;

    v_updated := v_updated + 1;
    v_removed_total := v_removed_total + removed;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'removed', v_removed_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.transform_remove_invalid_image_urls(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transform_remove_invalid_image_urls(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transform_remove_invalid_image_urls(uuid, uuid[]) TO service_role;
