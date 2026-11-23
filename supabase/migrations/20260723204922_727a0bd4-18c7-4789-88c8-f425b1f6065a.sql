
CREATE OR REPLACE FUNCTION public.norm_cmp(_v text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t text;
  n numeric;
BEGIN
  IF _v IS NULL THEN RETURN NULL; END IF;
  t := btrim(_v);
  IF t = '' THEN RETURN NULL; END IF;
  -- try numeric normalization (accept comma as decimal separator)
  BEGIN
    n := replace(replace(t, '.', ''), ',', '.')::numeric;
    -- if the original had a dot as decimal separator (no comma), reparse directly
    IF position(',' in t) = 0 THEN
      n := t::numeric;
    END IF;
    RETURN trim(trailing '.' FROM trim(trailing '0' FROM to_char(n, 'FM999999999999990.####################')));
  EXCEPTION WHEN others THEN
    RETURN lower(t);
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.norm_cmp(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.classify_import_batch(_batch_id uuid, _company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $$
DECLARE
  _total int;
  _new int;
  _existing int;
BEGIN
  SELECT count(*) INTO _total FROM product_sheet_rows WHERE batch_id = _batch_id;

  UPDATE import_batches
     SET status = 'classificando',
         classify_total = _total,
         classify_processed = 0
   WHERE id = _batch_id;

  IF _total = 0 THEN
    UPDATE import_batches
       SET status = 'aguardando_revisao', new_count = 0, existing_count = 0,
           classify_processed = 0, finished_at = now()
     WHERE id = _batch_id;
    RETURN jsonb_build_object('ok', true, 'new', 0, 'existing', 0);
  END IF;

  WITH matched AS (
    SELECT r.id AS rid,
           COALESCE(p_sku.id, p_bid.id, p_gtin.id) AS product_id,
           CASE
             WHEN p_sku.id IS NOT NULL THEN 'sku'
             WHEN p_bid.id IS NOT NULL THEN 'bling_id'
             WHEN p_gtin.id IS NOT NULL THEN 'gtin'
             ELSE 'none'
           END AS mt
    FROM product_sheet_rows r
    LEFT JOIN bling_products p_sku
      ON r.sku IS NOT NULL AND p_sku.company_id = _company_id AND p_sku.codigo = r.sku
    LEFT JOIN bling_products p_bid
      ON p_sku.id IS NULL AND r.bling_id IS NOT NULL
     AND p_bid.company_id = _company_id AND p_bid.bling_product_id = r.bling_id
    LEFT JOIN bling_products p_gtin
      ON p_sku.id IS NULL AND p_bid.id IS NULL AND r.gtin IS NOT NULL
     AND p_gtin.company_id = _company_id AND p_gtin.gtin = r.gtin
    WHERE r.batch_id = _batch_id
  )
  UPDATE product_sheet_rows r
     SET match_type = m.mt,
         match_product_id = m.product_id,
         diff = NULL,
         action = 'pending'
    FROM matched m
   WHERE r.id = m.rid;

  WITH pairs AS (
    SELECT r.id AS rid, r.parsed AS p, to_jsonb(bp) AS s
    FROM product_sheet_rows r
    JOIN bling_products bp ON bp.id = r.match_product_id
    WHERE r.batch_id = _batch_id AND r.match_product_id IS NOT NULL
  ),
  diffs AS (
    SELECT rid,
      (
        SELECT jsonb_agg(elem)
        FROM (VALUES
          ('nome'), ('descricao_complementar'), ('descricao_curta'), ('preco'), ('preco_custo'), ('estoque'),
          ('marca'), ('fornecedor'), ('categoria_produto'), ('gtin'), ('gtin_embalagem'),
          ('peso_liquido'), ('peso_bruto'), ('largura'), ('altura'), ('profundidade'), ('ncm'), ('unidade'),
          ('url_imagens_externas'), ('situacao'), ('codigo_pai'), ('tipo_item'), ('grupo_produtos')
        ) AS f(name)
        CROSS JOIN LATERAL (
          SELECT jsonb_build_object('field', f.name, 'sistema', s->>f.name, 'planilha', p->>f.name) AS elem
          WHERE public.norm_cmp(s->>f.name) IS DISTINCT FROM public.norm_cmp(p->>f.name)
        ) x
      ) AS d
    FROM pairs
  )
  UPDATE product_sheet_rows r
     SET diff = diffs.d
    FROM diffs
   WHERE r.id = diffs.rid AND diffs.d IS NOT NULL;

  SELECT
    count(*) FILTER (WHERE match_type = 'none'),
    count(*) FILTER (WHERE match_type <> 'none')
  INTO _new, _existing
  FROM product_sheet_rows
  WHERE batch_id = _batch_id;

  UPDATE import_batches
     SET status = 'aguardando_revisao',
         new_count = _new,
         existing_count = _existing,
         classify_processed = _total,
         finished_at = now()
   WHERE id = _batch_id;

  RETURN jsonb_build_object('ok', true, 'new', _new, 'existing', _existing);
END;
$$;

GRANT EXECUTE ON FUNCTION public.classify_import_batch(uuid, uuid) TO authenticated, service_role;
