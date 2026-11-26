-- Garimpo pela Amazon: fornecedor Amazon (prefixo AMZ + EAN), cadastro, estoque diário e campos automáticos.
INSERT INTO public.fornecedores (codigo, nome, source_type, preco_embalagem, preco_transporte, taxa_devolucao, taxa_promocao)
VALUES ('amazon', 'Amazon', 'amazon', 0, 0, 0, 0) ON CONFLICT (codigo) DO NOTHING;
INSERT INTO public.supplier_prefix_map (prefix, supplier_codigo) VALUES ('AMZ', 'amazon') ON CONFLICT (prefix) DO NOTHING;

CREATE OR REPLACE FUNCTION public.import_amazon_prospect_items(_company_id uuid, _item_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '0'
AS $function$
declare
  _fornecedor_id uuid; _imported int := 0; _skipped int := 0; _ids uuid[] := '{}'; _skus text[] := '{}';
  rec record; _ean text; _sku text; _new_id uuid; _price numeric; _stock numeric;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  if auth.uid() is not null and not exists (select 1 from public.company_users where company_id=_company_id and user_id=auth.uid() and ativo=true) then
    raise exception 'not a member of company';
  end if;
  select id into _fornecedor_id from public.fornecedores where codigo='amazon';
  for rec in select i.* from public.ml_prospect_items i where i.id = any(_item_ids) FOR UPDATE loop
    IF coalesce(rec.raw->>'source','') <> 'amazon' THEN RAISE EXCEPTION 'Produto não veio do garimpo da Amazon'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ml_prospect_approvals a WHERE a.company_id=_company_id AND a.item_id=rec.id
      AND a.expires_at > now() AND a.item_snapshot=to_jsonb(rec)) THEN
      RAISE EXCEPTION 'Produto sem aprovação completa e atual de auditoria';
    END IF;
    _ean := regexp_replace(coalesce(rec.ean,''), '\D', '', 'g');
    if _ean !~ '^\d{8,14}$' then _skipped := _skipped + 1; continue; end if;
    _sku := 'AMZ' || _ean;
    if exists (select 1 from public.bling_products p where p.company_id=_company_id and p.codigo=_sku) then
      _skipped := _skipped + 1; continue;
    end if;
    select a.sale_price into _price from public.ml_prospect_approvals a where a.company_id=_company_id and a.item_id=rec.id;
    -- Prime offer checked at import: stock cap 10 while the 40% margin over the Amazon cost holds.
    _stock := CASE WHEN _price >= coalesce(rec.total_price, rec.custo) * 1.4 THEN least(10, greatest(0, coalesce(rec.available_quantity, 10))) ELSE 0 END;

    insert into public.fornecedor_produtos (
      fornecedor_id, codigo, marca, categoria, titulo, estoque, qt_estoque,
      peso, altura, largura, comprimento, ncm, codigobarras, foto, tempo_garantia, precos, raw
    ) values (
      _fornecedor_id, _ean, rec.marca, rec.category_path, rec.titulo, _stock::text, _stock,
      rec.weight_kg, rec.height_cm, rec.width_cm, rec.length_cm, rec.ncm, rec.ean,
      (select string_agg(u, '|') from jsonb_array_elements_text(rec.pictures) u), '3 meses',
      jsonb_build_object('base', rec.custo),
      jsonb_build_object('asin', rec.raw->>'asin', 'permalink', rec.permalink, 'shipping_cost', rec.shipping_cost, 'offer_checked_at', now())
    )
    on conflict (fornecedor_id, codigo) do update
      set qt_estoque=excluded.qt_estoque, estoque=excluded.estoque, precos=excluded.precos, titulo=excluded.titulo,
          foto=excluded.foto, raw=coalesce(public.fornecedor_produtos.raw,'{}'::jsonb) || excluded.raw, ativo=true, updated_at=now();

    insert into public.bling_products (
      company_id, codigo, nome, preco_custo, preco_compra, estoque,
      garantia, cross_docking, situacao, marca, ncm, cest,
      peso_bruto, peso_liquido, largura, altura, profundidade,
      gtin, gtin_embalagem, imagem_principal_url, url_imagens_externas,
      descricao_curta, descricao_complementar, origem_fiscal, fornecedor, fornecedor_id,
      link_externo, source, dirty, detail_synced, preco, unidade_medida, condicao_produto, tipo_producao
    ) values (
      _company_id, _sku, left(coalesce(rec.raw->'review'->>'titulo', rec.titulo, _sku), 250),
      rec.custo, rec.custo, _stock,
      '3 meses', '3', 'Ativo', rec.marca, rec.ncm, rec.cest,
      rec.weight_kg, rec.weight_kg, rec.width_cm, rec.height_cm, rec.length_cm,
      rec.ean, rec.ean, rec.thumbnail,
      (select string_agg(u, '|') from jsonb_array_elements_text(coalesce(rec.pictures, '[]'::jsonb)) u),
      rec.raw->'review'->>'descricao_curta', left(coalesce(rec.raw->'review'->>'titulo', rec.titulo, _sku), 250),
      '0', 'Amazon', _fornecedor_id, rec.permalink, 'garimpo_amz', true, false, _price, 'Centímetros', 'Novo', 'Terceiros'
    ) returning id into _new_id;

    _ids := _ids || _new_id; _skus := _skus || _sku; _imported := _imported + 1;
  end loop;
  IF cardinality(_ids)>0 THEN PERFORM public.enqueue_bling_push(_company_id, _ids, 'criar', false, false); END IF;
  DELETE FROM public.ml_prospect_approvals WHERE company_id=_company_id AND item_id=ANY(_item_ids);
  return jsonb_build_object('imported', _imported, 'skipped', _skipped, 'product_ids', to_jsonb(_ids), 'skus', to_jsonb(_skus));
