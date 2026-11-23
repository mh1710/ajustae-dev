-- Complementa apenas as estruturas exclusivas da importação de fornecedor.
ALTER TABLE public.supplier_import_profiles
  ADD COLUMN IF NOT EXISTS value_mappings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rules jsonb NOT NULL DEFAULT '[]'::jsonb;
