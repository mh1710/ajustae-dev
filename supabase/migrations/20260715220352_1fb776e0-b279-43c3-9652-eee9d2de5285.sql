
DROP INDEX IF EXISTS public.uq_bling_products_company_codigo;
DROP INDEX IF EXISTS public.bling_products_company_codigo_uidx;
ALTER TABLE public.bling_products
  ADD CONSTRAINT bling_products_company_codigo_key UNIQUE (company_id, codigo);
