CREATE OR REPLACE FUNCTION public.apply_import_batch(_batch_id uuid, _company_id uuid, _default_new text, _default_existing text, _overrides jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  _imported int := 0;
  _updated int := 0;
  _ignored int := 0;
  _dups int := 0;
  _total int;
BEGIN
  UPDATE product_sheet_rows
     SET action = _default_new
   WHERE batch_id = _batch_id AND match_type = 'none' AND applied_at IS NULL;

  UPDATE product_sheet_rows
     SET action = _default_existing
   WHERE batch_id = _batch_id AND match_type <> 'none' AND applied_at IS NULL;

  IF _overrides IS NOT NULL AND jsonb_array_length(_overrides) > 0 THEN
    UPDATE product_sheet_rows r
       SET action = (o->>'action')
      FROM jsonb_array_elements(_overrides) o
     WHERE r.id = (o->>'id')::uuid
       AND r.batch_id = _batch_id
       AND r.applied_at IS NULL;
  END IF;

  -- Deduplicate: keep only the LAST row per codigo (new) / per matched product (existing)
  WITH dupnew AS (
    SELECT id FROM (
      SELECT r.id,
             row_number() OVER (
               PARTITION BY lower(btrim(r.parsed->>'codigo'))
               ORDER BY r.row_number DESC, r.id DESC
             ) AS rn
        FROM product_sheet_rows r
       WHERE r.batch_id = _batch_id
         AND r.applied_at IS NULL
         AND r.action = 'import'
         AND r.match_type = 'none'
         AND COALESCE(NULLIF(btrim(r.parsed->>'codigo'), ''), '') <> ''
    ) t WHERE rn > 1
  ), dupex AS (
    SELECT id FROM (
      SELECT r.id,
             row_number() OVER (
               PARTITION BY r.match_product_id
               ORDER BY r.row_number DESC, r.id DESC
             ) AS rn
        FROM product_sheet_rows r
       WHERE r.batch_id = _batch_id
         AND r.applied_at IS NULL
         AND r.match_product_id IS NOT NULL
         AND r.action IN ('update_all', 'update_changed')
    ) t WHERE rn > 1
  ), marked AS (
    UPDATE product_sheet_rows r
       SET applied_at = now(),
           action = 'ignore',
           error = COALESCE(r.error, 'Linha duplicada na planilha (mesmo codigo). Apenas a ultima linha foi aplicada.')
     WHERE r.id IN (SELECT id FROM dupnew UNION SELECT id FROM dupex)
    RETURNING 1
  )
  SELECT count(*) INTO _dups FROM marked;

  SELECT count(*) INTO _total FROM product_sheet_rows WHERE batch_id = _batch_id;

  UPDATE import_batches
     SET status = 'aplicando',
         apply_total = _total,
         apply_processed = (
           SELECT count(*) FROM product_sheet_rows
            WHERE batch_id = _batch_id AND applied_at IS NOT NULL
         ),
         new_count = 0,
         updated_count = 0,
         ignored_count = 0
   WHERE id = _batch_id;

  WITH ig AS (
    UPDATE product_sheet_rows
       SET applied_at = now()
     WHERE batch_id = _batch_id AND applied_at IS NULL AND action = 'ignore'
    RETURNING 1
  )
  SELECT count(*) INTO _ignored FROM ig;

  WITH src AS (
    SELECT DISTINCT ON (lower(btrim(r.parsed->>'codigo')))
           r.id AS rid,
           (jsonb_populate_record(
              NULL::bling_products,
              r.parsed
                || jsonb_build_object('company_id', _company_id::text, 'source', 'planilha')
           )).*
      FROM product_sheet_rows r
     WHERE r.batch_id = _batch_id
       AND r.applied_at IS NULL
       AND r.action = 'import'
       AND r.match_type = 'none'
       AND COALESCE(NULLIF(btrim(r.parsed->>'codigo'), ''), '') <> ''
     ORDER BY lower(btrim(r.parsed->>'codigo')), r.row_number DESC, r.id DESC
  ),
  ins AS (
    INSERT INTO bling_products (
      company_id, bling_product_id, codigo, nome, descricao_complementar, descricao_curta, observacoes,
      unidade, unidade_medida, ncm, origem_fiscal, situacao, gtin, gtin_embalagem, marca, categoria_produto,
      fornecedor, cod_fornecedor, localizacao, grupo_produtos, grupo_tags, tipo_item, tipo_producao,
      produto_variacao, codigo_pai, codigo_integracao, departamento, condicao_produto, frete_gratis,
      cross_docking, clonar_dados_pai, meses_garantia_fornecedor, numero_fci, cest, classe_ipi,
      codigo_lista_servicos, tributos, descricao_fornecedor, informacoes_adicionais, url_imagens_externas,
      link_externo, video, preco, preco_custo, preco_compra, valor_ipi_fixo, icms_st_base, icms_st_retencao,
      icms_proprio_substituto, estoque, estoque_minimo, estoque_maximo, itens_caixa, volumes,
      peso_liquido, peso_bruto, largura, altura, profundidade, data_validade, source, last_imported_at
    )
    SELECT company_id, bling_product_id, codigo, nome, descricao_complementar, descricao_curta, observacoes,
      unidade, unidade_medida, ncm, origem_fiscal, situacao, gtin, gtin_embalagem, marca, categoria_produto,
      fornecedor, cod_fornecedor, localizacao, grupo_produtos, grupo_tags, tipo_item, tipo_producao,
      produto_variacao, codigo_pai, codigo_integracao, departamento, condicao_produto, frete_gratis,
      cross_docking, clonar_dados_pai, meses_garantia_fornecedor, numero_fci, cest, classe_ipi,
      codigo_lista_servicos, tributos, descricao_fornecedor, informacoes_adicionais, url_imagens_externas,
      link_externo, video, preco, preco_custo, preco_compra, valor_ipi_fixo, icms_st_base, icms_st_retencao,
      icms_proprio_substituto, estoque, estoque_minimo, estoque_maximo, itens_caixa, volumes,
      peso_liquido, peso_bruto, largura, altura, profundidade, data_validade, 'planilha', now()
    FROM src
    ON CONFLICT (company_id, codigo) DO UPDATE SET
      last_imported_at = EXCLUDED.last_imported_at
    RETURNING 1
  )
  SELECT count(*) INTO _imported FROM ins;

  UPDATE product_sheet_rows
     SET applied_at = now()
   WHERE batch_id = _batch_id
     AND applied_at IS NULL
     AND action = 'import'
     AND match_type = 'none';

  WITH src AS (
    SELECT DISTINCT ON (r.match_product_id)
           r.id AS rid,
           r.match_product_id AS pid,
           r.action AS act,
           jsonb_populate_record(NULL::bling_products, r.parsed) AS rec
      FROM product_sheet_rows r
     WHERE r.batch_id = _batch_id
       AND r.applied_at IS NULL
       AND r.match_product_id IS NOT NULL
       AND (
         r.action = 'update_all'
         OR (r.action = 'update_changed' AND r.diff IS NOT NULL AND jsonb_array_length(r.diff) > 0)
       )
     ORDER BY r.match_product_id, r.row_number DESC, r.id DESC
  ),
  upd AS (
    UPDATE bling_products bp SET
      bling_product_id = COALESCE((s.rec).bling_product_id, bp.bling_product_id),
      nome = (s.rec).nome,
      descricao_complementar = (s.rec).descricao_complementar,
      descricao_curta = (s.rec).descricao_curta,
      observacoes = (s.rec).observacoes,
      unidade = (s.rec).unidade,
      unidade_medida = (s.rec).unidade_medida,
      ncm = (s.rec).ncm,
      origem_fiscal = (s.rec).origem_fiscal,
      situacao = (s.rec).situacao,
      gtin = (s.rec).gtin,
      gtin_embalagem = (s.rec).gtin_embalagem,
      marca = (s.rec).marca,
      categoria_produto = (s.rec).categoria_produto,
      fornecedor = (s.rec).fornecedor,
      cod_fornecedor = (s.rec).cod_fornecedor,
      localizacao = (s.rec).localizacao,
      grupo_produtos = (s.rec).grupo_produtos,
      grupo_tags = (s.rec).grupo_tags,
      tipo_item = (s.rec).tipo_item,
      tipo_producao = (s.rec).tipo_producao,
      produto_variacao = (s.rec).produto_variacao,
      codigo_pai = (s.rec).codigo_pai,
      codigo_integracao = (s.rec).codigo_integracao,
      departamento = (s.rec).departamento,
      condicao_produto = (s.rec).condicao_produto,
      frete_gratis = (s.rec).frete_gratis,
      cross_docking = (s.rec).cross_docking,
      clonar_dados_pai = (s.rec).clonar_dados_pai,
      meses_garantia_fornecedor = (s.rec).meses_garantia_fornecedor,
      numero_fci = (s.rec).numero_fci,
      cest = (s.rec).cest,
      classe_ipi = (s.rec).classe_ipi,
      codigo_lista_servicos = (s.rec).codigo_lista_servicos,
      tributos = (s.rec).tributos,
      descricao_fornecedor = (s.rec).descricao_fornecedor,
      informacoes_adicionais = (s.rec).informacoes_adicionais,
      url_imagens_externas = (s.rec).url_imagens_externas,
      link_externo = (s.rec).link_externo,
      video = (s.rec).video,
      preco = (s.rec).preco,
      preco_custo = (s.rec).preco_custo,
      preco_compra = (s.rec).preco_compra,
      valor_ipi_fixo = (s.rec).valor_ipi_fixo,
      icms_st_base = (s.rec).icms_st_base,
      icms_st_retencao = (s.rec).icms_st_retencao,
      icms_proprio_substituto = (s.rec).icms_proprio_substituto,
      estoque = (s.rec).estoque,
      estoque_minimo = (s.rec).estoque_minimo,
      estoque_maximo = (s.rec).estoque_maximo,
      itens_caixa = (s.rec).itens_caixa,
      volumes = (s.rec).volumes,
      peso_liquido = (s.rec).peso_liquido,
      peso_bruto = (s.rec).peso_bruto,
      largura = (s.rec).largura,
      altura = (s.rec).altura,
      profundidade = (s.rec).profundidade,
      data_validade = (s.rec).data_validade,
      source = 'planilha',
      last_imported_at = now(),
      dirty = CASE WHEN s.act = 'update_changed' THEN true ELSE bp.dirty END
    FROM src s
    WHERE bp.id = s.pid
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM upd;

  UPDATE product_sheet_rows
     SET applied_at = now()
   WHERE batch_id = _batch_id
     AND applied_at IS NULL
     AND match_product_id IS NOT NULL
     AND action IN ('update_all', 'update_changed');

  UPDATE product_sheet_rows
     SET applied_at = now(),
         error = COALESCE(error, 'Linha sem SKU ou sem correspondência.')
   WHERE batch_id = _batch_id AND applied_at IS NULL;

  UPDATE import_batches
     SET status = 'aplicada',
         applied_at = now(),
         apply_processed = _total,
         new_count = _imported,
         updated_count = _updated,
         ignored_count = _ignored
   WHERE id = _batch_id;

  RETURN jsonb_build_object('imported', _imported, 'updated', _updated, 'ignored', _ignored, 'duplicates', _dups);
END;
$function$;