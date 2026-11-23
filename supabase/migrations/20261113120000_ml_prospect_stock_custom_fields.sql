-- Garimpo: estoque calculado já na importação e enviado logo após o cadastro;
-- campos automáticos de Anatel usam o código conferido na importação.

CREATE OR REPLACE FUNCTION public.import_ml_prospect_items(_company_id uuid, _item_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
declare
  _fornecedor_id uuid;
  _imported int := 0;
  _skipped int := 0;
  _ids uuid[] := '{}';
  _skus text[] := '{}';
  rec record;
  _num text;
  _sku text;
  _new_id uuid;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  if auth.uid() is not null and not exists (
    select 1 from public.company_users
    where company_id = _company_id and user_id = auth.uid() and ativo = true
  ) then
    raise exception 'not a member of company';
  end if;

  select id into _fornecedor_id from public.fornecedores where codigo = 'mercadolivre';
  if _fornecedor_id is null then
    insert into public.fornecedores (codigo, nome, source_type, preco_embalagem, preco_transporte, taxa_devolucao, taxa_promocao)
    values ('mercadolivre', 'Mercado Livre', 'mercadolivre', 0, 0, 0, 0)
    returning id into _fornecedor_id;
  end if;

  for rec in
    select i.* from public.ml_prospect_items i where i.id = any(_item_ids) FOR UPDATE
  loop
    IF NOT EXISTS (SELECT 1 FROM public.ml_prospect_approvals a
      WHERE a.company_id=_company_id AND a.item_id=rec.id AND a.expires_at > now()
      AND a.item_snapshot=to_jsonb(rec)) THEN
      RAISE EXCEPTION 'Produto sem aprovação completa e atual de auditoria';
    END IF;
    _num := regexp_replace(upper(coalesce(rec.catalog_product_id, '')), '^MLB', '');
    if _num = '' then
      _skipped := _skipped + 1;
      continue;
    end if;
    _sku := 'ML' || _num;

    if exists (
      select 1 from public.bling_products p
      where p.company_id = _company_id and p.codigo = _sku
    ) then
      _skipped := _skipped + 1;
      continue;
    end if;

    -- Base do fornecedor: o preço de custo do ML entra como "base", igual às
    -- outras bases de fornecedor, então a precificação calcula igual.
    insert into public.fornecedor_produtos (
      fornecedor_id, codigo, marca, categoria, titulo, estoque, qt_estoque,
      peso, altura, largura, comprimento, ncm, codigobarras, foto,
      tempo_garantia, precos, raw
    ) values (
      _fornecedor_id, _num, rec.marca, rec.category_path, rec.titulo,
      coalesce(rec.available_quantity, 0)::text, greatest(coalesce(rec.available_quantity, 0), 0),
      rec.weight_kg, rec.height_cm, rec.width_cm, rec.length_cm,
      rec.ncm, rec.ean, (select string_agg(u, '|') from jsonb_array_elements_text(rec.pictures) u),
      '3 meses',
      jsonb_build_object('base', rec.custo),
      jsonb_build_object(
        'catalog_product_id', rec.catalog_product_id,
        'item_id', rec.item_id,
        'permalink', rec.permalink,
        'shipping_cost', rec.shipping_cost
      )
    )
    on conflict (fornecedor_id, codigo) do update
      set qt_estoque = excluded.qt_estoque,
          estoque = excluded.estoque,
          precos = excluded.precos,
          titulo = excluded.titulo,
          foto = excluded.foto,
          updated_at = now();

    insert into public.bling_products (
      company_id, codigo, nome,
      preco_custo, preco_compra, estoque,
      garantia, cross_docking, situacao, marca, ncm, cest,
      peso_bruto, peso_liquido, largura, altura, profundidade,
      gtin, gtin_embalagem, imagem_principal_url, url_imagens_externas,
      descricao_curta, descricao_complementar,
      origem_fiscal, fornecedor, fornecedor_id,
      link_externo, source, dirty, detail_synced, preco, unidade_medida, condicao_produto, tipo_producao
    ) values (
      _company_id, _sku, left(coalesce(rec.raw->'review'->>'titulo', rec.titulo, _sku), 250),
      rec.custo, rec.custo, 0,
      '3 meses', '3', 'Ativo', rec.marca, rec.ncm, rec.cest,
      rec.weight_kg, rec.weight_kg, rec.width_cm, rec.height_cm, rec.length_cm,
      rec.ean, rec.ean, rec.thumbnail,
      (select string_agg(u, '|') from jsonb_array_elements_text(coalesce(rec.pictures, '[]'::jsonb)) u),
      rec.raw->'review'->>'descricao_curta',
      left(coalesce(rec.raw->'review'->>'titulo', rec.titulo, _sku), 250),
      '0', 'Mercado Livre', _fornecedor_id,
      rec.permalink, 'garimpo_ml', true, false, (select a.sale_price from public.ml_prospect_approvals a where a.company_id=_company_id and a.item_id=rec.id), 'Centímetros', 'Novo', 'Terceiros'
    )
    returning id into _new_id;

    -- Entra no mapeamento ML: recotação diária de oferta e estoque.
    insert into public.ml_product_matches (
      company_id, product_id, sku, nome, ean, found, has_full,
      min_price, min_full_price, permalink, match_by, checked_at,
      best_item_id, best_price, best_shipping_cost, best_total_price,
      best_is_full, available_quantity, has_stock, zip_code, qualifies,
      catalog_product_id
    ) values (
      _company_id, _new_id, _sku, rec.titulo, rec.ean, true, true,
      rec.price, rec.price, rec.permalink, 'garimpo', now(),
      rec.item_id, rec.price, rec.shipping_cost, rec.total_price,
      true, greatest(coalesce((rec.raw->>'offers_full')::int, 0), coalesce(rec.available_quantity, 0)), true, '87020000', true,
      rec.catalog_product_id
    )
    on conflict (product_id) do nothing;
    -- Same stock rule as the daily refresh (offers available, cap 10), so the product is created with stock.
    PERFORM public.sync_ml_prospect_catalog_stock(_new_id);

    _ids := _ids || _new_id;
    _skus := _skus || _sku;
    _imported := _imported + 1;
  end loop;

  IF cardinality(_ids)>0 THEN
    PERFORM public.enqueue_bling_push(_company_id, _ids, 'criar', false, false);
  END IF;
  DELETE FROM public.ml_prospect_approvals WHERE company_id=_company_id AND item_id=ANY(_item_ids);
  return jsonb_build_object(
    'imported', _imported,
    'skipped', _skipped,
    'product_ids', to_jsonb(_ids),
    'skus', to_jsonb(_skus)
  );
end;
$function$;

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
  IF _source = 'garimpo_ml' THEN
    BEGIN
      PERFORM public.enqueue_ml_prospect_stock(_company, ARRAY[_pid]);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'estoque do garimpo não enfileirado para %: %', _pid, SQLERRM;
    END;
  END IF;
END; $function$;

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
    WHERE p.source = 'garimpo_ml'
      AND i.catalog_product_id = 'MLB' || regexp_replace(btrim(p.codigo), '^ML', '', 'i')
      AND (i.raw->'review'->>'anatel_confirmed')::boolean IS TRUE
      AND btrim(i.raw->'review'->>'anatel') ~ '^\d{5}-\d{2}-\d{5}$'
    ORDER BY i.created_at DESC
    LIMIT 1
  ) g ON true
  WHERE p.id = ANY(_product_ids)
$function$;
