
-- Add id, used_at, integration_id to bling_oauth_states for one-time-use tracking
ALTER TABLE public.bling_oauth_states
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS used_at timestamptz,
  ADD COLUMN IF NOT EXISTS integration_id uuid REFERENCES public.bling_integrations(id) ON DELETE SET NULL;

-- Extend default expiration window to 15 minutes (already default) — reaffirm
ALTER TABLE public.bling_oauth_states
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '15 minutes');

CREATE INDEX IF NOT EXISTS bling_oauth_states_state_idx ON public.bling_oauth_states (state);
