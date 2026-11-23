-- Resumo rápido (uma consulta só) dos aprovados que faltam na empresa de destino,
-- por empresa de origem, mais o total sem repetir SKU.
CREATE OR REPLACE FUNCTION public.summarize_cross_company_missing(_target_company uuid, _other_companies uuid[])
 RETURNS TABLE(company_id uuid, missing integer, unique_total integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
  with pfx as (
    select distinct m.prefix from public.supplier_prefix_map m
    join public.bling_supplier_map s on s.supplier_codigo = m.supplier_codigo and s.company_id = _target_company
  ), tgt as (
    select distinct codigo from public.bling_products where company_id = _target_company and codigo is not null
  ), cand as (
    select distinct p.company_id cid, btrim(p.codigo) cod
    from public.bling_products p
    where p.company_id = any(_other_companies)
      and p.last_audit_at is not null and p.last_audit_errors = 0 and p.last_audit_warnings = 0
      and p.codigo is not null and p.codigo <> ''
      and p.situacao ilike 'A%'
      and p.descricao_curta ilike '%garantia%'
      and p.descricao_curta ilike '%anatel%'
      and p.descricao_curta ilike '%anvisa%'
      and upper(substring(p.codigo from '^[A-Za-z]+')) in (select prefix from pfx)
      and not exists (select 1 from tgt where tgt.codigo = p.codigo)
  )
  select c.cid, count(*)::int, (select count(distinct cod)::int from cand)
  from cand c group by c.cid;
$function$;
REVOKE ALL ON FUNCTION public.summarize_cross_company_missing(uuid, uuid[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.summarize_cross_company_missing(uuid, uuid[]) TO service_role;
