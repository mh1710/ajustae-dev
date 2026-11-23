CREATE OR REPLACE FUNCTION public.dre_repasse_totals(_company_id uuid,_from date,_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
SELECT jsonb_build_object('quantidade',count(*),'repasse',coalesce(sum(repasse),0),
 'custo_produto',coalesce(sum(custo_produto*quantidade),0),
 'custo_etiqueta',coalesce(sum(custo_etiqueta),0),
 'custo_boy',coalesce(sum(custo_boy),0),
 'custo_embalagem',coalesce(sum(custo_embalagem),0),
 'custos',coalesce(sum(custo_produto*quantidade+custo_etiqueta+custo_boy+custo_embalagem),0),
 'resultado',coalesce(sum(resultado),0),'divisao',coalesce(sum(divisao),0))
FROM public.dre_repasses WHERE company_id=_company_id AND data BETWEEN _from AND _to;
$$;
