
CREATE INDEX IF NOT EXISTS idx_bling_products_company_bling_id ON public.bling_products (company_id, bling_product_id);
CREATE INDEX IF NOT EXISTS idx_bling_products_company_gtin ON public.bling_products (company_id, gtin);

CREATE OR REPLACE FUNCTION public.classify_import_batch(_batch_id uuid, _company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total int;
  _new int;
  _existing int;
  _fields text[] := ARRAY[
    'nome','descricao_complementar','descricao_curta','preco','preco_custo','estoque',
    'marca','fornecedor','categoria_produto','gtin','gtin_embalagem',
    'peso_liquido','peso_bruto','largura','altura','profundidade','ncm','unidade',
    'url_imagens_externas','situacao','codigo_pai','tipo_item','grupo_produtos'
  ];
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

  WITH src AS (
    SELECT r.id AS rid,
           r.parsed AS parsed,
           COALESCE(p_sku.id, p_bid.id, p_gtin.id) AS product_id,
           CASE
             WHEN p_sku.id IS NOT NULL THEN 'sku'
             WHEN p_bid.id IS NOT NULL THEN 'bling_id'
             WHEN p_gtin.id IS NOT NULL THEN 'gtin'
             ELSE 'none'
           END AS mt,
           to_jsonb(COALESCE(p_sku, p_bid, p_gtin)) AS prod
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
  ),
  diffed AS (
    SELECT s.rid, s.mt, s.product_id,
           CASE WHEN s.product_id IS NULL THEN NULL ELSE (
             SELECT jsonb_agg(jsonb_build_object('field', f, 'sistema', sv, 'planilha', pv))
             FROM unnest(_fields) AS f
             CROSS JOIN LATERAL (
               SELECT s.prod->>f AS sv, s.parsed->>f AS pv
             ) x
             WHERE COALESCE(NULLIF(btrim(sv), ''), '') IS DISTINCT FROM COALESCE(NULLIF(btrim(pv), ''), '')
           ) END AS diff
    FROM src s
  ),
  upd AS (
    UPDATE product_sheet_rows r
       SET match_type = d.mt,
           match_product_id = d.product_id,
           diff = d.diff,
           action = 'pending'
      FROM diffed d
     WHERE r.id = d.rid
    RETURNING d.mt
  )
  SELECT
    count(*) FILTER (WHERE mt = 'none'),
    count(*) FILTER (WHERE mt <> 'none')
  INTO _new, _existing
  FROM upd;

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
