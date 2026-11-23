ALTER FUNCTION public.run_audit_sql(uuid) SET statement_timeout TO '0';
ALTER FUNCTION public.transform_strip_html(uuid) SET statement_timeout TO '0';
ALTER FUNCTION public.transform_fill_desc_complementar(uuid) SET statement_timeout TO '0';

-- Índice para acelerar o JOIN da regra de fornecedor (btrim(codigo))
CREATE INDEX IF NOT EXISTS fornecedor_produtos_fornecedor_codigo_btrim_idx
  ON public.fornecedor_produtos (fornecedor_id, (btrim(codigo)));

-- Índice para acelerar leitura de produtos por empresa durante auditoria
CREATE INDEX IF NOT EXISTS bling_products_company_id_idx
  ON public.bling_products (company_id);

-- Índice para acelerar agregação por run_id
CREATE INDEX IF NOT EXISTS audit_results_run_id_idx
  ON public.audit_results (run_id);