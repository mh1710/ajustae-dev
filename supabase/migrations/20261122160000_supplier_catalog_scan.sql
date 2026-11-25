-- Scanner de "Novos do fornecedor": roda a mesma preparação da importação
-- (fornecedor → outros fornecedores/Bling pelo EAN → catálogo do Mercado Livre
-- pelo EAN → regras da auditoria) sem cadastrar nada, e guarda por produto se
-- ficou pronto ou o que falta. A importação pode levar só os prontos.

ALTER TABLE public.supplier_catalog_import_jobs
  ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'importar',
  ADD COLUMN IF NOT EXISTS only_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ready integer NOT NULL DEFAULT 0;
ALTER TABLE public.supplier_catalog_import_jobs DROP CONSTRAINT IF EXISTS supplier_catalog_import_jobs_modo_check;
ALTER TABLE public.supplier_catalog_import_jobs ADD CONSTRAINT supplier_catalog_import_jobs_modo_check CHECK (modo IN ('importar', 'escanear'));

ALTER TABLE public.supplier_catalog_import_items DROP CONSTRAINT IF EXISTS supplier_catalog_import_items_status_check;
ALTER TABLE public.supplier_catalog_import_items ADD CONSTRAINT supplier_catalog_import_items_status_check
  CHECK (status IN ('pendente', 'importado', 'pendencia', 'erro', 'ignorado', 'pronto'));

CREATE TABLE IF NOT EXISTS public.supplier_catalog_scan (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fornecedor_produto_id uuid NOT NULL,
  fornecedor_id uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pronto', 'pendencia', 'erro')),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  job_id uuid,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, fornecedor_produto_id)
);
CREATE INDEX IF NOT EXISTS supplier_catalog_scan_supplier ON public.supplier_catalog_scan (company_id, fornecedor_id, status);
ALTER TABLE public.supplier_catalog_scan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_catalog_scan FROM anon, authenticated;
GRANT ALL ON public.supplier_catalog_scan TO service_role;

