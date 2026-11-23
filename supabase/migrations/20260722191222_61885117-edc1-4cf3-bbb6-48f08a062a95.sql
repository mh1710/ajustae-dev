
CREATE TABLE public.bling_api_calls (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL,
  integration_id UUID,
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status INTEGER,
  duration_ms INTEGER,
  retries INTEGER DEFAULT 0,
  ok BOOLEAN,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bling_api_calls TO authenticated;
GRANT ALL ON public.bling_api_calls TO service_role;

ALTER TABLE public.bling_api_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view api calls"
  ON public.bling_api_calls FOR SELECT
  TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

CREATE INDEX idx_bling_api_calls_company_created
  ON public.bling_api_calls (company_id, created_at DESC);
