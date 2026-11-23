CREATE TABLE public.ml_integration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  status text NOT NULL DEFAULT 'desconectada',
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  ml_user_id text,
  ml_nickname text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ml_integration TO service_role;
ALTER TABLE public.ml_integration ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ml_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ml_oauth_states TO service_role;
ALTER TABLE public.ml_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ml_product_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.bling_products(id) ON DELETE CASCADE,
  sku text,
  nome text,
  ean text,
  found boolean NOT NULL DEFAULT false,
  has_full boolean NOT NULL DEFAULT false,
  full_offers integer NOT NULL DEFAULT 0,
  total_offers integer NOT NULL DEFAULT 0,
  min_price numeric,
  min_full_price numeric,
  permalink text,
  match_by text,
  error text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id)
);
CREATE INDEX ml_product_matches_company_idx ON public.ml_product_matches (company_id);
CREATE INDEX ml_product_matches_flags_idx ON public.ml_product_matches (company_id, found, has_full);
GRANT SELECT ON public.ml_product_matches TO authenticated;
GRANT ALL ON public.ml_product_matches TO service_role;
ALTER TABLE public.ml_product_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read ml matches" ON public.ml_product_matches
  FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

CREATE TABLE public.ml_map_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  scope text NOT NULL DEFAULT 'todos',
  product_ids uuid[],
  total integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  found_count integer NOT NULL DEFAULT 0,
  full_count integer NOT NULL DEFAULT 0,
  cursor_id uuid,
  cancel_requested boolean NOT NULL DEFAULT false,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ml_map_jobs_company_idx ON public.ml_map_jobs (company_id, created_at DESC);
GRANT SELECT ON public.ml_map_jobs TO authenticated;
GRANT ALL ON public.ml_map_jobs TO service_role;
ALTER TABLE public.ml_map_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read ml jobs" ON public.ml_map_jobs
  FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));