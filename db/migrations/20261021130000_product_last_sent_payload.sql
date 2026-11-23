-- Guarda o último estado completo do produto enviado ao Bling, para que
-- atualizações ("produto") mandem somente os campos que mudaram.
ALTER TABLE public.bling_products
  ADD COLUMN IF NOT EXISTS bling_last_sent_payload jsonb;

CREATE INDEX IF NOT EXISTS bling_products_last_sent_payload_idx
  ON public.bling_products ((bling_last_sent_payload IS NOT NULL));
