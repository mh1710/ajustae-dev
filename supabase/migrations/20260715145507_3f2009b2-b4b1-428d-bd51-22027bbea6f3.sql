
-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  telefone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- ============ COMPANIES ============
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text NOT NULL,
  nome_fantasia text,
  cnpj text,
  status text NOT NULL DEFAULT 'ativa',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- ============ COMPANY_USERS ============
CREATE TABLE public.company_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'membro',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_users TO authenticated;
GRANT ALL ON public.company_users TO service_role;
ALTER TABLE public.company_users ENABLE ROW LEVEL SECURITY;

-- Security definer helpers (avoid recursive RLS)
CREATE OR REPLACE FUNCTION public.is_company_member(_company_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = _user_id AND ativo = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_company_admin(_company_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = _user_id AND ativo = true AND role = 'admin'
  );
$$;

-- Policies referencing helpers
CREATE POLICY "companies_select_members" ON public.companies
  FOR SELECT TO authenticated USING (public.is_company_member(id, auth.uid()));
CREATE POLICY "companies_insert_owner" ON public.companies
  FOR INSERT TO authenticated WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "companies_update_admin" ON public.companies
  FOR UPDATE TO authenticated USING (public.is_company_admin(id, auth.uid()))
  WITH CHECK (public.is_company_admin(id, auth.uid()));
CREATE POLICY "companies_delete_admin" ON public.companies
  FOR DELETE TO authenticated USING (public.is_company_admin(id, auth.uid()));

CREATE POLICY "company_users_select_members" ON public.company_users
  FOR SELECT TO authenticated USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "company_users_insert_admin" ON public.company_users
  FOR INSERT TO authenticated WITH CHECK (
    public.is_company_admin(company_id, auth.uid())
    OR (user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = company_id AND c.owner_user_id = auth.uid()
    ))
  );
CREATE POLICY "company_users_update_admin" ON public.company_users
  FOR UPDATE TO authenticated USING (public.is_company_admin(company_id, auth.uid()))
  WITH CHECK (public.is_company_admin(company_id, auth.uid()));
CREATE POLICY "company_users_delete_admin" ON public.company_users
  FOR DELETE TO authenticated USING (public.is_company_admin(company_id, auth.uid()));

-- ============ BLING_INTEGRATIONS ============
CREATE TABLE public.bling_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'desconectada',
  nome_conexao text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text,
  bling_account_id text,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT (id, company_id, status, nome_conexao, token_expires_at, scopes, bling_account_id, last_sync_at, last_error, created_at, updated_at)
  ON public.bling_integrations TO authenticated;
GRANT ALL ON public.bling_integrations TO service_role;
ALTER TABLE public.bling_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bling_select_members" ON public.bling_integrations
  FOR SELECT TO authenticated USING (public.is_company_member(company_id, auth.uid()));
-- Writes are restricted to server (service_role) only; no INSERT/UPDATE/DELETE policies for authenticated.

-- ============ BLING_OAUTH_STATES ============
CREATE TABLE public.bling_oauth_states (
  state text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
);
GRANT ALL ON public.bling_oauth_states TO service_role;
-- No grants to authenticated: this is backend-only.
ALTER TABLE public.bling_oauth_states ENABLE ROW LEVEL SECURITY;

-- ============ updated_at trigger ============
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER tg_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER tg_companies_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER tg_bling_integrations_updated_at BEFORE UPDATE ON public.bling_integrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ Auto-create profile on user signup ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email, telefone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', ''),
    COALESCE(NEW.email, ''),
    NEW.raw_user_meta_data->>'telefone'
  );
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
