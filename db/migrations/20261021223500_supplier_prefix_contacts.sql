-- Fornecedores do Bling de cada empresa identificados pelo campo "Código" do contato,
-- que cada empresa preenche com o prefixo do SKU (EV, E, HA, HX, O, ODS...).
CREATE TABLE IF NOT EXISTS public.bling_supplier_prefix_contacts (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  bling_supplier_id text NOT NULL,
  nome text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, codigo)
);
ALTER TABLE public.bling_supplier_prefix_contacts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.bling_supplier_prefix_contacts TO authenticated;
GRANT ALL ON public.bling_supplier_prefix_contacts TO service_role;
DROP POLICY IF EXISTS "Members read prefix contacts" ON public.bling_supplier_prefix_contacts;
CREATE POLICY "Members read prefix contacts" ON public.bling_supplier_prefix_contacts
  FOR SELECT TO authenticated USING (app_private.is_company_member(company_id, auth.uid()));

-- Escolhe o contato pelo prefixo real do SKU (o código mais longo que inicia o SKU,
-- do mesmo fornecedor); só sem contato com código cai no mapa por fornecedor.
CREATE OR REPLACE FUNCTION public.resolve_import_product_supplier(_company_id uuid, _sku text, _fallback_cost numeric, _fallback_name text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH identity AS (
 SELECT public.map_sku_prefix(btrim(_sku)) AS supplier,
        nullif(btrim(regexp_replace(btrim(_sku), '^[A-Za-z]+', '')), '') AS code
), by_prefix AS (
 SELECT c.bling_supplier_id, c.nome, i.supplier, i.code, 0 AS pri, length(c.codigo) AS len
 FROM identity i JOIN public.bling_supplier_prefix_contacts c ON c.company_id=_company_id
 WHERE upper(btrim(_sku)) LIKE upper(c.codigo) || '%'
   AND public.map_sku_prefix(c.codigo || '1') = i.supplier
   AND c.bling_supplier_id ~ '^[0-9]+$'
), by_map AS (
 SELECT m.bling_supplier_id, m.nome, i.supplier, i.code, 1 AS pri, 0 AS len
 FROM identity i JOIN public.bling_supplier_map m
 ON m.company_id=_company_id AND m.supplier_codigo=i.supplier
 WHERE m.bling_supplier_id ~ '^[0-9]+$' AND m.bling_supplier_id::numeric > 0
), destination AS (
 SELECT bling_supplier_id,nome,supplier,code FROM (SELECT * FROM by_prefix UNION ALL SELECT * FROM by_map) x
 ORDER BY pri, len DESC, bling_supplier_id LIMIT 1
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
$function$;
