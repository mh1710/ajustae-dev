-- Vínculos produto ↔ fornecedor lidos do Bling, mapa fornecedor Bling → fornecedor do sistema
-- e jobs de sincronização (mesmo padrão das multilojas).

CREATE TABLE IF NOT EXISTS public.bling_product_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.bling_products(id) ON DELETE CASCADE,
  bling_product_id text NOT NULL,
  bling_link_id text NOT NULL,
  bling_supplier_id text NOT NULL,
  codigo text,
  preco_custo numeric(14,4),
  padrao boolean NOT NULL DEFAULT false,
  synced_job_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, bling_link_id)
);
CREATE INDEX IF NOT EXISTS bps_company_product_idx ON public.bling_product_suppliers (company_id, product_id);
CREATE INDEX IF NOT EXISTS bps_company_supplier_idx ON public.bling_product_suppliers (company_id, bling_supplier_id);
GRANT SELECT ON public.bling_product_suppliers TO authenticated;
GRANT ALL ON public.bling_product_suppliers TO service_role;
ALTER TABLE public.bling_product_suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read product suppliers" ON public.bling_product_suppliers;
CREATE POLICY "Members read product suppliers" ON public.bling_product_suppliers
  FOR SELECT TO authenticated USING (app_private.is_company_member(company_id, auth.uid()));

CREATE TABLE IF NOT EXISTS public.bling_supplier_map (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bling_supplier_id text NOT NULL,
  nome text,
  supplier_codigo text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, bling_supplier_id)
);
GRANT SELECT ON public.bling_supplier_map TO authenticated;
GRANT ALL ON public.bling_supplier_map TO service_role;
ALTER TABLE public.bling_supplier_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read supplier map" ON public.bling_supplier_map;
CREATE POLICY "Members read supplier map" ON public.bling_supplier_map
  FOR SELECT TO authenticated USING (app_private.is_company_member(company_id, auth.uid()));

CREATE TABLE IF NOT EXISTS public.bling_supplier_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'executando'
    CHECK (status IN ('executando','pausado','cancelado','concluido','erro')),
  next_page int NOT NULL DEFAULT 1,
  pages_done int NOT NULL DEFAULT 0,
  links_found int NOT NULL DEFAULT 0,
  last_error text,
  lease_until timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bssj_company_idx ON public.bling_supplier_sync_jobs (company_id, created_at DESC);
GRANT SELECT ON public.bling_supplier_sync_jobs TO authenticated;
GRANT ALL ON public.bling_supplier_sync_jobs TO service_role;
ALTER TABLE public.bling_supplier_sync_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read supplier sync jobs" ON public.bling_supplier_sync_jobs;
CREATE POLICY "Members read supplier sync jobs" ON public.bling_supplier_sync_jobs
  FOR SELECT TO authenticated USING (app_private.is_company_member(company_id, auth.uid()));

-- Novo tipo na fila de envio.
ALTER TABLE public.bling_push_queue DROP CONSTRAINT IF EXISTS bling_push_queue_tipo_check;
ALTER TABLE public.bling_push_queue ADD CONSTRAINT bling_push_queue_tipo_check CHECK (tipo = ANY (ARRAY[
  'preco','estoque','produto','criar','excluir','inativar','preco_loja','estoque_loja',
  'vincular_loja','desvincular_loja','codigo_loja','codigo_loja_planilha','fornecedor_vinculo']));

-- Resumo dos fornecedores encontrados no Bling.
CREATE OR REPLACE FUNCTION public.list_bling_suppliers_summary(_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _r jsonb;
BEGIN
  IF NOT app_private.is_company_member(_company_id, auth.uid()) THEN RAISE EXCEPTION 'not a member of company'; END IF;
  SELECT jsonb_build_object(
    'suppliers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('bling_supplier_id', m.bling_supplier_id, 'nome', m.nome,
               'supplier_codigo', m.supplier_codigo,
               'products', (SELECT count(DISTINCT s.bling_product_id) FROM public.bling_product_suppliers s
                            WHERE s.company_id = _company_id AND s.bling_supplier_id = m.bling_supplier_id))
             ORDER BY m.nome NULLS LAST)
      FROM public.bling_supplier_map m WHERE m.company_id = _company_id), '[]'::jsonb),
    'total_products', (SELECT count(*) FROM public.bling_products WHERE company_id = _company_id),
    'with_supplier', (SELECT count(*) FROM public.bling_products p WHERE p.company_id = _company_id
                        AND EXISTS (SELECT 1 FROM public.bling_product_suppliers s WHERE s.company_id = _company_id AND s.product_id = p.id)),
    'job', (SELECT to_jsonb(j) FROM public.bling_supplier_sync_jobs j WHERE j.company_id = _company_id ORDER BY created_at DESC LIMIT 1)
  ) INTO _r;
  RETURN _r;
END $$;
GRANT EXECUTE ON FUNCTION public.list_bling_suppliers_summary(uuid) TO authenticated;

