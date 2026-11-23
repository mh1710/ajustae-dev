BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE castro_expected AS
SELECT u.id user_id, cu.company_id,
  (SELECT count(*) FROM public.bling_products p WHERE p.company_id = cu.company_id) products
FROM auth.users u JOIN public.company_users cu ON cu.user_id = u.id AND cu.ativo
WHERE lower(u.email) = 'casacastrooficial@gmail.com';
GRANT SELECT ON castro_expected TO authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM castro_expected) <> 1 THEN
    RAISE EXCEPTION 'Casa Castro partner must have exactly one active company';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE account record; actual bigint; changed bigint;
BEGIN
  SELECT * INTO account FROM castro_expected;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', account.user_id, 'role', 'authenticated')::text, true);
  IF NOT public.is_company_restricted() THEN RAISE EXCEPTION 'Partner restrictions missing'; END IF;
  IF public.has_role(account.user_id, 'admin'::public.app_role) THEN RAISE EXCEPTION 'Partner must not be admin'; END IF;
  SELECT count(*) INTO actual FROM public.bling_products WHERE company_id = account.company_id;
  IF actual = 0 OR actual <> account.products THEN RAISE EXCEPTION 'Partner must see all canonical products'; END IF;
  IF EXISTS (SELECT 1 FROM public.bling_products WHERE company_id <> account.company_id) THEN
    RAISE EXCEPTION 'Other company products exposed';
  END IF;
  UPDATE public.bling_products SET nome = nome WHERE company_id = account.company_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'Partner must not edit products'; END IF;
  RAISE NOTICE 'Casa Castro partner: % canonical products visible, other companies hidden, product editing blocked', actual;
END $$;
ROLLBACK;