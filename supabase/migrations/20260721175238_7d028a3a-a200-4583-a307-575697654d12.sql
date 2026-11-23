
CREATE OR REPLACE FUNCTION public.transform_trim_images(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL,
  _max int DEFAULT 18
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int := 0;
  v_removed_total bigint := 0;
  r record;
  arr text[];
  kept text[];
  new_val text;
  removed int;
BEGIN
  IF _max IS NULL OR _max < 1 THEN
    _max := 18;
  END IF;

  FOR r IN
    SELECT id, url_imagens_externas
    FROM public.bling_products
    WHERE company_id = _company_id
      AND (_product_ids IS NULL OR id = ANY(_product_ids))
      AND url_imagens_externas IS NOT NULL
      AND url_imagens_externas <> ''
  LOOP
    -- Split por pipe ou quebra de linha, aparar espaços, remover vazios
    arr := ARRAY(
      SELECT btrim(u)
      FROM regexp_split_to_table(r.url_imagens_externas, E'[|\n\r]+') AS u
      WHERE btrim(u) <> ''
    );
    IF array_length(arr, 1) IS NULL OR array_length(arr, 1) <= _max THEN
      CONTINUE;
    END IF;
    kept := arr[1:_max];
    removed := array_length(arr, 1) - _max;
    new_val := array_to_string(kept, '|');
    UPDATE public.bling_products
    SET url_imagens_externas = new_val,
        updated_at = now()
    WHERE id = r.id;
    v_updated := v_updated + 1;
    v_removed_total := v_removed_total + removed;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'removed', v_removed_total, 'max', _max);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transform_trim_images(uuid, uuid[], int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transform_trim_images(uuid, uuid[], int) TO service_role;
