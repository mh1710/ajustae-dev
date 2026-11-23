\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE fee_fixture AS
 SELECT user_id, (array_agg(company_id ORDER BY company_id))[1] AS a,
 (array_agg(company_id ORDER BY company_id))[2] AS b
 FROM public.company_users WHERE ativo GROUP BY user_id HAVING count(*) >= 2 LIMIT 1;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM fee_fixture) THEN RAISE EXCEPTION 'Missing multi-company fixture'; END IF;
END $$;
INSERT INTO public.marketplaces(id, nome, taxa_percent)
 VALUES ('00000000-0000-4000-a000-000000000125', 'TEST company fee isolation', 15);
SELECT set_config('request.jwt.claim.sub', user_id::text, true) FROM fee_fixture;
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true) FROM fee_fixture;
GRANT SELECT ON fee_fixture TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE ca uuid; cb uuid; m uuid := '00000000-0000-4000-a000-000000000125';
BEGIN
 SELECT a,b INTO ca,cb FROM fee_fixture;
 PERFORM public.save_company_marketplace(ca,m,'ignored name',12);
 PERFORM public.save_company_marketplace(cb,m,'ignored name',18);
 IF public.company_marketplace_fee(ca,m) IS DISTINCT FROM 12 THEN RAISE EXCEPTION 'Company A must use 12%%'; END IF;
 IF public.company_marketplace_fee(cb,m) IS DISTINCT FROM 18 THEN RAISE EXCEPTION 'Company B must use 18%%'; END IF;
 PERFORM public.save_company_marketplace(ca,m,'ignored name',0);
 IF public.company_marketplace_fee(ca,m) IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Zero fee must be preserved'; END IF;
 IF public.company_marketplace_fee(cb,m) IS DISTINCT FROM 18 THEN RAISE EXCEPTION 'Changing A must not alter B'; END IF;
 IF (SELECT taxa_percent FROM public.marketplaces WHERE id=m) IS DISTINCT FROM 15 THEN RAISE EXCEPTION 'Global baseline changed'; END IF;
 IF (SELECT nome FROM public.marketplaces WHERE id=m) <> 'TEST company fee isolation' THEN RAISE EXCEPTION 'Company edit renamed shared identity'; END IF;
END $$;
RESET ROLE;
-- A company-only account cannot read another company's overrides or edit its own.
DO $$
DECLARE u uuid; c uuid;
BEGIN
 SELECT cu.user_id,cu.company_id INTO u,c FROM public.company_users cu
 JOIN public.user_roles r ON r.user_id=cu.user_id AND r.role='company_viewer' WHERE cu.ativo LIMIT 1;
 IF u IS NULL THEN RAISE EXCEPTION 'Missing company-only fixture'; END IF;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('test.fee_company',c::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE c uuid := current_setting('test.fee_company')::uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.company_marketplace_fees f WHERE NOT app_private.is_company_member(f.company_id, auth.uid())) THEN
   RAISE EXCEPTION 'Cross-company read leaked';
 END IF;
 BEGIN
   PERFORM public.save_company_marketplace(c,'00000000-0000-4000-a000-000000000125','test',9);
   RAISE EXCEPTION 'Viewer write unexpectedly allowed';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM = 'Viewer write unexpectedly allowed' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
ROLLBACK;