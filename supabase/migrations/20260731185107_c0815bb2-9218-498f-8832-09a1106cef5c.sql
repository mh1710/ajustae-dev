-- ============ PEDIDOS ============
CREATE TABLE public.bling_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.bling_integrations(id) ON DELETE SET NULL,
  bling_order_id text NOT NULL,
  numero text,
  numero_loja text,
  data date,
  data_saida date,
  situacao_id text,
  situacao_nome text,
  loja_id text,
  loja_nome text,
  contato_nome text,
  contato_documento text,
  total numeric NOT NULL DEFAULT 0,
  total_produtos numeric NOT NULL DEFAULT 0,
  desconto numeric NOT NULL DEFAULT 0,
  frete numeric NOT NULL DEFAULT 0,
  outras_despesas numeric NOT NULL DEFAULT 0,
  custo_total numeric NOT NULL DEFAULT 0,
  taxa_percent numeric,
  items_count integer NOT NULL DEFAULT 0,
  items_synced boolean NOT NULL DEFAULT false,
  bling_updated_at timestamptz,
  raw_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, bling_order_id)
);
CREATE INDEX idx_bling_orders_company_data ON public.bling_orders (company_id, data DESC);
CREATE INDEX idx_bling_orders_company_loja ON public.bling_orders (company_id, loja_id);
CREATE INDEX idx_bling_orders_situacao ON public.bling_orders (company_id, situacao_id);

GRANT SELECT ON public.bling_orders TO authenticated;
GRANT ALL ON public.bling_orders TO service_role;
ALTER TABLE public.bling_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read bling_orders" ON public.bling_orders
  FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

CREATE TABLE public.bling_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.bling_orders(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.bling_products(id) ON DELETE SET NULL,
  bling_product_id text,
  codigo text,
  descricao text,
  quantidade numeric NOT NULL DEFAULT 0,
  valor_unitario numeric NOT NULL DEFAULT 0,
  desconto numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  custo_unitario numeric NOT NULL DEFAULT 0,
  custo_total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bling_order_items_order ON public.bling_order_items (order_id);
CREATE INDEX idx_bling_order_items_company_codigo ON public.bling_order_items (company_id, codigo);

GRANT SELECT ON public.bling_order_items TO authenticated;
GRANT ALL ON public.bling_order_items TO service_role;
ALTER TABLE public.bling_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read bling_order_items" ON public.bling_order_items
  FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

-- ============ ESTADO INCREMENTAL ============
CREATE TABLE public.bling_orders_sync_state (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  last_synced_at timestamptz,
  last_order_date date,
  total_orders integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bling_orders_sync_state TO authenticated;
GRANT ALL ON public.bling_orders_sync_state TO service_role;
ALTER TABLE public.bling_orders_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read orders_sync_state" ON public.bling_orders_sync_state
  FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

CREATE TABLE public.bling_orders_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'incremental',
  status text NOT NULL DEFAULT 'pendente',
  date_from date,
  changed_since timestamptz,
  current_page integer NOT NULL DEFAULT 1,
  pages_processed integer NOT NULL DEFAULT 0,
  orders_found integer NOT NULL DEFAULT 0,
  orders_new integer NOT NULL DEFAULT 0,
  orders_updated integer NOT NULL DEFAULT 0,
  orders_skipped integer NOT NULL DEFAULT 0,
  items_saved integer NOT NULL DEFAULT 0,
  requests_made integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  last_error text,
  cancel_requested boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  finished_at timestamptz,
  claimed_at timestamptz,
  run_started_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_jobs_company ON public.bling_orders_sync_jobs (company_id, created_at DESC);

GRANT SELECT ON public.bling_orders_sync_jobs TO authenticated;
GRANT ALL ON public.bling_orders_sync_jobs TO service_role;
ALTER TABLE public.bling_orders_sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read orders_sync_jobs" ON public.bling_orders_sync_jobs
  FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON public.bling_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_orders_jobs_updated_at BEFORE UPDATE ON public.bling_orders_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_orders_state_updated_at BEFORE UPDATE ON public.bling_orders_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ DESPESAS DRE ============
CREATE TABLE public.dre_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  competencia date NOT NULL,
  categoria text NOT NULL,
  descricao text,
  tipo text NOT NULL DEFAULT 'fixa',
  valor numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dre_expenses_company ON public.dre_expenses (company_id, competencia);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dre_expenses TO authenticated;
GRANT ALL ON public.dre_expenses TO service_role;
ALTER TABLE public.dre_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage dre_expenses" ON public.dre_expenses
  FOR ALL TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()))
  WITH CHECK (app_private.is_company_member(company_id, auth.uid()));

