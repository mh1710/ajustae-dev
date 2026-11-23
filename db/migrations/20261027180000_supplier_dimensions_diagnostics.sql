-- Only exact matches, positive source attributes and company/global active catalogs.
CREATE OR REPLACE FUNCTION public.transform_fill_dimensions_from_supplier(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' SET statement_timeout TO '300s' SET lock_timeout TO '20s'
AS $function$
DECLARE _result jsonb;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.company_users WHERE company_id=_company_id AND user_id=auth.uid() AND ativo=true) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  WITH alvo AS MATERIALIZED (
    SELECT p.*, public.map_sku_prefix(p.codigo) AS sup_codigo,
      upper(substring(btrim(coalesce(p.codigo,'')) from '^[A-Za-z]+')) AS prefix,
      btrim(substring(btrim(coalesce(p.codigo,'')) from '^[A-Za-z]+(.*)$')) AS supplier_sku
    FROM public.bling_products p
    WHERE p.company_id=_company_id AND (_product_ids IS NULL OR p.id=ANY(_product_ids))
      AND (coalesce(p.peso_liquido,0)<=0 OR coalesce(p.largura,0)<=0 OR coalesce(p.altura,0)<=0 OR coalesce(p.profundidade,0)<=0)
  ), resolved AS MATERIALIZED (
    SELECT a.*, fp.id AS supplier_product_id, fp.peso AS source_peso, fp.altura AS source_altura,
      fp.largura AS source_largura, fp.comprimento AS source_depth
    FROM alvo a
    LEFT JOIN LATERAL (
      SELECT min(fprod.id::text)::uuid AS id
      FROM public.fornecedores f JOIN public.fornecedor_produtos fprod ON fprod.fornecedor_id=f.id
      WHERE (f.company_id IS NULL OR f.company_id=_company_id) AND fprod.ativo=true
        AND ((a.sup_codigo IS NOT NULL AND f.codigo=a.sup_codigo AND btrim(fprod.codigo)=a.supplier_sku)
          OR (a.prefix IS NULL AND btrim(coalesce(a.codigo,''))<>'' AND btrim(fprod.codigo)=btrim(a.codigo)))
      HAVING count(*)=1
    ) match ON true
    LEFT JOIN public.fornecedor_produtos fp ON fp.id=match.id
  ), filled AS MATERIALIZED (
    SELECT r.*,
      CASE WHEN peso_liquido>0 THEN peso_liquido WHEN source_peso>0 THEN source_peso ELSE peso_liquido END AS new_peso,
      CASE WHEN peso_bruto>0 THEN peso_bruto WHEN source_peso>0 THEN source_peso ELSE peso_bruto END AS new_bruto,
      CASE WHEN largura>0 THEN largura WHEN source_largura>0 THEN source_largura ELSE largura END AS new_largura,
      CASE WHEN altura>0 THEN altura WHEN source_altura>0 THEN source_altura ELSE altura END AS new_altura,
      CASE WHEN profundidade>0 THEN profundidade WHEN source_depth>0 THEN source_depth ELSE profundidade END AS new_depth
    FROM resolved r
  ), upd AS (
    UPDATE public.bling_products p SET peso_liquido=f.new_peso,peso_bruto=f.new_bruto,
      largura=f.new_largura,altura=f.new_altura,profundidade=f.new_depth,dirty=true,updated_at=now()
    FROM filled f WHERE p.id=f.id AND
      ROW(p.peso_liquido,p.peso_bruto,p.largura,p.altura,p.profundidade) IS DISTINCT FROM
      ROW(f.new_peso,f.new_bruto,f.new_largura,f.new_altura,f.new_depth)
    RETURNING p.id
  )
  SELECT jsonb_build_object(
    'updated',(SELECT count(*) FROM upd),'candidates',count(*),
    'not_found',count(*) FILTER (WHERE supplier_product_id IS NULL),
    'supplier_incomplete',count(*) FILTER (WHERE supplier_product_id IS NOT NULL AND NOT
      (coalesce(new_peso,0)>0 AND coalesce(new_altura,0)>0 AND coalesce(new_largura,0)>0 AND coalesce(new_depth,0)>0)),
    'resolved',count(*) FILTER (WHERE coalesce(new_peso,0)>0 AND coalesce(new_altura,0)>0 AND coalesce(new_largura,0)>0 AND coalesce(new_depth,0)>0)
  ) INTO _result FROM filled;
  RETURN _result;
END;
$function$;