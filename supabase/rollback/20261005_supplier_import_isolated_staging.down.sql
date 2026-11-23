-- ROLLBACK MANUAL: remove somente o staging e os perfis da importação de fornecedor.
-- Não remove produtos de bling_products nem altera as tabelas genéricas de importação.
-- Atenção: regras, perfis e histórico de planilhas de fornecedor serão apagados.

BEGIN;

DROP TABLE IF EXISTS public.supplier_import_rows;
DROP TABLE IF EXISTS public.supplier_import_batches;
DROP TABLE IF EXISTS public.supplier_import_profiles;

COMMIT;