CREATE TRIGGER trg_dre_expenses_updated_at BEFORE UPDATE ON public.dre_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ RELATÓRIOS ============
CREATE OR REPLACE FUNCTION public.bi_sales_kpis(_company_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _res jsonb;
BEGIN
  IF NOT app_private.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.';
  END IF;

  WITH o AS (
    SELECT * FROM public.bling_orders
    WHERE company_id = _company_id
      AND data BETWEEN _from AND _to
  ), agg AS (
    SELECT
      count(*)::int AS pedidos,
      COALESCE(sum(total),0) AS receita,
      COALESCE(sum(total_produtos),0) AS receita_produtos,
      COALESCE(sum(frete),0) AS frete,
      COALESCE(sum(desconto),0) AS desconto,
      COALESCE(sum(custo_total),0) AS cmv,
      COALESCE(sum(total * COALESCE(taxa_percent,0) / 100.0),0) AS taxas
    FROM o
  ), por_dia AS (
    SELECT jsonb_agg(x ORDER BY x->>'dia') AS series FROM (
      SELECT jsonb_build_object(
        'dia', data,
        'pedidos', count(*),
        'receita', round(COALESCE(sum(total),0)::numeric, 2),
        'cmv', round(COALESCE(sum(custo_total),0)::numeric, 2)
      ) AS x
      FROM o WHERE data IS NOT NULL GROUP BY data
    ) t
  ), por_loja AS (
    SELECT jsonb_agg(x ORDER BY (x->>'receita')::numeric DESC) AS lojas FROM (
      SELECT jsonb_build_object(
        'loja_id', COALESCE(loja_id,'-'),
        'loja_nome', COALESCE(max(loja_nome), 'Bling / Loja própria'),
        'pedidos', count(*),
        'receita', round(COALESCE(sum(total),0)::numeric, 2),
        'cmv', round(COALESCE(sum(custo_total),0)::numeric, 2),
        'taxas', round(COALESCE(sum(total * COALESCE(taxa_percent,0)/100.0),0)::numeric, 2)
      ) AS x
      FROM o GROUP BY COALESCE(loja_id,'-')
    ) t
  ), por_situacao AS (
    SELECT jsonb_agg(x ORDER BY (x->>'pedidos')::int DESC) AS situacoes FROM (
      SELECT jsonb_build_object(
        'situacao', COALESCE(max(situacao_nome), COALESCE(situacao_id,'-')),
        'pedidos', count(*),
        'receita', round(COALESCE(sum(total),0)::numeric, 2)
      ) AS x
      FROM o GROUP BY COALESCE(situacao_id,'-')
    ) t
  ), top_prod AS (
    SELECT jsonb_agg(x ORDER BY (x->>'receita')::numeric DESC) AS produtos FROM (
      SELECT jsonb_build_object(
        'codigo', COALESCE(i.codigo,'-'),
        'descricao', max(i.descricao),
        'quantidade', round(sum(i.quantidade)::numeric, 2),
        'receita', round(sum(i.total)::numeric, 2),
        'cmv', round(sum(i.custo_total)::numeric, 2)
      ) AS x
      FROM public.bling_order_items i
      JOIN o ON o.id = i.order_id
      GROUP BY COALESCE(i.codigo,'-')
      ORDER BY sum(i.total) DESC
      LIMIT 20
    ) t
  )
  SELECT jsonb_build_object(
    'pedidos', agg.pedidos,
    'receita', round(agg.receita, 2),
    'receita_produtos', round(agg.receita_produtos, 2),
    'frete', round(agg.frete, 2),
    'desconto', round(agg.desconto, 2),
    'cmv', round(agg.cmv, 2),
    'taxas', round(agg.taxas, 2),
    'lucro_bruto', round(agg.receita - agg.cmv - agg.taxas - agg.frete, 2),
    'ticket_medio', CASE WHEN agg.pedidos > 0 THEN round(agg.receita / agg.pedidos, 2) ELSE 0 END,
    'margem_percent', CASE WHEN agg.receita > 0
      THEN round(((agg.receita - agg.cmv - agg.taxas - agg.frete) / agg.receita) * 100, 2) ELSE 0 END,
    'series', COALESCE(por_dia.series, '[]'::jsonb),
    'lojas', COALESCE(por_loja.lojas, '[]'::jsonb),
    'situacoes', COALESCE(por_situacao.situacoes, '[]'::jsonb),
    'top_produtos', COALESCE(top_prod.produtos, '[]'::jsonb)
  ) INTO _res
  FROM agg, por_dia, por_loja, por_situacao, top_prod;

  RETURN COALESCE(_res, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.dre_report(_company_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _res jsonb;
  _receita numeric := 0;
  _desconto numeric := 0;
  _frete numeric := 0;
  _cmv numeric := 0;
  _taxas numeric := 0;
  _pedidos int := 0;
  _despesas numeric := 0;
  _ps record;
BEGIN
  IF NOT app_private.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.';
  END IF;

  SELECT count(*)::int,
         COALESCE(sum(total),0),
         COALESCE(sum(desconto),0),
         COALESCE(sum(frete),0),
         COALESCE(sum(custo_total),0),
         COALESCE(sum(total * COALESCE(taxa_percent,0)/100.0),0)
    INTO _pedidos, _receita, _desconto, _frete, _cmv, _taxas
  FROM public.bling_orders
  WHERE company_id = _company_id AND data BETWEEN _from AND _to;

  SELECT COALESCE(sum(valor),0) INTO _despesas
  FROM public.dre_expenses
  WHERE company_id = _company_id
    AND competencia >= date_trunc('month', _from)::date
    AND competencia <= _to;

  SELECT * INTO _ps FROM public.pricing_settings WHERE company_id = _company_id LIMIT 1;

  SELECT jsonb_build_object(
    'periodo', jsonb_build_object('de', _from, 'ate', _to),
    'pedidos', _pedidos,
    'receita_bruta', round(_receita, 2),
    'descontos', round(_desconto, 2),
    'taxas_marketplace', round(_taxas, 2),
    'receita_liquida', round(_receita - _taxas, 2),
    'cmv', round(_cmv, 2),
    'frete', round(_frete, 2),
    'lucro_bruto', round(_receita - _taxas - _cmv - _frete, 2),
    'custo_fixo_estimado', round(_receita * COALESCE(_ps.custo_fixo_percent, 0) / 100.0, 2),
    'devolucao_estimada', round(_receita * COALESCE(_ps.devolucao_percent, 0) / 100.0, 2),
    'despesas', round(_despesas, 2),
    'despesas_por_categoria', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', round(sum(valor),2)) ORDER BY sum(valor) DESC)
      FROM public.dre_expenses
      WHERE company_id = _company_id
        AND competencia >= date_trunc('month', _from)::date
        AND competencia <= _to
      GROUP BY categoria
    ), '[]'::jsonb),
    'resultado_liquido', round(
      _receita - _taxas - _cmv - _frete - _despesas
      - (_receita * COALESCE(_ps.custo_fixo_percent,0)/100.0)
      - (_receita * COALESCE(_ps.devolucao_percent,0)/100.0), 2),
    'margem_liquida_percent', CASE WHEN _receita > 0 THEN round(((
      _receita - _taxas - _cmv - _frete - _despesas
      - (_receita * COALESCE(_ps.custo_fixo_percent,0)/100.0)
      - (_receita * COALESCE(_ps.devolucao_percent,0)/100.0)) / _receita) * 100, 2) ELSE 0 END
  ) INTO _res;

  RETURN _res;
END;
$$;

REVOKE ALL ON FUNCTION public.bi_sales_kpis(uuid, date, date) FROM public;
REVOKE ALL ON FUNCTION public.dre_report(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.bi_sales_kpis(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dre_report(uuid, date, date) TO authenticated, service_role;