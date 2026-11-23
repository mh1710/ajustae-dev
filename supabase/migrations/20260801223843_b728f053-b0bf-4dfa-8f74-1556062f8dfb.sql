
CREATE INDEX IF NOT EXISTS idx_psr_batch_matchtype ON public.product_sheet_rows (batch_id, match_type);

DROP FUNCTION IF EXISTS public.classify_import_batch(uuid, uuid);

CREATE OR REPLACE FUNCTION public.classify_import_batch(
  _batch_id uuid,
  _company_id uuid,
  _limit int DEFAULT 3000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _total int;
  _pending int;
  _done int;
  _new int;
  _existing int;
  _processed int := 0;
BEGIN
  SELECT count(*) INTO _total FROM product_sheet_rows WHERE batch_id = _batch_id;

  IF _total = 0 THEN
    UPDATE import_batches
       SET status = 'aguardando_revisao', new_count = 0, existing_count = 0,
           classify_total = 0, classify_processed = 0, finished_at = now()
     WHERE id = _batch_id;
    RETURN jsonb_build_object('ok', true, 'done', true, 'remaining', 0, 'new', 0, 'existing', 0);
  END IF;

  UPDATE import_batches
     SET status = 'classificando',
         classify_total = _total
   WHERE id = _batch_id;

  -- Lote de linhas ainda não classificadas
  WITH batch AS (
    SELECT id, sku, bling_id, gtin
      FROM product_sheet_rows
     WHERE batch_id = _batch_id AND match_type IS NULL
     ORDER BY row_number
     LIMIT _limit
  ),
  matched AS (
    SELECT r.id AS rid,
           COALESCE(p_sku.id, p_bid.id, p_gtin.id) AS product_id,
           CASE
             WHEN p_sku.id IS NOT NULL THEN 'sku'
             WHEN p_bid.id IS NOT NULL THEN 'bling_id'
             WHEN p_gtin.id IS NOT NULL THEN 'gtin'
             ELSE 'none'
           END AS mt
    FROM batch r
    LEFT JOIN bling_products p_sku
      ON r.sku IS NOT NULL AND p_sku.company_id = _company_id AND p_sku.codigo = r.sku
    LEFT JOIN bling_products p_bid
      ON p_sku.id IS NULL AND r.bling_id IS NOT NULL
     AND p_bid.company_id = _company_id AND p_bid.bling_product_id = r.bling_id
    LEFT JOIN bling_products p_gtin
      ON p_sku.id IS NULL AND p_bid.id IS NULL AND r.gtin IS NOT NULL
     AND p_gtin.company_id = _company_id AND p_gtin.gtin = r.gtin
  ),
  upd AS (
    UPDATE product_sheet_rows r
       SET match_type = m.mt,
           match_product_id = m.product_id,
           diff = NULL,
           action = CASE WHEN m.mt = 'none' THEN 'import' ELSE 'update_changed' END
      FROM matched m
     WHERE r.id = m.rid
    RETURNING r.id
  )
  SELECT count(*) INTO _processed FROM upd;

  -- Diffs apenas das linhas recém classificadas com produto correspondente
  WITH pairs AS (
    SELECT r.id AS rid, r.parsed AS p, to_jsonb(bp) AS s
    FROM product_sheet_rows r
    JOIN bling_products bp ON bp.id = r.match_product_id
    WHERE r.batch_id = _batch_id
      AND r.match_product_id IS NOT NULL
      AND r.diff IS NULL
      AND r.applied_at IS NULL
    ORDER BY r.row_number
    LIMIT _limit
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

  SELECT count(*) FILTER (WHERE match_type IS NULL),
         count(*) FILTER (WHERE match_type IS NOT NULL),
         count(*) FILTER (WHERE match_type = 'none'),
         count(*) FILTER (WHERE match_type IS NOT NULL AND match_type <> 'none')
    INTO _pending, _done, _new, _existing
  FROM product_sheet_rows
  WHERE batch_id = _batch_id;

  IF _pending = 0 THEN
    UPDATE import_batches
       SET status = 'aguardando_revisao',
           new_count = _new,
           existing_count = _existing,
           classify_processed = _total,
           finished_at = now()
     WHERE id = _batch_id;
  ELSE
    UPDATE import_batches
       SET new_count = _new,
           existing_count = _existing,
           classify_processed = _done
     WHERE id = _batch_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'done', _pending = 0,
    'processed', _processed,
    'remaining', _pending,
    'new', _new,
    'existing', _existing
  );
END;
$fn$;
