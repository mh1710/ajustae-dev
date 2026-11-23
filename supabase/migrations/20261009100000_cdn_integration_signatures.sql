ALTER TABLE public.bling_integrations
  ADD COLUMN IF NOT EXISTS cdn_signature text,
  ADD COLUMN IF NOT EXISTS cdn_signature_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cdn_signature_updated_at timestamptz;

GRANT SELECT (cdn_signature, cdn_signature_active, cdn_signature_updated_at)
  ON public.bling_integrations TO authenticated;
