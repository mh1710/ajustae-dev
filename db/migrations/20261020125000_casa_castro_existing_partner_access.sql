-- The existing partner login must share Casa Castro's canonical company data
-- and use the same restricted role as the previously provisioned company login.
BEGIN;
DO $$
DECLARE partner_id uuid; target_company uuid;
BEGIN
  SELECT id INTO partner_id FROM auth.users
  WHERE lower(email) = 'casacastrooficial@gmail.com';
  SELECT company_id INTO target_company FROM public.company_users
  WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = 'casacastro@ajusttae.com.br')
    AND ativo;
  IF partner_id IS NULL OR target_company IS NULL THEN
    RAISE EXCEPTION 'Casa Castro partner account or canonical company is missing';
  END IF;
  IF public.has_role(partner_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Cannot convert an administrator into a partner account';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_users WHERE user_id = partner_id AND company_id <> target_company AND ativo) THEN
    RAISE EXCEPTION 'Partner account already has another active company';
  END IF;
  INSERT INTO public.company_users(company_id, user_id, role, ativo)
  VALUES (target_company, partner_id, 'membro', true)
  ON CONFLICT (company_id, user_id) DO UPDATE SET role = 'membro', ativo = true;
  INSERT INTO public.user_roles(user_id, role)
  VALUES (partner_id, 'company_viewer')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;
COMMIT;