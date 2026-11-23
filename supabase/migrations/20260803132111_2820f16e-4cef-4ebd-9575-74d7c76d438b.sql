CREATE OR REPLACE FUNCTION public.dre_report(_company_id uuid, _from date, _to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _res jsonb;
  _receita numeric := 0;
  _desconto numeric := 0;
  _frete numeric := 0;
  _cmv numeric := 0;
  _taxas numeric := 0;
  _pedidos int := 0;
  _despesas numeric := 0;
  _pedidos_sem_custo int := 0;
  _receita_sem_custo numeric := 0;
  _cobertura numeric := 0;
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
         COALESCE(sum(total * COALESCE(taxa_percent,0)/100.0),0),
         COALESCE(count(*) FILTER (WHERE COALESCE(custo_total,0) <= 0),0)::int,
         COALESCE(sum(total) FILTER (WHERE COALESCE(custo_total,0) <= 0),0)
    INTO _pedidos, _receita, _desconto, _frete, _cmv, _taxas, _pedidos_sem_custo, _receita_sem_custo
  FROM public.bling_orders
  WHERE company_id = _company_id AND data BETWEEN _from AND _to;

  _cobertura := CASE WHEN _receita > 0
    THEN round(((_receita - _receita_sem_custo) / _receita) * 100, 2) ELSE 0 END;

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
    'pedidos_sem_custo', _pedidos_sem_custo,
    'receita_sem_custo', round(_receita_sem_custo, 2),
    'cobertura_cmv_percent', _cobertura,
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
$function$;