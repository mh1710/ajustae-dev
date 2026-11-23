-- Importação entre empresas: o prefixo do SKU deve estar no mapa central E o
-- fornecedor correspondente deve existir no Bling da empresa de destino
-- (bling_supplier_map), para que o produto chegue já ligável a um fornecedor.
CREATE OR REPLACE FUNCTION public.count_cross_company_import_candidates(_target_company uuid, _other_companies uuid[], _search text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 RETURN (select count(*)::int from (
    select distinct p.codigo cod
    from public.bling_products p
    where p.company_id = any(_other_companies)
      and p.last_audit_at is not null
      and p.last_audit_errors = 0
      and p.last_audit_warnings = 0
      and p.codigo is not null and p.codigo <> ''
      and upper(coalesce(p.situacao,'')) like 'A%'
      and coalesce(p.descricao_curta,'') ~* 'garantia'
      and coalesce(p.descricao_curta,'') ~* 'anatel'
      and coalesce(p.descricao_curta,'') ~* 'anvisa'
      and (_search is null or _search = '' or p.codigo ilike '%'||_search||'%' or p.nome ilike '%'||_search||'%')
      and not exists (
        select 1 from public.bling_products d
        where d.company_id = _target_company and d.codigo = p.codigo
      )
      and upper(substring(p.codigo from '^[A-Za-z]+')) in (
        select m.prefix from public.supplier_prefix_map m
        join public.bling_supplier_map s
          on s.supplier_codigo = m.supplier_codigo
         and s.company_id = _target_company
      )
  ) t);
END;
$function$;
