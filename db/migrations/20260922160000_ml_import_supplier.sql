-- Mercado Livre como fornecedor (garimpo de produtos):
-- 1) fornecedor global 'mercadolivre' + prefixo de SKU 'ML';
-- 2) RPC que importa itens garimpados como produtos da empresa,
--    alimentando fornecedor_produtos (a precificação trata o ML como
--    qualquer outro fornecedor) e ml_product_matches (piso de estoque 4
--    e recotação diária de preço/estoque).

insert into public.fornecedores (codigo, nome, source_type, preco_embalagem, preco_transporte, taxa_devolucao, taxa_promocao)
values ('mercadolivre', 'Mercado Livre', 'mercadolivre', 0, 0, 0, 0)
on conflict (codigo) do nothing;

insert into public.supplier_prefix_map (prefix, supplier_codigo)
values ('ML', 'mercadolivre')
on conflict (prefix) do update set supplier_codigo = excluded.supplier_codigo;

create or replace function public.import_ml_prospect_items(_company_id uuid, _item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout to '0'
as $$
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
begin
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
    select i.* from public.ml_prospect_items i where i.id = any(_item_ids)
  loop
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
      rec.ncm, rec.ean, rec.thumbnail,
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
      link_externo, source, dirty, detail_synced
    ) values (
      _company_id, _sku, left(coalesce(rec.titulo, _sku), 250),
      rec.custo, rec.custo, 0,
      '3 meses', '3', 'Ativo', rec.marca, rec.ncm, rec.cest,
      rec.weight_kg, rec.weight_kg, rec.width_cm, rec.height_cm, rec.length_cm,
      rec.ean, rec.ean, rec.thumbnail,
      (select string_agg(u, '|') from jsonb_array_elements_text(coalesce(rec.pictures, '[]'::jsonb)) u),
      'Garantia: 3 meses | Código Anatel: a verificar | Anvisa: Isento',
      left(coalesce(rec.titulo, _sku), 250),
      '0', 'Mercado Livre', _fornecedor_id,
      rec.permalink, 'garimpo_ml', true, false
    )
    returning id into _new_id;

    -- Entra no mapeamento ML: vale o piso de estoque 4 e a recotação diária.
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
      true, rec.available_quantity, true, '87020000', true,
      rec.catalog_product_id
    )
    on conflict (product_id) do nothing;

    _ids := _ids || _new_id;
    _skus := _skus || _sku;
    _imported := _imported + 1;
  end loop;

  return jsonb_build_object(
    'imported', _imported,
    'skipped', _skipped,
    'product_ids', to_jsonb(_ids),
    'skus', to_jsonb(_skus)
  );
end;
$$;

grant execute on function public.import_ml_prospect_items(uuid, uuid[]) to authenticated;
