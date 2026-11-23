BEGIN;
SET LOCAL statement_timeout = '300s';
DO $$
DECLARE account record;
BEGIN
  IF (SELECT count(*) FROM auth.users u WHERE u.email IN (
    'matheusmariano@ajusttae.com.br','casacastro@ajusttae.com.br',
    'casaipiranga@ajusttae.com.br','casamariano@ajusttae.com.br',
    'casamixbrasil@ajusttae.com.br','casamulticoisas@ajusttae.com.br',
    'essencial@ajusttae.com.br','fmocione@ajusttae.com.br',
    'potix@ajusttae.com.br','sos@ajusttae.com.br',
    'ungbrasil@ajusttae.com.br','via44store@ajusttae.com.br')) <> 12
  THEN RAISE EXCEPTION 'The 12 named company logins must exist'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE email LIKE 'empresa.%@acesso.ajusttae.com.br')
  THEN RAISE EXCEPTION 'Legacy display email still present'; END IF;
  FOR account IN SELECT u.id,u.email FROM auth.users u
    JOIN public.user_roles r ON r.user_id=u.id AND r.role='company_viewer'
    WHERE u.email LIKE '%@ajusttae.com.br'
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=account.id AND p.email=account.email)
    THEN RAISE EXCEPTION 'Profile email differs from login for %', account.email; END IF;
    IF (SELECT count(*) FROM public.company_users cu WHERE cu.user_id=account.id AND cu.ativo) <> 1
    THEN RAISE EXCEPTION 'Company login must have exactly one active company: %', account.email; END IF;
    IF public.has_role(account.id,'admin'::public.app_role)
    THEN RAISE EXCEPTION 'Company login bypasses partner restrictions: %', account.email; END IF;
  END LOOP;
  IF NOT public.has_role((SELECT id FROM auth.users WHERE email='blingsvaleria@gmail.com'),'admin'::public.app_role)
  THEN RAISE EXCEPTION 'Main administrator must remain unchanged'; END IF;
  UPDATE auth.users SET email='casamixbrasil-email-test@ajusttae.com.br'
    WHERE email='casamixbrasil@ajusttae.com.br';
  IF NOT EXISTS (SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
    WHERE u.email='casamixbrasil-email-test@ajusttae.com.br' AND p.email=u.email)
  THEN RAISE EXCEPTION 'Email update trigger did not synchronize the display email'; END IF;
  RAISE NOTICE '12 named logins, matching profile emails, single company and partner permissions verified';
END $$;
ROLLBACK;