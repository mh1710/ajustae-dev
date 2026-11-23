-- Vínculo de fornecedor: preço de custo vem do catálogo do fornecedor (fornecedor_produtos),
-- usando o código sem prefixo; se não achar, usa o preço de custo do produto.
CREATE OR REPLACE FUNCTION public.enqueue_supplier_links(_company_id uuid, _mode text, _product_ids uuid[] DEFAULT NULL::uuid[], _bling_supplier_id text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _integ uuid; _n int := 0; _skipped int := 0;
BEGIN
  IF NOT app_private.is_company_member(_company_id, auth.uid()) THEN RAISE EXCEPTION 'not a member of company'; END IF;
  SELECT id INTO _integ FROM public.bling_integrations WHERE company_id = _company_id LIMIT 1;
  IF _integ IS NULL THEN RAISE EXCEPTION 'Empresa sem integração Bling'; END IF;
  IF _mode = 'manual' AND COALESCE(_bling_supplier_id, '') = '' THEN RAISE EXCEPTION 'Fornecedor não informado'; END IF;

  CREATE TEMP TABLE _cand ON COMMIT DROP AS
  SELECT p.id, p.bling_product_id, p.preco_custo,
         NULLIF(btrim(substring(btrim(coalesce(p.codigo,'')) from '^[A-Za-z]+(.*)$')), '') AS cod_forn,
         CASE WHEN _mode = 'manual' THEN _bling_supplier_id
              ELSE (SELECT m.bling_supplier_id FROM public.bling_supplier_map m
                    WHERE m.company_id = _company_id AND m.supplier_codigo = public.map_sku_prefix(p.codigo)
                    ORDER BY m.bling_supplier_id LIMIT 1) END AS forn,
         CASE WHEN _mode = 'manual' THEN (SELECT m.supplier_codigo FROM public.bling_supplier_map m
                    WHERE m.company_id = _company_id AND m.bling_supplier_id = _bling_supplier_id)
              ELSE public.map_sku_prefix(p.codigo) END AS sup_cod
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
    AND NOT EXISTS (SELECT 1 FROM public.bling_product_suppliers s WHERE s.company_id = _company_id AND s.product_id = p.id);

  SELECT count(*) FILTER (WHERE forn IS NULL OR bling_product_id IS NULL OR bling_product_id = '') INTO _skipped FROM _cand;

  INSERT INTO public.bling_push_queue (company_id, integration_id, product_id, bling_product_id, tipo, valor_novo, payload)
  SELECT _company_id, _integ, c.id, c.bling_product_id, 'fornecedor_vinculo', 0,
         jsonb_build_object('bling_supplier_id', c.forn, 'codigo', COALESCE(c.cod_forn, ''),
           'preco_custo', COALESCE((
             SELECT COALESCE(NULLIF((fp.precos->>'PR')::numeric,0), NULLIF((fp.precos->>'base')::numeric,0),
                             NULLIF((fp.precos->>'dropshipping')::numeric,0), NULLIF((fp.precos->>'crossdocking')::numeric,0))
             FROM public.fornecedor_produtos fp JOIN public.fornecedores f ON f.id = fp.fornecedor_id
             WHERE f.codigo = c.sup_cod AND c.cod_forn IS NOT NULL
               AND ltrim(fp.codigo, '0') = ltrim(c.cod_forn, '0')
             LIMIT 1), NULLIF(c.preco_custo, 0)))
  FROM _cand c
  WHERE c.forn IS NOT NULL AND COALESCE(c.bling_product_id, '') <> ''
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('enqueued', _n, 'skipped', _skipped);
END $function$;
NOTIFY pgrst, 'reload schema';
