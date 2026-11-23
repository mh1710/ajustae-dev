-- Mantém o prefixo escolhido no início do lote e impede que partes da mesma
-- importação produzam SKUs com prefixos diferentes.
ALTER TABLE public.supplier_import_batches
  ADD COLUMN IF NOT EXISTS sku_prefix text;

COMMENT ON COLUMN public.supplier_import_batches.sku_prefix IS
  'Prefixo de SKU escolhido obrigatoriamente no início da importação.';

NOTIFY pgrst, 'reload schema';
