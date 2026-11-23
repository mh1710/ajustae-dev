-- Índice único essencial para o upsert por (company_id, codigo) usado na importação.
-- Só cria se não existir; se houver colisão pré-existente, o índice falha e migração aborta (é o comportamento correto).
CREATE UNIQUE INDEX IF NOT EXISTS bling_products_company_codigo_uidx
  ON public.bling_products (company_id, codigo)
  WHERE codigo IS NOT NULL AND codigo <> '';

-- Contadores incrementais para progresso ao vivo na aplicação.
ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS apply_processed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS apply_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS classify_processed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS classify_total integer NOT NULL DEFAULT 0;