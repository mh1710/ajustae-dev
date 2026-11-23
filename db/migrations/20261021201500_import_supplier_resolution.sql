-- Resolve only the destination supplier; never reuse the source contact ID.
CREATE OR REPLACE FUNCTION public.resolve_import_product_supplier(_company_id uuid, _sku text, _fallback_cost numeric, _fallback_name text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH identity AS (
 SELECT public.map_sku_prefix(btrim(_sku)) AS supplier,
        nullif(btrim(regexp_replace(btrim(_sku), '^[A-Za-z]+', '')), '') AS code
), destination AS (
 SELECT m.bling_supplier_id,m.nome,i.supplier,i.code
 FROM identity i JOIN public.bling_supplier_map m
 ON m.company_id=_company_id AND m.supplier_codigo=i.supplier
 WHERE m.bling_supplier_id ~ '^[0-9]+$' AND m.bling_supplier_id::numeric > 0
 ORDER BY m.bling_supplier_id LIMIT 1
), resolved AS (
 SELECT d.*,fp.codigo AS catalog_code,coalesce(nullif(btrim(fp.titulo),''),nullif(btrim(fp.nome_nota),''),_fallback_name) AS description,
 coalesce(nullif((fp.precos->>'PR')::numeric,0),nullif((fp.precos->>'base')::numeric,0),
 nullif((fp.precos->>'dropshipping')::numeric,0),nullif((fp.precos->>'crossdocking')::numeric,0),nullif(_fallback_cost,0)) AS cost
 FROM destination d LEFT JOIN LATERAL (
 SELECT p.codigo,p.titulo,p.nome_nota,p.precos FROM public.fornecedor_produtos p
 JOIN public.fornecedores f ON f.id=p.fornecedor_id
 WHERE f.codigo=d.supplier AND p.ativo AND ltrim(p.codigo,'0')=ltrim(d.code,'0')
 ORDER BY (p.codigo=d.code) DESC,p.updated_at DESC,p.id LIMIT 1
 ) fp ON true
)
SELECT jsonb_build_object('bling_supplier_id',bling_supplier_id,'supplier_codigo',supplier,
 'supplier_name',nome,'codigo',coalesce(catalog_code,code),'preco_custo',cost,'descricao',left(description,120))
FROM resolved WHERE cost > 0 AND code IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.resolve_import_product_supplier(uuid,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_import_product_supplier(uuid,text,numeric,text) TO service_role;
NOTIFY pgrst, 'reload schema';