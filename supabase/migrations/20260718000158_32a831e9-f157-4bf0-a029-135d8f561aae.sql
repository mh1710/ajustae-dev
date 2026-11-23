CREATE OR REPLACE FUNCTION public.transform_sync_supplier_stock_price(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  _total int := 0;
  _found int := 0;
  _not_found int := 0;
  _price_updated int := 0;
  _stock_updated int := 0;
  _both_updated int := 0;
  _unchanged int := 0;
  _no_supplier int := 0;
  _items jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  CREATE TEMP TABLE _work ON COMMIT DROP AS
  WITH prods AS (
    SELECT p.id, p.codigo AS sku, p.nome,
           p.preco_custo AS preco_atual,
           p.estoque AS estoque_atual,
           upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix,
           btrim(substring(p.codigo from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
  ),
  mapped AS (
    SELECT pr.*,
      CASE prefix
        WHEN 'ODS' THEN 'oderco' WHEN 'O' THEN 'oderco'
        WHEN 'HX' THEN 'hayamax' WHEN 'HA' THEN 'hayamax'
        WHEN 'EV' THEN 'evolusom' WHEN 'E' THEN 'evolusom'
        ELSE NULL END AS sup_codigo
    FROM prods pr
  ),
  joined AS (
    SELECT m.*,
      s.id AS sup_id, s.nome AS sup_nome,
      fp.qt_estoque AS fp_estoque,
      COALESCE(
        NULLIF((fp.precos->>'PR')::numeric, 0),
        NULLIF((fp.precos->>'base')::numeric, 0),
        NULLIF((fp.precos->>'dropshipping')::numeric, 0),
        NULLIF((fp.precos->>'crossdocking')::numeric, 0)
      ) AS fp_preco
    FROM mapped m
    LEFT JOIN public.fornecedores s
      ON s.company_id = _company_id AND s.codigo = m.sup_codigo
    LEFT JOIN public.fornecedor_produtos fp
      ON fp.fornecedor_id = s.id AND btrim(fp.codigo) = m.num_code AND m.num_code <> ''
  )
  SELECT * FROM joined;

  SELECT count(*) INTO _total FROM _work;

  WITH upd AS (
    UPDATE public.bling_products bp SET
      preco_custo = CASE
        WHEN w.fp_preco IS NOT NULL AND (bp.preco_custo IS DISTINCT FROM w.fp_preco)
        THEN w.fp_preco ELSE bp.preco_custo END,
      estoque = CASE
        WHEN w.fp_estoque IS NOT NULL AND (bp.estoque IS DISTINCT FROM w.fp_estoque)
        THEN w.fp_estoque ELSE bp.estoque END,
      dirty = CASE
        WHEN (w.fp_preco IS NOT NULL AND bp.preco_custo IS DISTINCT FROM w.fp_preco)
          OR (w.fp_estoque IS NOT NULL AND bp.estoque IS DISTINCT FROM w.fp_estoque)
        THEN true ELSE bp.dirty END,
      updated_at = now()
    FROM _work w
    WHERE bp.id = w.id
      AND w.sup_id IS NOT NULL
      AND w.fp_estoque IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) FROM upd INTO _both_updated;
  -- _both_updated recomputed below; discard here

  SELECT
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL),
    count(*) FILTER (WHERE sup_codigo IS NOT NULL AND (sup_id IS NULL OR fp_estoque IS NULL)),
    count(*) FILTER (WHERE sup_codigo IS NULL),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco
        AND (estoque_atual IS NOT DISTINCT FROM fp_estoque)),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND estoque_atual IS DISTINCT FROM fp_estoque
        AND (fp_preco IS NULL OR preco_atual IS NOT DISTINCT FROM fp_preco)),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco
        AND estoque_atual IS DISTINCT FROM fp_estoque),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND (fp_preco IS NULL OR preco_atual IS NOT DISTINCT FROM fp_preco)
        AND estoque_atual IS NOT DISTINCT FROM fp_estoque)
  INTO _found, _not_found, _no_supplier, _price_updated, _stock_updated, _both_updated, _unchanged
  FROM _work;

  SELECT jsonb_agg(row_to_json(t)) INTO _items FROM (
    SELECT
      sku, nome, sup_codigo AS fornecedor,
      CASE
        WHEN sup_codigo IS NULL THEN 'sem_fornecedor'
        WHEN sup_id IS NULL OR fp_estoque IS NULL THEN 'nao_encontrado'
        WHEN (fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco)
          AND estoque_atual IS DISTINCT FROM fp_estoque THEN 'preco_e_estoque_atualizados'
        WHEN (fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco) THEN 'preco_atualizado'
        WHEN estoque_atual IS DISTINCT FROM fp_estoque THEN 'estoque_atualizado'
        ELSE 'inalterado'
      END AS status,
      preco_atual, fp_preco AS preco_novo,
      estoque_atual, fp_estoque AS estoque_novo
    FROM _work
    ORDER BY sku
  ) t;

  RETURN jsonb_build_object(
    'total', _total,
    'encontrados', _found,
    'nao_encontrados', _not_found,
    'sem_fornecedor', _no_supplier,
    'preco_atualizado', _price_updated,
    'estoque_atualizado', _stock_updated,
    'preco_e_estoque_atualizados', _both_updated,
    'inalterados', _unchanged,
    'items', COALESCE(_items, '[]'::jsonb)
  );
END;
$function$;