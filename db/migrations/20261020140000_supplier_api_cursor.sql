-- Cursor de páginas para fornecedores lidos por API paginada (ex.: Evolusom)
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS sync_cursor integer;
UPDATE public.fornecedores SET source_type = 'api', source_url = 'https://api2.evolusom.com.br/v1/produtos/cliente' WHERE codigo = 'evolusom';
