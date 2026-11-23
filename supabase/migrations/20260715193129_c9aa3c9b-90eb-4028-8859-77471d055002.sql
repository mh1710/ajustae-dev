CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO authenticated;
GRANT USAGE ON SCHEMA app_private TO service_role;

CREATE OR REPLACE FUNCTION app_private.is_company_member(_company_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = _user_id AND ativo = true
  );
$$;

CREATE OR REPLACE FUNCTION app_private.is_company_admin(_company_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = _user_id AND ativo = true AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION app_private.is_company_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.is_company_admin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.is_company_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.is_company_admin(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "bling_select_members" ON public.bling_integrations;
CREATE POLICY "bling_select_members" ON public.bling_integrations
  FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

DROP POLICY IF EXISTS "Members can view products" ON public.bling_products;
CREATE POLICY "Members can view products" ON public.bling_products
  FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

DROP POLICY IF EXISTS "Members can view sync errors" ON public.bling_sync_job_errors;
CREATE POLICY "Members can view sync errors" ON public.bling_sync_job_errors
  FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

DROP POLICY IF EXISTS "Members can view sync jobs" ON public.bling_sync_jobs;
CREATE POLICY "Members can view sync jobs" ON public.bling_sync_jobs
  FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

DROP POLICY IF EXISTS "companies_select_members" ON public.companies;
CREATE POLICY "companies_select_members" ON public.companies
  FOR SELECT TO authenticated
  USING (app_private.is_company_member(id, auth.uid()));

DROP POLICY IF EXISTS "companies_update_admin" ON public.companies;
CREATE POLICY "companies_update_admin" ON public.companies
  FOR UPDATE TO authenticated
  USING (app_private.is_company_admin(id, auth.uid()))
  WITH CHECK (app_private.is_company_admin(id, auth.uid()));

DROP POLICY IF EXISTS "companies_delete_admin" ON public.companies;
CREATE POLICY "companies_delete_admin" ON public.companies
  FOR DELETE TO authenticated
  USING (app_private.is_company_admin(id, auth.uid()));

DROP POLICY IF EXISTS "company_users_select_members" ON public.company_users;
CREATE POLICY "company_users_select_members" ON public.company_users
  FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

DROP POLICY IF EXISTS "company_users_insert_admin" ON public.company_users;
CREATE POLICY "company_users_insert_admin" ON public.company_users
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.is_company_admin(company_id, auth.uid())
    OR (
      user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = company_users.company_id AND c.owner_user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "company_users_update_admin" ON public.company_users;
CREATE POLICY "company_users_update_admin" ON public.company_users
  FOR UPDATE TO authenticated
  USING (app_private.is_company_admin(company_id, auth.uid()))
  WITH CHECK (app_private.is_company_admin(company_id, auth.uid()));

DROP POLICY IF EXISTS "company_users_delete_admin" ON public.company_users;
CREATE POLICY "company_users_delete_admin" ON public.company_users
  FOR DELETE TO authenticated
  USING (app_private.is_company_admin(company_id, auth.uid()));

DROP FUNCTION IF EXISTS public.is_company_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_company_admin(uuid, uuid);