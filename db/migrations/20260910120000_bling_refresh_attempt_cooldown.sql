-- Evita floodar o endpoint de token do Bling (429): registra a última
-- tentativa de renovação para aplicar cooldown entre tentativas.
ALTER TABLE public.bling_integrations
  ADD COLUMN IF NOT EXISTS last_refresh_attempt_at timestamptz;
