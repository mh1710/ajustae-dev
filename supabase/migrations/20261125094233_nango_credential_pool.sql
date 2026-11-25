-- Mantém a credencial Nango usada por cada conexão. As chaves continuam
-- exclusivamente no ambiente do servidor; o banco armazena apenas o slot.

ALTER TABLE public.email_connections
  ADD COLUMN IF NOT EXISTS provider_credential_slot smallint NOT NULL DEFAULT 1;

ALTER TABLE public.email_connections
  DROP CONSTRAINT IF EXISTS email_connections_provider_credential_slot_check;

ALTER TABLE public.email_connections
  ADD CONSTRAINT email_connections_provider_credential_slot_check
  CHECK (provider_credential_slot IN (1, 2));

ALTER TABLE public.email_connections
  DROP CONSTRAINT IF EXISTS email_connections_provider_provider_grant_id_key;

ALTER TABLE public.email_connections
  ADD CONSTRAINT email_connections_provider_slot_grant_key
  UNIQUE (provider, provider_credential_slot, provider_grant_id);

CREATE INDEX IF NOT EXISTS email_connections_provider_slot_status_idx
  ON public.email_connections (provider, provider_credential_slot, status);

COMMENT ON COLUMN public.email_connections.provider_credential_slot IS
  'Identificador não secreto da credencial do provedor usada pela conexão; 1=primária, 2=secundária.';

NOTIFY pgrst, 'reload schema';
