-- Nome do produto no catálogo do fornecedor, achado pelo SKU (prefixo -> fornecedor, número -> código).
CREATE OR REPLACE FUNCTION public.supplier_product_names(_skus text[])
RETURNS TABLE (sku text, nome text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT s.sku, x.nome
  FROM unnest(_skus) AS s(sku)
  CROSS JOIN LATERAL (
    SELECT NULLIF(btrim(COALESCE(fp.titulo, fp.nome_nota)), '') AS nome
    FROM fornecedores f JOIN fornecedor_produtos fp ON fp.fornecedor_id = f.id
    WHERE f.codigo = public.map_sku_prefix(s.sku)
      AND ltrim(fp.codigo, '0') = ltrim(regexp_replace(btrim(s.sku), '^[A-Za-z]+', ''), '0')
      AND NULLIF(btrim(COALESCE(fp.titulo, fp.nome_nota)), '') IS NOT NULL
    LIMIT 1
  ) x
$$;
GRANT EXECUTE ON FUNCTION public.supplier_product_names(text[]) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
