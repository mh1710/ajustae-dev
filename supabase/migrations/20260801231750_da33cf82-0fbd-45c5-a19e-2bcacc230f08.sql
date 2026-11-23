
ALTER TABLE public.bling_orders
  ADD COLUMN IF NOT EXISTS uf text,
  ADD COLUMN IF NOT EXISTS cidade text,
  ADD COLUMN IF NOT EXISTS intermediador_nome text,
  ADD COLUMN IF NOT EXISTS contato_id text;

UPDATE public.bling_orders SET
  uf = NULLIF(raw_json #>> '{transporte,etiqueta,uf}', ''),
  cidade = NULLIF(raw_json #>> '{transporte,etiqueta,municipio}', ''),
  intermediador_nome = NULLIF(raw_json #>> '{intermediador,nomeUsuario}', ''),
  contato_id = NULLIF(raw_json #>> '{contato,id}', '')
WHERE raw_json IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bling_orders_uf ON public.bling_orders (company_id, uf);

CREATE OR REPLACE FUNCTION public.bi_sales_kpis(_company_id uuid, _from date, _to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _res jsonb;
BEGIN
  IF NOT app_private.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.';
  END IF;

  WITH o AS (
    SELECT * FROM public.bling_orders
    WHERE company_id = _company_id AND data BETWEEN _from AND _to
  ), agg AS (
    SELECT
      count(*)::int AS pedidos,
      COALESCE(sum(total),0) AS receita,
      COALESCE(sum(total_produtos),0) AS receita_produtos,
      COALESCE(sum(frete),0) AS frete,
      COALESCE(sum(desconto),0) AS desconto,
      COALESCE(sum(outras_despesas),0) AS outras_despesas,
      COALESCE(sum(custo_total),0) AS cmv,
      COALESCE(sum(total * COALESCE(taxa_percent,0) / 100.0),0) AS taxas,
      count(DISTINCT COALESCE(NULLIF(contato_documento,''), contato_id, contato_nome))::int AS clientes,
      COALESCE(sum((SELECT COALESCE(sum(i.quantidade),0) FROM public.bling_order_items i WHERE i.order_id = o.id)),0) AS itens
    FROM o
  ), por_dia AS (
    SELECT jsonb_agg(x ORDER BY x->>'dia') AS series FROM (
      SELECT jsonb_build_object(
        'dia', data, 'pedidos', count(*),
        'receita', round(COALESCE(sum(total),0)::numeric, 2),
        'cmv', round(COALESCE(sum(custo_total),0)::numeric, 2),
        'lucro', round(COALESCE(sum(total - custo_total - frete - total*COALESCE(taxa_percent,0)/100.0),0)::numeric, 2)
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
      ) AS x FROM o GROUP BY COALESCE(loja_id,'-')
    ) t
  ), por_canal AS (
    SELECT jsonb_agg(x ORDER BY (x->>'receita')::numeric DESC) AS canais FROM (
      SELECT jsonb_build_object(
        'canal', COALESCE(NULLIF(intermediador_nome,''), 'Sem intermediador'),
        'pedidos', count(*),
        'receita', round(COALESCE(sum(total),0)::numeric, 2)
      ) AS x FROM o GROUP BY COALESCE(NULLIF(intermediador_nome,''), 'Sem intermediador')
    ) t
  ), por_situacao AS (
    SELECT jsonb_agg(x ORDER BY (x->>'pedidos')::int DESC) AS situacoes FROM (
      SELECT jsonb_build_object(
        'situacao', COALESCE(max(situacao_nome), COALESCE(situacao_id,'-')),
        'pedidos', count(*),
        'receita', round(COALESCE(sum(total),0)::numeric, 2)
      ) AS x FROM o GROUP BY COALESCE(situacao_id,'-')
    ) t
  ), por_uf AS (
    SELECT jsonb_agg(x ORDER BY (x->>'receita')::numeric DESC) AS estados FROM (
      SELECT jsonb_build_object(
        'uf', COALESCE(NULLIF(uf,''), '--'),
        'pedidos', count(*),
        'clientes', count(DISTINCT COALESCE(NULLIF(contato_documento,''), contato_id, contato_nome)),
        'receita', round(COALESCE(sum(total),0)::numeric, 2),
        'ticket', CASE WHEN count(*) > 0 THEN round((COALESCE(sum(total),0)/count(*))::numeric,2) ELSE 0 END,
        'frete', round(COALESCE(sum(frete),0)::numeric, 2)
      ) AS x FROM o GROUP BY COALESCE(NULLIF(uf,''), '--')
    ) t
  ), por_cidade AS (
    SELECT jsonb_agg(x ORDER BY (x->>'receita')::numeric DESC) AS cidades FROM (
      SELECT jsonb_build_object(
        'cidade', COALESCE(NULLIF(cidade,''),'--'),
        'uf', COALESCE(NULLIF(uf,''),'--'),
        'pedidos', count(*),
        'receita', round(COALESCE(sum(total),0)::numeric, 2)
      ) AS x FROM o GROUP BY COALESCE(NULLIF(cidade,''),'--'), COALESCE(NULLIF(uf,''),'--')
      ORDER BY sum(total) DESC LIMIT 15
    ) t
  ), cli AS (
    SELECT COALESCE(NULLIF(contato_documento,''), contato_id, contato_nome) AS chave,
           max(contato_nome) AS nome, max(COALESCE(uf,'')) AS uf,
           count(*)::int AS pedidos, COALESCE(sum(total),0) AS receita
    FROM o GROUP BY 1
  ), top_cli AS (
    SELECT jsonb_agg(x ORDER BY (x->>'receita')::numeric DESC) AS clientes FROM (
      SELECT jsonb_build_object(
        'nome', COALESCE(nome,'-'), 'uf', uf, 'pedidos', pedidos,
        'receita', round(receita::numeric,2)
      ) AS x FROM cli ORDER BY receita DESC LIMIT 15
    ) t
  ), rec AS (
    SELECT
      count(*) FILTER (WHERE pedidos > 1)::int AS recorrentes,
      count(*) FILTER (WHERE pedidos = 1)::int AS unicos
    FROM cli
  ), novos AS (
    SELECT count(*)::int AS novos FROM cli c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bling_orders b
      WHERE b.company_id = _company_id AND b.data < _from
        AND COALESCE(NULLIF(b.contato_documento,''), b.contato_id, b.contato_nome) = c.chave
    )
  ), top_prod AS (
    SELECT jsonb_agg(x ORDER BY (x->>'receita')::numeric DESC) AS produtos FROM (
      SELECT jsonb_build_object(
        'codigo', COALESCE(i.codigo,'-'), 'descricao', max(i.descricao),
        'quantidade', round(sum(i.quantidade)::numeric, 2),
        'receita', round(sum(i.total)::numeric, 2),
        'cmv', round(sum(i.custo_total)::numeric, 2)
      ) AS x
      FROM public.bling_order_items i JOIN o ON o.id = i.order_id
      GROUP BY COALESCE(i.codigo,'-') ORDER BY sum(i.total) DESC LIMIT 20
    ) t
  )
  SELECT jsonb_build_object(
    'pedidos', agg.pedidos,
    'receita', round(agg.receita, 2),
    'receita_produtos', round(agg.receita_produtos, 2),
    'frete', round(agg.frete, 2),
    'desconto', round(agg.desconto, 2),
    'outras_despesas', round(agg.outras_despesas, 2),
    'cmv', round(agg.cmv, 2),
    'taxas', round(agg.taxas, 2),
    'itens', round(agg.itens, 2),
    'clientes', agg.clientes,
    'clientes_novos', novos.novos,
    'clientes_recorrentes', rec.recorrentes,
    'clientes_unicos', rec.unicos,
    'lucro_bruto', round(agg.receita - agg.cmv - agg.taxas - agg.frete, 2),
    'ticket_medio', CASE WHEN agg.pedidos > 0 THEN round(agg.receita / agg.pedidos, 2) ELSE 0 END,
    'itens_por_pedido', CASE WHEN agg.pedidos > 0 THEN round(agg.itens / agg.pedidos, 2) ELSE 0 END,
    'receita_por_cliente', CASE WHEN agg.clientes > 0 THEN round(agg.receita / agg.clientes, 2) ELSE 0 END,
    'frete_percent', CASE WHEN agg.receita > 0 THEN round(agg.frete / agg.receita * 100, 2) ELSE 0 END,
    'desconto_percent', CASE WHEN agg.receita > 0 THEN round(agg.desconto / agg.receita * 100, 2) ELSE 0 END,
    'taxas_percent', CASE WHEN agg.receita > 0 THEN round(agg.taxas / agg.receita * 100, 2) ELSE 0 END,
    'cmv_percent', CASE WHEN agg.receita > 0 THEN round(agg.cmv / agg.receita * 100, 2) ELSE 0 END,
    'margem_percent', CASE WHEN agg.receita > 0
      THEN round(((agg.receita - agg.cmv - agg.taxas - agg.frete) / agg.receita) * 100, 2) ELSE 0 END,
    'series', COALESCE(por_dia.series, '[]'::jsonb),
    'lojas', COALESCE(por_loja.lojas, '[]'::jsonb),
    'canais', COALESCE(por_canal.canais, '[]'::jsonb),
    'situacoes', COALESCE(por_situacao.situacoes, '[]'::jsonb),
    'estados', COALESCE(por_uf.estados, '[]'::jsonb),
    'cidades', COALESCE(por_cidade.cidades, '[]'::jsonb),
    'top_clientes', COALESCE(top_cli.clientes, '[]'::jsonb),
    'top_produtos', COALESCE(top_prod.produtos, '[]'::jsonb)
  ) INTO _res
  FROM agg, por_dia, por_loja, por_canal, por_situacao, por_uf, por_cidade, top_cli, rec, novos, top_prod;

  RETURN COALESCE(_res, '{}'::jsonb);
END;
$function$;
