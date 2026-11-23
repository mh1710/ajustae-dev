CREATE INDEX IF NOT EXISTS idx_fornecedor_produtos_forn_codigo_ltrim
  ON public.fornecedor_produtos (fornecedor_id, (ltrim(codigo, '0')));
CREATE INDEX IF NOT EXISTS idx_bling_product_suppliers_company_product
  ON public.bling_product_suppliers (company_id, product_id);
ALTER FUNCTION public.enqueue_supplier_links(uuid, text, uuid[], text) SET statement_timeout = '300s';
ANALYZE public.fornecedor_produtos;
NOTIFY pgrst, 'reload schema';