-- Lista paginada de produtos com seus fornecedores.
CREATE OR REPLACE FUNCTION public.list_products_with_suppliers(
  _company_id uuid, _filter text DEFAULT 'all', _bling_supplier_id text DEFAULT NULL,
  _search text DEFAULT NULL, _limit int DEFAULT 50, _offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _r jsonb;
BEGIN
  IF NOT app_private.is_company_member(_company_id, auth.uid()) THEN RAISE EXCEPTION 'not a member of company'; END IF;
  WITH base AS (
    SELECT p.id, p.codigo, p.nome, p.situacao
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_search IS NULL OR _search = '' OR p.codigo ILIKE '%'||_search||'%' OR p.nome ILIKE '%'||_search||'%')
      AND (_filter <> 'without' OR NOT EXISTS (SELECT 1 FROM public.bling_product_suppliers s WHERE s.company_id = _company_id AND s.product_id = p.id))
      AND (_filter <> 'with' OR EXISTS (SELECT 1 FROM public.bling_product_suppliers s WHERE s.company_id = _company_id AND s.product_id = p.id))
      AND (_bling_supplier_id IS NULL OR EXISTS (SELECT 1 FROM public.bling_product_suppliers s WHERE s.company_id = _company_id AND s.product_id = p.id AND s.bling_supplier_id = _bling_supplier_id))
  ), page AS (
    SELECT * FROM base ORDER BY codigo NULLS LAST LIMIT _limit OFFSET _offset
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', pg.id, 'codigo', pg.codigo, 'nome', pg.nome, 'situacao', pg.situacao,
        'expected_supplier', public.map_sku_prefix(pg.codigo),
        'suppliers', COALESCE((SELECT jsonb_agg(jsonb_build_object('bling_supplier_id', s.bling_supplier_id,
              'nome', m.nome, 'codigo', s.codigo, 'preco_custo', s.preco_custo, 'padrao', s.padrao))
            FROM public.bling_product_suppliers s
            LEFT JOIN public.bling_supplier_map m ON m.company_id = s.company_id AND m.bling_supplier_id = s.bling_supplier_id
            WHERE s.company_id = _company_id AND s.product_id = pg.id), '[]'::jsonb)
      ) ORDER BY pg.codigo NULLS LAST) FROM page pg), '[]'::jsonb)
  ) INTO _r;
  RETURN _r;
END $$;
GRANT EXECUTE ON FUNCTION public.list_products_with_suppliers(uuid, text, text, text, int, int) TO authenticated;

-- Liga um fornecedor do Bling a um fornecedor do sistema.
CREATE OR REPLACE FUNCTION public.set_bling_supplier_map(_company_id uuid, _bling_supplier_id text, _supplier_codigo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT app_private.is_company_member(_company_id, auth.uid()) THEN RAISE EXCEPTION 'not a member of company'; END IF;
  UPDATE public.bling_supplier_map SET supplier_codigo = NULLIF(btrim(_supplier_codigo), ''), updated_at = now()
  WHERE company_id = _company_id AND bling_supplier_id = _bling_supplier_id;
END $$;
GRANT EXECUTE ON FUNCTION public.set_bling_supplier_map(uuid, text, text) TO authenticated;

-- Enfileira vínculos de fornecedor. _mode 'prefix' usa o mapa de prefixos + mapa do Bling;
-- _mode 'manual' usa _bling_supplier_id. Só produtos sem nenhum fornecedor e com id no Bling.
CREATE OR REPLACE FUNCTION public.enqueue_supplier_links(
  _company_id uuid, _mode text, _product_ids uuid[] DEFAULT NULL, _bling_supplier_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
                    ORDER BY m.bling_supplier_id LIMIT 1) END AS forn
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
    AND NOT EXISTS (SELECT 1 FROM public.bling_product_suppliers s WHERE s.company_id = _company_id AND s.product_id = p.id);

  SELECT count(*) FILTER (WHERE forn IS NULL OR bling_product_id IS NULL OR bling_product_id = '') INTO _skipped FROM _cand;

  INSERT INTO public.bling_push_queue (company_id, integration_id, product_id, bling_product_id, tipo, valor_novo, payload)
  SELECT _company_id, _integ, c.id, c.bling_product_id, 'fornecedor_vinculo', 0,
         jsonb_build_object('bling_supplier_id', c.forn, 'codigo', COALESCE(c.cod_forn, ''), 'preco_custo', c.preco_custo)
  FROM _cand c
  WHERE c.forn IS NOT NULL AND COALESCE(c.bling_product_id, '') <> ''
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('enqueued', _n, 'skipped', _skipped);
END $$;
GRANT EXECUTE ON FUNCTION public.enqueue_supplier_links(uuid, text, uuid[], text) TO authenticated;

-- Fase 2: a listagem do Bling só traz produtos ativos; os demais são conferidos pela ficha.
ALTER TABLE public.bling_supplier_sync_jobs
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'lista',
  ADD COLUMN IF NOT EXISTS detail_cursor uuid,
  ADD COLUMN IF NOT EXISTS details_checked int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS details_total int NOT NULL DEFAULT 0;
