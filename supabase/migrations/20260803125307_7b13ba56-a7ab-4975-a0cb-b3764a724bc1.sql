ALTER TABLE public.bling_orders
  ADD COLUMN IF NOT EXISTS intermediador_cnpj text,
  ADD COLUMN IF NOT EXISTS intermediador_razao_social text;