end;
$function$;
REVOKE ALL ON FUNCTION public.import_amazon_prospect_items(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_amazon_prospect_items(uuid, uuid[]) TO authenticated, service_role;

-- Daily Amazon recheck: Amazon products not rechecked in 20 h (oldest first).
CREATE OR REPLACE FUNCTION public.amazon_prospect_refresh_due(_limit integer)
 RETURNS TABLE(codigo text, asin text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT fp.codigo, fp.raw->>'asin'
  FROM public.fornecedor_produtos fp JOIN public.fornecedores f ON f.id=fp.fornecedor_id AND f.codigo='amazon'
  WHERE fp.raw->>'asin' IS NOT NULL
    AND coalesce((fp.raw->>'offer_checked_at')::timestamptz, 'epoch') < now() - interval '20 hours'
    AND EXISTS (SELECT 1 FROM public.bling_products p WHERE p.source='garimpo_amz' AND p.codigo='AMZ'||fp.codigo)
  ORDER BY coalesce((fp.raw->>'offer_checked_at')::timestamptz, 'epoch')
  LIMIT greatest(1, least(_limit, 200));
$function$;
REVOKE ALL ON FUNCTION public.amazon_prospect_refresh_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amazon_prospect_refresh_due(integer) TO service_role;

-- Applies one Amazon recheck. _ok=false (consultation failed) keeps price and stock; only the check time moves.
-- Without a Prime offer, or when the sale price no longer covers 40% over the cost, stock goes to 0; otherwise cap 10.
CREATE OR REPLACE FUNCTION public.apply_amazon_prospect_offer(_ean text, _ok boolean, _total numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE f uuid; p record; target numeric; changed uuid[] := '{}'; companies uuid[] := '{}';
BEGIN
  SELECT id INTO f FROM public.fornecedores WHERE codigo='amazon';
  IF NOT _ok THEN
    UPDATE public.fornecedor_produtos SET raw = coalesce(raw,'{}'::jsonb) || jsonb_build_object('offer_checked_at', now(), 'offer_error', true)
    WHERE fornecedor_id=f AND codigo=_ean;
    RETURN jsonb_build_object('changed', '[]'::jsonb);
  END IF;
  UPDATE public.fornecedor_produtos SET
    precos = CASE WHEN _total > 0 THEN jsonb_build_object('base', _total) ELSE precos END,
    raw = (coalesce(raw,'{}'::jsonb) - 'offer_error') || jsonb_build_object('offer_checked_at', now(), 'prime_total', _total),
    qt_estoque = CASE WHEN _total > 0 THEN 10 ELSE 0 END, estoque = CASE WHEN _total > 0 THEN '10' ELSE '0' END, updated_at = now()
  WHERE fornecedor_id=f AND codigo=_ean;
  FOR p IN SELECT * FROM public.bling_products WHERE source='garimpo_amz' AND codigo='AMZ'||_ean FOR UPDATE LOOP
    target := CASE WHEN _total > 0 AND p.preco >= _total * 1.4 THEN 10 ELSE 0 END;
    IF p.estoque IS DISTINCT FROM target THEN
      UPDATE public.bling_products SET estoque=target, dirty=true, updated_at=now() WHERE id=p.id;
      changed := changed || p.id; companies := companies || p.company_id;
    END IF;
  END LOOP;
  FOR p IN SELECT DISTINCT c AS company_id FROM unnest(companies) c LOOP
    PERFORM public.enqueue_ml_prospect_stock(p.company_id, (SELECT array_agg(b.id) FROM public.bling_products b WHERE b.id = ANY(changed) AND b.company_id = p.company_id));
  END LOOP;
  RETURN jsonb_build_object('changed', to_jsonb(changed));
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_amazon_prospect_offer(text, boolean, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_amazon_prospect_offer(text, boolean, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_bling_push_created(_item_id uuid, _bling_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _pid uuid; _company uuid; _source text;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  UPDATE public.bling_push_queue
     SET status = 'concluido', erro = NULL, processed_at = now(), updated_at = now(),
         bling_product_id = _bling_id
   WHERE id = _item_id
   RETURNING product_id INTO _pid;

  IF _pid IS NULL THEN RETURN; END IF;

  UPDATE public.bling_products SET
    bling_product_id = _bling_id,
    sincronizado_em = now(),
    sincronizacao_status = 'ok',
    sincronizacao_erro = NULL
  WHERE id = _pid
  RETURNING company_id, source INTO _company, _source;

  -- Bling creates products with zero stock: garimpo products send their stock right after creation.
  IF _source IN ('garimpo_ml', 'garimpo_amz', 'catalogo_fornecedor') THEN
    BEGIN
      PERFORM public.enqueue_ml_prospect_stock(_company, ARRAY[_pid]);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'estoque do garimpo não enfileirado para %: %', _pid, SQLERRM;
    END;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.enqueue_ml_prospect_stock(_company_id uuid, _product_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE integ record; n integer;
BEGIN
 SELECT id,default_deposito_id INTO integ FROM public.bling_integrations
 WHERE company_id=_company_id AND status='conectada' LIMIT 1;
 IF NOT FOUND THEN RETURN 0; END IF;
 PERFORM public.prepare_deposit_stock_targets(_company_id,_product_ids,true);
 INSERT INTO public.bling_push_queue(company_id,integration_id,product_id,bling_product_id,bling_deposit_id,tipo,valor_anterior,valor_novo)
 SELECT p.company_id,integ.id,p.id,p.bling_product_id,integ.default_deposito_id,'estoque',p.ultimo_estoque_sincronizado,p.estoque
 FROM public.bling_products p
 WHERE p.company_id=_company_id AND p.id=ANY(_product_ids) AND p.source IN ('garimpo_ml','garimpo_amz','catalogo_fornecedor')
 AND p.bling_product_id IS NOT NULL AND p.situacao IN ('A','Ativo','ativo','ATIVO')
 AND (EXISTS(SELECT 1 FROM public.bling_product_deposit_stock s WHERE s.product_id=p.id AND s.pendente)
 OR (NOT EXISTS(SELECT 1 FROM public.bling_stock_deposits d WHERE d.company_id=_company_id AND d.ativo)
 AND integ.default_deposito_id IS NOT NULL AND p.ultimo_estoque_sincronizado IS DISTINCT FROM p.estoque))
 ON CONFLICT (integration_id,product_id,tipo) WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
 DO UPDATE SET valor_novo=excluded.valor_novo,updated_at=now();
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.custom_field_auto_base(_product_ids uuid[])
 RETURNS TABLE(product_id uuid, bling_product_id text, codigo text, gtin text, nome text, nome_fornecedor text, anatel text, modelo_fornecedor text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.bling_product_id, p.codigo, p.gtin, p.nome, x.nome,
    coalesce(g.anatel, public.anatel_code_for(p.codigo, p.gtin), 'Isento'),
    x.modelo
  FROM bling_products p
  LEFT JOIN LATERAL (
    SELECT NULLIF(btrim(COALESCE(fp.titulo, fp.nome_nota)), '') AS nome,
      (SELECT m[1] FROM regexp_matches(coalesce(fp.descricao_tecnica,''), 'modelo\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\-\./]{1,30})', 'i') m
        WHERE m[1] ~ '\d' AND m[1] !~* '\.(png|jpe?g|gif|webp)$' LIMIT 1) AS modelo
    FROM fornecedores f JOIN fornecedor_produtos fp ON fp.fornecedor_id = f.id
    WHERE f.codigo = public.map_sku_prefix(p.codigo)
      AND ltrim(fp.codigo, '0') = ltrim(regexp_replace(btrim(p.codigo), '^[A-Za-z]+', ''), '0')
    LIMIT 1
  ) x ON true
  -- Garimpo: the Anatel code confirmed in the pre-import review of the same catalog product.
  LEFT JOIN LATERAL (
    SELECT btrim(i.raw->'review'->>'anatel') AS anatel
    FROM ml_prospect_items i
    WHERE ((p.source = 'garimpo_ml'
      AND i.catalog_product_id = 'MLB' || regexp_replace(btrim(p.codigo), '^ML', '', 'i'))
      OR (p.source = 'garimpo_amz' AND i.raw->>'source' = 'amazon'
      AND i.ean = regexp_replace(btrim(p.codigo), '^AMZ', '', 'i')))
      AND (i.raw->'review'->>'anatel_confirmed')::boolean IS TRUE
      AND btrim(i.raw->'review'->>'anatel') ~ '^\d{5}-\d{2}-\d{5}$'
    ORDER BY i.created_at DESC
    LIMIT 1
  ) g ON true
  WHERE p.id = ANY(_product_ids)
$function$;
-- cron: amazon-refresh-tick (20 * * * *) → /api/public/amazon/refresh-tick, applied with cron.schedule
