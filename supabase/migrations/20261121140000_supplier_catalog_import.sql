-- Novos do fornecedor: produtos presentes na base do fornecedor e ausentes no
-- catálogo da empresa, importados por tarefa em lotes (lease + cron de 10 s).

-- Prefixo de SKU mais usado pela empresa para o fornecedor (desempate alfabético);
-- sem produtos do fornecedor, usa o prefixo mais longo do mapa central.
CREATE OR REPLACE FUNCTION public.supplier_catalog_prefix(_company_id uuid, _supplier_codigo text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(
    (SELECT m.prefix
       FROM public.bling_products p
       JOIN public.supplier_prefix_map m
         ON m.prefix = upper(substring(btrim(p.codigo) from '^[A-Za-z]+')) AND m.supplier_codigo = _supplier_codigo
      WHERE p.company_id = _company_id
      GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1),
    (SELECT m.prefix FROM public.supplier_prefix_map m
      WHERE m.supplier_codigo = _supplier_codigo ORDER BY length(m.prefix) DESC, m.prefix LIMIT 1));
$$;

-- Produtos ativos do fornecedor ausentes na empresa (código do fornecedor, sem
-- zeros à esquerda, em qualquer prefixo do mesmo fornecedor; ou EAN já cadastrado).
-- Elegível: custo > 10 e < 1000, peso < 30 kg e maior medida <= 70 cm (medidas
-- desconhecidas são completadas e reconferidas na importação).
CREATE OR REPLACE FUNCTION public.supplier_catalog_candidates(_company_id uuid, _fornecedor_id uuid)
RETURNS TABLE(
  fornecedor_produto_id uuid, codigo text, titulo text, marca text, ean text,
  custo numeric, qt_estoque numeric, peso numeric, altura numeric, largura numeric, comprimento numeric,
  ncm text, fotos integer, completo boolean, motivo text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '60s' AS $$
  WITH sup AS (
    SELECT f.id, f.codigo FROM public.fornecedores f WHERE f.id = _fornecedor_id AND f.codigo <> 'mercadolivre'
  ), cat AS (
    SELECT DISTINCT ltrim(btrim(regexp_replace(btrim(p.codigo), '^[A-Za-z]+', '')), '0') AS num
      FROM public.bling_products p
      JOIN sup ON true
      JOIN public.supplier_prefix_map m
        ON m.prefix = upper(substring(btrim(p.codigo) from '^[A-Za-z]+')) AND m.supplier_codigo = sup.codigo
     WHERE p.company_id = _company_id
  ), eans AS (
    SELECT DISTINCT v.g FROM public.bling_products p,
      LATERAL (VALUES (btrim(p.gtin)), (btrim(p.gtin_embalagem))) v(g)
     WHERE p.company_id = _company_id AND v.g ~ '^\d{8,14}$'
  ), fp AS (
    SELECT p.*,
      coalesce(nullif((p.precos->>'PR')::numeric, 0), nullif((p.precos->>'base')::numeric, 0),
               nullif((p.precos->>'dropshipping')::numeric, 0), nullif((p.precos->>'crossdocking')::numeric, 0)) AS custo_calc,
      greatest(coalesce(p.altura, 0), coalesce(p.largura, 0), coalesce(p.comprimento, 0)) AS maior,
      coalesce(array_length(array_remove(string_to_array(coalesce(p.foto, ''), '|'), ''), 1), 0) AS n_fotos
    FROM public.fornecedor_produtos p JOIN sup ON sup.id = p.fornecedor_id
    WHERE p.ativo
  )
  SELECT fp.id, btrim(fp.codigo), fp.titulo, fp.marca, nullif(btrim(fp.codigobarras), ''),
    fp.custo_calc, fp.qt_estoque, fp.peso, fp.altura, fp.largura, fp.comprimento, fp.ncm, fp.n_fotos,
    (btrim(coalesce(fp.codigobarras, '')) ~ '^\d{8,14}$'
      AND regexp_replace(coalesce(fp.ncm, ''), '\D', '', 'g') ~ '^\d{8}$'
      AND coalesce(fp.peso, 0) > 0 AND coalesce(fp.altura, 0) > 0 AND coalesce(fp.largura, 0) > 0 AND coalesce(fp.comprimento, 0) > 0
      AND btrim(coalesce(fp.marca, '')) <> '' AND fp.n_fotos >= 3
      AND length(btrim(regexp_replace(coalesce(fp.descricao_tecnica, ''), '<[^>]+>', ' ', 'g'))) >= 150),
    CASE
      WHEN fp.custo_calc IS NULL OR fp.custo_calc <= 10 OR fp.custo_calc >= 1000 THEN 'custo'
      WHEN coalesce(fp.peso, 0) >= 30 THEN 'peso'
      WHEN fp.maior > 70 THEN 'comprimento'
      ELSE NULL END
  FROM fp
  WHERE btrim(fp.codigo) <> ''
    AND NOT EXISTS (SELECT 1 FROM cat WHERE cat.num = ltrim(btrim(fp.codigo), '0'))
    AND NOT EXISTS (SELECT 1 FROM eans WHERE eans.g = btrim(coalesce(fp.codigobarras, '')));
$$;

CREATE OR REPLACE FUNCTION public.supplier_catalog_summary(_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s' AS $$
DECLARE _out jsonb := '[]'::jsonb; s record; r jsonb;
BEGIN
  FOR s IN SELECT f.id, f.codigo, f.nome FROM public.fornecedores f WHERE f.codigo <> 'mercadolivre' ORDER BY f.nome LOOP
    SELECT jsonb_build_object(
      'fornecedor_id', s.id, 'codigo', s.codigo, 'nome', s.nome,
      'prefixo', public.supplier_catalog_prefix(_company_id, s.codigo),
      'ativos', (SELECT count(*) FROM public.fornecedor_produtos p WHERE p.fornecedor_id = s.id AND p.ativo),
      'fora_catalogo', count(*),
      'elegiveis', count(*) FILTER (WHERE c.motivo IS NULL),
      'com_estoque', count(*) FILTER (WHERE c.motivo IS NULL AND coalesce(c.qt_estoque, 0) > 0),
      'completos', count(*) FILTER (WHERE c.motivo IS NULL AND c.completo),
      'fora_custo', count(*) FILTER (WHERE c.motivo = 'custo'),
      'fora_peso', count(*) FILTER (WHERE c.motivo = 'peso'),
      'fora_comprimento', count(*) FILTER (WHERE c.motivo = 'comprimento'))
    INTO r FROM public.supplier_catalog_candidates(_company_id, s.id) c;
    _out := _out || jsonb_build_array(r);
  END LOOP;
  RETURN _out;
END $$;

-- Preço (mesma fórmula de transform_update_price_stock, taxa do marketplace
-- padrão da empresa) e estoque (teto do fornecedor/empresa) de produtos do fornecedor.
CREATE OR REPLACE FUNCTION public.supplier_catalog_quote(_company_id uuid, _fp_ids uuid[])
RETURNS TABLE(fornecedor_produto_id uuid, custo numeric, preco numeric, estoque numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _pricing pricing_settings%ROWTYPE; _fee numeric;
BEGIN
  SELECT * INTO _pricing FROM public.pricing_settings ps WHERE ps.company_id = _company_id;
  SELECT public.company_marketplace_fee(_company_id, bs.marketplace_id) INTO _fee
    FROM public.bling_stores bs
   WHERE bs.company_id = _company_id AND bs.is_default = true AND bs.marketplace_id IS NOT NULL LIMIT 1;
  IF _fee IS NULL AND _pricing.default_marketplace_id IS NOT NULL THEN
    _fee := public.company_marketplace_fee(_company_id, _pricing.default_marketplace_id);
  END IF;
  RETURN QUERY
  WITH j AS (
    SELECT p.id, p.qt_estoque, s.preco_embalagem AS sup_emb, s.preco_transporte AS sup_transp,
      s.taxa_devolucao AS sup_devol, s.taxa_promocao AS sup_promo, s.stock_cap AS sup_cap,
      coalesce(nullif((p.precos->>'PR')::numeric, 0), nullif((p.precos->>'base')::numeric, 0),
               nullif((p.precos->>'dropshipping')::numeric, 0), nullif((p.precos->>'crossdocking')::numeric, 0)) AS fp_preco
    FROM public.fornecedor_produtos p JOIN public.fornecedores s ON s.id = p.fornecedor_id
    WHERE p.id = ANY(_fp_ids)
  ), c AS (
    SELECT j.*, (
      coalesce(j.fp_preco, 0)
      + coalesce(j.sup_emb, coalesce(_pricing.embalagem_default, 0))
      + coalesce(j.sup_transp, coalesce(_pricing.transporte_default, 0))
      + CASE WHEN coalesce(_pricing.taxa_operacional_valor, 0) > 0
              AND coalesce(j.fp_preco, 0) >= coalesce(_pricing.taxa_operacional_min_custo, 0)
             THEN _pricing.taxa_operacional_valor ELSE 0 END
    ) * (1 + coalesce(_pricing.frete_medio_percent, 0)/100) AS cmv_total
    FROM j
  )
  SELECT c.id, c.fp_preco,
    CASE WHEN _fee IS NULL OR _pricing.company_id IS NULL OR c.fp_preco IS NULL OR c.fp_preco <= 0 THEN NULL
      ELSE round(public._apply_price_anchor(
        public._compute_sale_price(
          c.cmv_total + c.cmv_total * coalesce(_pricing.custo_fixo_percent, 0)/100
                      + c.cmv_total * coalesce(_pricing.devolucao_percent, 0)/100,
          _fee, coalesce(c.sup_devol, 0), coalesce(c.sup_promo, 0), coalesce(_pricing.profit_bands, '[]'::jsonb)),
        coalesce(_pricing.price_anchors, '[]'::jsonb)), 2) END,
    CASE WHEN coalesce(c.sup_cap, _pricing.stock_cap_default) IS NOT NULL
      THEN least(greatest(coalesce(c.qt_estoque, 0), 0), coalesce(c.sup_cap, _pricing.stock_cap_default))
      ELSE greatest(coalesce(c.qt_estoque, 0), 0) END
  FROM c;
END $$;

CREATE TABLE IF NOT EXISTS public.supplier_catalog_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fornecedor_id uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  prefix text NOT NULL,
  status text NOT NULL DEFAULT 'executando' CHECK (status IN ('executando','concluido','cancelado','erro')),
  total integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  imported integer NOT NULL DEFAULT 0,
  pending integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  ignored integer NOT NULL DEFAULT 0,
  cancel_requested boolean NOT NULL DEFAULT false,
  waiting_reason text,
  last_error text,
  lease_token uuid,
  lease_until timestamptz,
  next_tick_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_catalog_import_jobs_active
  ON public.supplier_catalog_import_jobs (company_id, fornecedor_id) WHERE status = 'executando';
CREATE INDEX IF NOT EXISTS supplier_catalog_import_jobs_due
  ON public.supplier_catalog_import_jobs (next_tick_at) WHERE status = 'executando';

CREATE TABLE IF NOT EXISTS public.supplier_catalog_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.supplier_catalog_import_jobs(id) ON DELETE CASCADE,
  fornecedor_produto_id uuid NOT NULL,
  codigo text NOT NULL,
  titulo text,
  sku text NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','importado','pendencia','erro','ignorado')),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  product_id uuid,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, fornecedor_produto_id)
);
CREATE INDEX IF NOT EXISTS supplier_catalog_import_items_status ON public.supplier_catalog_import_items (job_id, status, codigo);

ALTER TABLE public.supplier_catalog_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_catalog_import_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_catalog_import_jobs, public.supplier_catalog_import_items FROM anon, authenticated;
GRANT ALL ON public.supplier_catalog_import_jobs, public.supplier_catalog_import_items TO service_role;

CREATE OR REPLACE FUNCTION public.recount_supplier_catalog_job(_job_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE public.supplier_catalog_import_jobs j SET
    processed = x.processed, imported = x.imported, pending = x.pending, failed = x.failed, ignored = x.ignored, updated_at = now()
  FROM (SELECT count(*) FILTER (WHERE status <> 'pendente') processed,
               count(*) FILTER (WHERE status = 'importado') imported,
               count(*) FILTER (WHERE status = 'pendencia') pending,
               count(*) FILTER (WHERE status = 'erro') failed,
               count(*) FILTER (WHERE status = 'ignorado') ignored
          FROM public.supplier_catalog_import_items WHERE job_id = _job_id) x
  WHERE j.id = _job_id;
$$;

-- Cria a tarefa com os elegíveis do momento (todos ou os primeiros _limit por código).
CREATE OR REPLACE FUNCTION public.start_supplier_catalog_import(_company_id uuid, _fornecedor_id uuid, _user_id uuid, _limit integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s' AS $$
DECLARE _job uuid; _supplier text; _prefix text; _n integer;
BEGIN
  SELECT codigo INTO _supplier FROM public.fornecedores WHERE id = _fornecedor_id AND codigo <> 'mercadolivre';
  IF _supplier IS NULL THEN RAISE EXCEPTION 'Fornecedor não encontrado.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bling_integrations WHERE company_id = _company_id AND status = 'conectada') THEN
    RAISE EXCEPTION 'Empresa sem integração Bling conectada.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_catalog_import_jobs WHERE company_id = _company_id AND fornecedor_id = _fornecedor_id AND status = 'executando') THEN
    RAISE EXCEPTION 'Já existe uma importação deste fornecedor em andamento nesta empresa.';
  END IF;
  _prefix := public.supplier_catalog_prefix(_company_id, _supplier);
  IF _prefix IS NULL THEN RAISE EXCEPTION 'Fornecedor sem prefixo no mapa de prefixos.'; END IF;
  INSERT INTO public.supplier_catalog_import_jobs (company_id, fornecedor_id, prefix, created_by)
  VALUES (_company_id, _fornecedor_id, _prefix, _user_id) RETURNING id INTO _job;
  INSERT INTO public.supplier_catalog_import_items (job_id, fornecedor_produto_id, codigo, titulo, sku)
  SELECT _job, c.fornecedor_produto_id, c.codigo, c.titulo, _prefix || c.codigo
    FROM public.supplier_catalog_candidates(_company_id, _fornecedor_id) c
   WHERE c.motivo IS NULL
   ORDER BY c.completo DESC, c.codigo
   LIMIT CASE WHEN _limit IS NULL OR _limit <= 0 THEN NULL ELSE _limit END;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN RAISE EXCEPTION 'Nenhum produto elegível para importar.'; END IF;
  UPDATE public.supplier_catalog_import_jobs SET total = _n WHERE id = _job;
  RETURN _job;
END $$;

-- Grava o resultado de um item. Aprovado: cria o produto local com preço e
-- estoque recalculados aqui e coloca o cadastro na fila do Bling, sem limpar a
-- fila de outros produtos. Exige o lease atual da tarefa.
CREATE OR REPLACE FUNCTION public.complete_supplier_catalog_item(
  _job_id uuid, _token uuid, _item_id uuid, _status text, _issues jsonb, _sources jsonb, _product jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _job record; _item record; _q record; _integ record; _new uuid; _status_final text := _status; _issues_final jsonb := coalesce(_issues, '[]'::jsonb);
  _ean text := btrim(coalesce(_product->>'gtin', ''));
BEGIN
  SELECT * INTO _job FROM public.supplier_catalog_import_jobs WHERE id = _job_id FOR UPDATE;
  IF _job.id IS NULL OR _job.status <> 'executando' OR _job.lease_token IS DISTINCT FROM _token THEN
    RAISE EXCEPTION 'Tarefa sem lease atual.';
  END IF;
  SELECT * INTO _item FROM public.supplier_catalog_import_items WHERE id = _item_id AND job_id = _job_id FOR UPDATE;
  IF _item.id IS NULL OR _item.status <> 'pendente' THEN RETURN coalesce(_item.status, 'ausente'); END IF;
  IF _status NOT IN ('importado','pendencia','erro') THEN RAISE EXCEPTION 'Status inválido.'; END IF;

  IF _status = 'importado' THEN
    IF EXISTS (SELECT 1 FROM public.bling_products p WHERE p.company_id = _job.company_id
                AND (upper(btrim(p.codigo)) = upper(_item.sku)
                  OR (_ean <> '' AND (btrim(p.gtin) = _ean OR btrim(p.gtin_embalagem) = _ean)))) THEN
      _status_final := 'ignorado';
      _issues_final := jsonb_build_array('Já existe na empresa (mesmo SKU ou EAN).');
    ELSE
      SELECT * INTO _q FROM public.supplier_catalog_quote(_job.company_id, ARRAY[_item.fornecedor_produto_id]);
      SELECT id, default_deposito_id INTO _integ FROM public.bling_integrations
       WHERE company_id = _job.company_id AND status = 'conectada' LIMIT 1;
      IF _q.preco IS NULL OR _q.preco <= 0 THEN
        _status_final := 'pendencia'; _issues_final := jsonb_build_array('Preço não calculável pela política da empresa.');
      ELSIF _integ.id IS NULL THEN
        _status_final := 'erro'; _issues_final := jsonb_build_array('Empresa sem integração Bling conectada.');
      ELSE
        INSERT INTO public.bling_products (
          company_id, codigo, nome, preco, preco_custo, preco_compra, estoque,
          garantia, cross_docking, situacao, unidade, marca, ncm,
          peso_bruto, peso_liquido, largura, altura, profundidade,
          gtin, gtin_embalagem, imagem_principal_url, url_imagens_externas,
          descricao_curta, descricao_complementar, origem_fiscal,
          fornecedor, fornecedor_id, cod_fornecedor,
          source, dirty, detail_synced, unidade_medida, condicao_produto, tipo_producao
        ) VALUES (
          _job.company_id, _item.sku, left(_product->>'nome', 250), _q.preco, _q.custo, _q.custo, _q.estoque,
          '3 meses', '3', 'Ativo', 'UN', _product->>'marca', _product->>'ncm',
          (_product->>'peso')::numeric, (_product->>'peso')::numeric, (_product->>'largura')::numeric,
          (_product->>'altura')::numeric, (_product->>'profundidade')::numeric,
          nullif(_ean, ''), nullif(_ean, ''), _product->>'imagem_principal_url', _product->>'url_imagens_externas',
          _product->>'descricao_curta', left(_product->>'nome', 250), coalesce(nullif(_product->>'origem_fiscal', ''), '0'),
          (SELECT nome FROM public.fornecedores WHERE id = _job.fornecedor_id), _job.fornecedor_id::text, _item.codigo,
          'catalogo_fornecedor', true, false, 'Centímetros', 'Novo', 'Terceiros'
        ) RETURNING id INTO _new;
        INSERT INTO public.bling_push_queue (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
          tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
        VALUES (_job.company_id, _integ.id, _new, NULL, _integ.default_deposito_id, 'criar', NULL, _q.preco, 'pendente', now())
        ON CONFLICT (integration_id, product_id, tipo) WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO NOTHING;
      END IF;
    END IF;
  END IF;

  UPDATE public.supplier_catalog_import_items SET
    status = _status_final, issues = _issues_final, sources = coalesce(_sources, '{}'::jsonb),
    product_id = _new, attempts = attempts + 1, updated_at = now()
  WHERE id = _item_id;
  PERFORM public.recount_supplier_catalog_job(_job_id);
  RETURN _status_final;
END $$;

REVOKE EXECUTE ON FUNCTION public.supplier_catalog_prefix(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.supplier_catalog_candidates(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.supplier_catalog_summary(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.supplier_catalog_quote(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recount_supplier_catalog_job(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.start_supplier_catalog_import(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_supplier_catalog_item(uuid, uuid, uuid, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_catalog_prefix(uuid, text), public.supplier_catalog_candidates(uuid, uuid),
  public.supplier_catalog_summary(uuid), public.supplier_catalog_quote(uuid, uuid[]), public.recount_supplier_catalog_job(uuid),
  public.start_supplier_catalog_import(uuid, uuid, uuid, integer),
  public.complete_supplier_catalog_item(uuid, uuid, uuid, text, jsonb, jsonb, jsonb) TO service_role;

-- Estoque logo após a criação também para os produtos novos do fornecedor.
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
  IF _source IN ('garimpo_ml', 'catalogo_fornecedor') THEN
    BEGIN
      PERFORM public.enqueue_ml_prospect_stock(_company, ARRAY[_pid]);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'estoque do garimpo não enfileirado para %: %', _pid, SQLERRM;
    END;
  END IF;
END; $function$

;
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
 WHERE p.company_id=_company_id AND p.id=ANY(_product_ids) AND p.source IN ('garimpo_ml','catalogo_fornecedor')
 AND p.bling_product_id IS NOT NULL AND p.situacao IN ('A','Ativo','ativo','ATIVO')
 AND (EXISTS(SELECT 1 FROM public.bling_product_deposit_stock s WHERE s.product_id=p.id AND s.pendente)
 OR (NOT EXISTS(SELECT 1 FROM public.bling_stock_deposits d WHERE d.company_id=_company_id AND d.ativo)
 AND integ.default_deposito_id IS NOT NULL AND p.ultimo_estoque_sincronizado IS DISTINCT FROM p.estoque))
 ON CONFLICT (integration_id,product_id,tipo) WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
 DO UPDATE SET valor_novo=excluded.valor_novo,updated_at=now();
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END;
$function$

;
-- A limpeza da fila vale só para os produtos pedidos (antes apagava cadastros pendentes de outros produtos).
CREATE OR REPLACE FUNCTION public.enqueue_bling_push(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[], _scope text DEFAULT 'ambos'::text, _include_stores boolean DEFAULT false, _only_changed boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  _integration_id uuid;
  _default_dep text;
  _created_preco int := 0;
  _created_estoque int := 0;
  _created_produto int := 0;
  _created_criar int := 0;
  _created_lojas int := 0;
  _updated_existing int := 0;
  _skipped_sem_bling int := 0;
  _skipped_sem_dep int := 0;
  _skipped_sem_mudanca int := 0;
  _tipos text[];
  _enq_at timestamptz := now();
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT id, default_deposito_id INTO _integration_id, _default_dep
  FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada'
  LIMIT 1;

  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada para esta empresa.';
  END IF;

  -- Limpa APENAS os tipos que esta chamada vai reenfileirar; nunca mexe em
  -- itens de outras transformações (ex.: codigo_loja, inativar, excluir).
  _tipos := CASE
    WHEN _scope = 'criar' THEN ARRAY['criar']
    WHEN _scope = 'todos' THEN ARRAY['criar','produto']
    WHEN _scope = 'preco' THEN ARRAY['preco']
    WHEN _scope = 'estoque' THEN ARRAY['estoque']
    ELSE ARRAY['preco','estoque']
  END;
  IF _include_stores AND _scope IN ('preco','ambos','todos') THEN
    _tipos := _tipos || ARRAY['preco_loja'];
  END IF;

  DELETE FROM public.bling_push_queue
  WHERE company_id = _company_id AND tipo = ANY(_tipos)
    AND (_product_ids IS NULL OR product_id = ANY(_product_ids));

  -- Se já existir outra transformação na fila, esta entra no FINAL dela.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.bling_push_queue
    WHERE company_id = _company_id
      AND status IN ('pendente','processando')
      AND NOT (tipo = ANY(_tipos))
  ) THEN now() + interval '1 second' ELSE now() END
  INTO _enq_at;

  CREATE TEMP TABLE _pending ON COMMIT DROP AS
  SELECT p.id AS product_id,
         p.bling_product_id,
         COALESCE(p.bling_deposit_id, _default_dep) AS bling_deposit_id,
         p.preco,
         p.estoque,
         p.ultimo_preco_sincronizado,
         p.ultimo_estoque_sincronizado
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids));

  IF _scope = 'criar' THEN
    WITH ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, NULL, p.bling_deposit_id,
             'criar', NULL, COALESCE(p.preco, 0), 'pendente', _enq_at
      FROM _pending p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          valor_novo = EXCLUDED.valor_novo,
          proxima_tentativa_em = now(),
          tentativas = 0, erro = NULL, status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
      INTO _created_criar, _updated_existing FROM ins;

    RETURN jsonb_build_object(
      'integration_id', _integration_id,
      'created_preco', 0, 'created_estoque', 0, 'created_produto', 0,
      'created_criar', _created_criar, 'created_lojas', 0,
      'updated_existing', _updated_existing,
      'skipped_sem_bling_id', 0, 'skipped_sem_deposito', 0,
      'skipped_sem_mudanca', 0
    );
  END IF;

  CREATE TEMP TABLE _pending_no_id ON COMMIT DROP AS
  SELECT * FROM _pending WHERE bling_product_id IS NULL OR btrim(bling_product_id) = '';

  DELETE FROM _pending WHERE bling_product_id IS NULL OR btrim(bling_product_id) = '';

  IF _scope = 'todos' THEN
    WITH ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, NULL, p.bling_deposit_id,
             'criar', NULL, COALESCE(p.preco, 0), 'pendente', _enq_at
      FROM _pending_no_id p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          valor_novo = EXCLUDED.valor_novo,
          proxima_tentativa_em = now(),
          tentativas = 0, erro = NULL, status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
      INTO _created_criar, _updated_existing FROM ins;

    WITH ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, p.bling_deposit_id,
             'produto', p.ultimo_preco_sincronizado, COALESCE(p.preco, 0), 'pendente', _enq_at
      FROM _pending p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          valor_novo = EXCLUDED.valor_novo,
          valor_anterior = EXCLUDED.valor_anterior,
          proxima_tentativa_em = now(),
          tentativas = 0, erro = NULL, status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), _updated_existing + count(*) FILTER (WHERE NOT inserted)
      INTO _created_produto, _updated_existing FROM ins;
  ELSE
    SELECT count(*) INTO _skipped_sem_bling FROM _pending_no_id;
  END IF;

  IF _scope = 'preco' OR _scope = 'ambos' THEN
    WITH src AS (
      SELECT * FROM _pending p
      WHERE NOT _only_changed
         OR p.ultimo_preco_sincronizado IS DISTINCT FROM COALESCE(p.preco, 0)
    ), ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, p.bling_deposit_id,
             'preco', p.ultimo_preco_sincronizado, COALESCE(p.preco, 0), 'pendente', _enq_at
      FROM src p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          bling_product_id = EXCLUDED.bling_product_id,
          valor_anterior = EXCLUDED.valor_anterior,
          valor_novo = EXCLUDED.valor_novo,
          proxima_tentativa_em = now(),
          tentativas = 0,
          erro = NULL,
          status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), _updated_existing + count(*) FILTER (WHERE NOT inserted)
      INTO _created_preco, _updated_existing FROM ins;

    IF _only_changed THEN
      SELECT _skipped_sem_mudanca + count(*) INTO _skipped_sem_mudanca
      FROM _pending p
      WHERE p.ultimo_preco_sincronizado IS NOT DISTINCT FROM COALESCE(p.preco, 0);
    END IF;
  END IF;

  IF _scope = 'estoque' OR _scope = 'ambos' THEN
    -- Depósitos configurados: calcula o valor de cada depósito e marca o que mudou.
    PERFORM public.prepare_deposit_stock_targets(
      _company_id,
      ARRAY(SELECT product_id FROM _pending WHERE bling_deposit_id IS NOT NULL AND btrim(bling_deposit_id) <> ''),
      _only_changed);
    WITH src AS (
      SELECT * FROM _pending p
      WHERE p.bling_deposit_id IS NOT NULL AND btrim(p.bling_deposit_id) <> ''
        AND (NOT _only_changed
             OR p.ultimo_estoque_sincronizado IS DISTINCT FROM COALESCE(p.estoque, 0)
             OR EXISTS (SELECT 1 FROM public.bling_product_deposit_stock d
                        WHERE d.product_id = p.product_id AND d.pendente))
    ), ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, p.bling_deposit_id,
             'estoque', p.ultimo_estoque_sincronizado, COALESCE(p.estoque, 0), 'pendente', _enq_at
      FROM src p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          bling_product_id = EXCLUDED.bling_product_id,
          bling_deposit_id = EXCLUDED.bling_deposit_id,
          valor_anterior = EXCLUDED.valor_anterior,
          valor_novo = EXCLUDED.valor_novo,
          proxima_tentativa_em = now(),
          tentativas = 0,
          erro = NULL,
          status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), _updated_existing + count(*) FILTER (WHERE NOT inserted)
      INTO _created_estoque, _updated_existing FROM ins;

    SELECT count(*) INTO _skipped_sem_dep
    FROM _pending
    WHERE bling_deposit_id IS NULL OR btrim(bling_deposit_id) = '';

    IF _only_changed THEN
      SELECT _skipped_sem_mudanca + count(*) INTO _skipped_sem_mudanca
      FROM _pending p
      WHERE p.bling_deposit_id IS NOT NULL AND btrim(p.bling_deposit_id) <> ''
        AND p.ultimo_estoque_sincronizado IS NOT DISTINCT FROM COALESCE(p.estoque, 0)
        AND NOT EXISTS (SELECT 1 FROM public.bling_product_deposit_stock d
                        WHERE d.product_id = p.product_id AND d.pendente);
    END IF;
  END IF;

  IF _include_stores AND (_scope = 'preco' OR _scope = 'ambos' OR _scope = 'todos') THEN
    WITH stores AS (
      SELECT ps.internal_product_id AS product_id,
             ps.bling_product_store_id,
             ps.current_price,
             ps.ultimo_preco_sincronizado,
             ps.bling_store_id,
             ps.store_product_code,
             ps.current_promotional_price,
             sup.taxa_promocao AS sup_taxa_promocao,
             p.preco,
             p.codigo,
             p.bling_product_id
      FROM public.bling_product_stores ps
      JOIN public.bling_products p ON p.id = ps.internal_product_id
      LEFT JOIN public.fornecedores sup ON sup.codigo = (public.map_supplier_prefix(upper(substring(p.codigo from '^[A-Za-z]+'))))
      WHERE p.company_id = _company_id
        AND ps.company_id = _company_id
        AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
        AND ps.is_linked = true
        AND ps.bling_product_store_id IS NOT NULL
        AND btrim(ps.bling_product_store_id) <> ''
        AND p.bling_product_id IS NOT NULL
        AND btrim(p.bling_product_id) <> ''
    ), src AS (
      SELECT * FROM stores s
      WHERE NOT _only_changed
         OR s.ultimo_preco_sincronizado IS DISTINCT FROM COALESCE(s.current_price, s.preco, 0)
    ), ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_product_store_id,
         tipo, valor_anterior, valor_novo, payload, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, s.product_id, s.bling_product_id, s.bling_product_store_id,
             'preco_loja', s.ultimo_preco_sincronizado, COALESCE(s.current_price, s.preco, 0),
             jsonb_build_object(
               'bling_store_id', s.bling_store_id,
               'codigo', COALESCE(NULLIF(btrim(s.store_product_code), ''), s.codigo),
               'preco_promocional', COALESCE(
                 s.current_promotional_price,
                 round((COALESCE(s.current_price, s.preco, 0) * (1 - COALESCE(s.sup_taxa_promocao, 0)/100))::numeric, 2)
               )
             ),
             'pendente', _enq_at
      FROM src s
      ON CONFLICT (integration_id, product_id, tipo, bling_product_store_id)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NOT NULL
        DO UPDATE SET
          bling_product_id = EXCLUDED.bling_product_id,
          valor_anterior = EXCLUDED.valor_anterior,
          valor_novo = EXCLUDED.valor_novo,
          payload = EXCLUDED.payload,
          proxima_tentativa_em = now(),
          tentativas = 0,
          erro = NULL,
          status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted) INTO _created_lojas FROM ins;
  END IF;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'created_preco', _created_preco,
    'created_estoque', _created_estoque,
    'created_produto', _created_produto,
    'created_criar', _created_criar,
    'created_lojas', _created_lojas,
    'updated_existing', _updated_existing,
    'skipped_sem_bling_id', _skipped_sem_bling,
    'skipped_sem_deposito', _skipped_sem_dep,
    'skipped_sem_mudanca', _skipped_sem_mudanca
  );
END; $function$

;

-- Cron de 10 s: chama o worker só quando há tarefa vencida sem lease (segredo lido do app-tick).
DO $cron$
DECLARE _secret text;
BEGIN
  SELECT substring(command from 'x-worker-secret'',\s*''([^'']+)''') INTO _secret FROM cron.job WHERE jobname = 'app-tick';
  IF _secret IS NULL THEN RAISE NOTICE 'app-tick sem segredo; cron não criado'; RETURN; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'supplier-catalog-tick';
  PERFORM cron.schedule('supplier-catalog-tick', '10 seconds', format($cmd$DO $tick$ BEGIN IF EXISTS (SELECT 1 FROM public.supplier_catalog_import_jobs WHERE status='executando' AND next_tick_at<=now() AND (lease_until IS NULL OR lease_until<now())) THEN
  PERFORM net.http_post(
    url := 'https://cloud-free-auditor.lovable.app/api/public/suppliers/catalog-import-tick',
    headers := jsonb_build_object('Content-Type','application/json','x-worker-secret', %L),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000) ; END IF; END $tick$;$cmd$, _secret));
END $cron$;