CREATE OR REPLACE FUNCTION public.recount_supplier_catalog_job(_job_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE public.supplier_catalog_import_jobs j SET
    processed = x.processed, imported = x.imported, pending = x.pending, failed = x.failed, ignored = x.ignored, ready = x.ready, updated_at = now()
  FROM (SELECT count(*) FILTER (WHERE status <> 'pendente') processed,
               count(*) FILTER (WHERE status = 'importado') imported,
               count(*) FILTER (WHERE status = 'pendencia') pending,
               count(*) FILTER (WHERE status = 'erro') failed,
               count(*) FILTER (WHERE status = 'ignorado') ignored,
               count(*) FILTER (WHERE status = 'pronto') ready
          FROM public.supplier_catalog_import_items WHERE job_id = _job_id) x
  WHERE j.id = _job_id;
$$;

DROP FUNCTION IF EXISTS public.start_supplier_catalog_import(uuid, uuid, uuid, integer);
-- Cria a tarefa (importar ou escanear) com os elegíveis do momento. Importar pode
-- se limitar aos prontos no scanner; os prontos vêm primeiro de qualquer forma.
CREATE OR REPLACE FUNCTION public.start_supplier_catalog_import(
  _company_id uuid, _fornecedor_id uuid, _user_id uuid, _limit integer DEFAULT NULL,
  _modo text DEFAULT 'importar', _only_ready boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s' AS $$
DECLARE _job uuid; _supplier text; _prefix text; _n integer;
BEGIN
  IF _modo NOT IN ('importar', 'escanear') THEN RAISE EXCEPTION 'Modo inválido.'; END IF;
  SELECT codigo INTO _supplier FROM public.fornecedores WHERE id = _fornecedor_id AND codigo <> 'mercadolivre';
  IF _supplier IS NULL THEN RAISE EXCEPTION 'Fornecedor não encontrado.'; END IF;
  IF _modo = 'importar' AND NOT EXISTS (SELECT 1 FROM public.bling_integrations WHERE company_id = _company_id AND status = 'conectada') THEN
    RAISE EXCEPTION 'Empresa sem integração Bling conectada.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_catalog_import_jobs WHERE company_id = _company_id AND fornecedor_id = _fornecedor_id AND status = 'executando') THEN
    RAISE EXCEPTION 'Já existe um scanner ou importação deste fornecedor em andamento nesta empresa.';
  END IF;
  _prefix := public.supplier_catalog_prefix(_company_id, _supplier);
  IF _prefix IS NULL THEN RAISE EXCEPTION 'Fornecedor sem prefixo no mapa de prefixos.'; END IF;
  INSERT INTO public.supplier_catalog_import_jobs (company_id, fornecedor_id, prefix, created_by, modo, only_ready)
  VALUES (_company_id, _fornecedor_id, _prefix, _user_id, _modo, _modo = 'importar' AND _only_ready) RETURNING id INTO _job;
  INSERT INTO public.supplier_catalog_import_items (job_id, fornecedor_produto_id, codigo, titulo, sku)
  SELECT _job, c.fornecedor_produto_id, c.codigo, c.titulo, _prefix || c.codigo
    FROM public.supplier_catalog_candidates(_company_id, _fornecedor_id) c
    LEFT JOIN public.supplier_catalog_scan s ON s.company_id = _company_id AND s.fornecedor_produto_id = c.fornecedor_produto_id
   WHERE c.motivo IS NULL
     AND (_modo <> 'importar' OR NOT _only_ready OR s.status = 'pronto')
   ORDER BY (s.status = 'pronto') DESC NULLS LAST, c.completo DESC, c.codigo
   LIMIT CASE WHEN _limit IS NULL OR _limit <= 0 THEN NULL ELSE _limit END;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN
    IF _only_ready THEN RAISE EXCEPTION 'Nenhum produto pronto no scanner. Rode o scanner primeiro.'; END IF;
    RAISE EXCEPTION 'Nenhum produto elegível.';
  END IF;
  UPDATE public.supplier_catalog_import_jobs SET total = _n WHERE id = _job;
  RETURN _job;
END $$;

-- Resultado de um item do scanner: guarda no item e no resultado por produto. Exige o lease atual.
CREATE OR REPLACE FUNCTION public.complete_supplier_catalog_scan_item(
  _job_id uuid, _token uuid, _item_id uuid, _status text, _issues jsonb, _sources jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _job record; _item record;
BEGIN
  SELECT * INTO _job FROM public.supplier_catalog_import_jobs WHERE id = _job_id FOR UPDATE;
  IF _job.id IS NULL OR _job.status <> 'executando' OR _job.modo <> 'escanear' OR _job.lease_token IS DISTINCT FROM _token THEN
    RAISE EXCEPTION 'Tarefa sem lease atual.';
  END IF;
  IF _status NOT IN ('pronto', 'pendencia', 'erro') THEN RAISE EXCEPTION 'Status inválido.'; END IF;
  SELECT * INTO _item FROM public.supplier_catalog_import_items WHERE id = _item_id AND job_id = _job_id FOR UPDATE;
  IF _item.id IS NULL OR _item.status <> 'pendente' THEN RETURN coalesce(_item.status, 'ausente'); END IF;
  UPDATE public.supplier_catalog_import_items
     SET status = _status, issues = coalesce(_issues, '[]'::jsonb), sources = coalesce(_sources, '{}'::jsonb), attempts = attempts + 1, updated_at = now()
   WHERE id = _item_id;
  INSERT INTO public.supplier_catalog_scan (company_id, fornecedor_produto_id, fornecedor_id, status, issues, sources, job_id, scanned_at)
  VALUES (_job.company_id, _item.fornecedor_produto_id, _job.fornecedor_id, _status, coalesce(_issues, '[]'::jsonb), coalesce(_sources, '{}'::jsonb), _job_id, now())
  ON CONFLICT (company_id, fornecedor_produto_id) DO UPDATE
    SET status = EXCLUDED.status, issues = EXCLUDED.issues, sources = EXCLUDED.sources, job_id = EXCLUDED.job_id,
        fornecedor_id = EXCLUDED.fornecedor_id, scanned_at = EXCLUDED.scanned_at;
  PERFORM public.recount_supplier_catalog_job(_job_id);
  RETURN _status;
END $$;

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
      'escaneados', count(sc.status) FILTER (WHERE c.motivo IS NULL),
      'prontos_scanner', count(*) FILTER (WHERE c.motivo IS NULL AND sc.status = 'pronto'),
      'ultimo_scanner', max(sc.scanned_at) FILTER (WHERE c.motivo IS NULL),
      'fora_custo', count(*) FILTER (WHERE c.motivo = 'custo'),
      'fora_peso', count(*) FILTER (WHERE c.motivo = 'peso'),
      'fora_comprimento', count(*) FILTER (WHERE c.motivo = 'comprimento'))
    INTO r FROM public.supplier_catalog_candidates(_company_id, s.id) c
    LEFT JOIN public.supplier_catalog_scan sc ON sc.company_id = _company_id AND sc.fornecedor_produto_id = c.fornecedor_produto_id;
    _out := _out || jsonb_build_array(r);
  END LOOP;
  RETURN _out;
END $$;

REVOKE EXECUTE ON FUNCTION public.start_supplier_catalog_import(uuid, uuid, uuid, integer, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_supplier_catalog_scan_item(uuid, uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_supplier_catalog_import(uuid, uuid, uuid, integer, text, boolean),
  public.complete_supplier_catalog_scan_item(uuid, uuid, uuid, text, jsonb, jsonb) TO service_role;

-- O scanner nunca cadastra: o cadastro exige tarefa no modo importar.
CREATE OR REPLACE FUNCTION public.complete_supplier_catalog_item(_job_id uuid, _token uuid, _item_id uuid, _status text, _issues jsonb, _sources jsonb, _product jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _job record; _item record; _q record; _integ record; _new uuid; _status_final text := _status; _issues_final jsonb := coalesce(_issues, '[]'::jsonb);
  _ean text := btrim(coalesce(_product->>'gtin', ''));
BEGIN
  SELECT * INTO _job FROM public.supplier_catalog_import_jobs WHERE id = _job_id FOR UPDATE;
  IF _job.id IS NULL OR _job.status <> 'executando' OR _job.modo <> 'importar' OR _job.lease_token IS DISTINCT FROM _token THEN
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
END $function$;
