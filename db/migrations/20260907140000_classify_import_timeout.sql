-- Importações grandes (20k+ linhas): evita "canceling statement due to statement timeout"
-- na classificação, removendo o limite de tempo dentro da função e criando índices
-- de apoio para o lote pendente e para o cálculo de diffs.

CREATE INDEX IF NOT EXISTS idx_psr_pending_classify
  ON public.product_sheet_rows (batch_id, row_number)
  WHERE match_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_psr_pending_diff
  ON public.product_sheet_rows (batch_id, row_number)
  WHERE diff IS NULL AND applied_at IS NULL AND match_product_id IS NOT NULL;

ALTER FUNCTION public.classify_import_batch(uuid, uuid, integer)
  SET statement_timeout TO '0';
