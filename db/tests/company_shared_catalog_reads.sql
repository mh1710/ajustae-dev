-- Run in the existing external project; rollback leaves user data untouched.
BEGIN;
SET LOCAL statement_timeout = '300s';
CREATE TEMP TABLE expected_company_reads AS
SELECT cu.user_id, cu.company_id,
  (SELECT count(*) FROM public.bling_products p WHERE p.company_id = cu.company_id) products,
  (SELECT count(*) FROM public.ml_product_matches m WHERE m.company_id = cu.company_id) matches,
  (SELECT count(*) FROM public.bling_supplier_sync_jobs j WHERE j.company_id = cu.company_id) supplier_jobs
FROM public.company_users cu JOIN public.user_roles r ON r.user_id = cu.user_id
WHERE r.role = 'company_viewer' AND cu.ativo;
GRANT SELECT ON expected_company_reads TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE account record; actual bigint;
BEGIN
  FOR account IN SELECT * FROM expected_company_reads LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', account.user_id, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO actual FROM public.bling_products WHERE company_id = account.company_id;
    IF actual <> account.products THEN RAISE EXCEPTION 'Products missing for %', account.company_id; END IF;
    SELECT count(*) INTO actual FROM public.ml_product_matches WHERE company_id = account.company_id;
    IF actual <> account.matches THEN RAISE EXCEPTION 'ML matches missing for %', account.company_id; END IF;
    SELECT count(*) INTO actual FROM public.bling_supplier_sync_jobs WHERE company_id = account.company_id;
    IF actual <> account.supplier_jobs THEN RAISE EXCEPTION 'Supplier jobs missing for %', account.company_id; END IF;
    IF EXISTS (SELECT 1 FROM public.bling_products WHERE company_id <> account.company_id)
      OR EXISTS (SELECT 1 FROM public.ml_product_matches WHERE company_id <> account.company_id)
      OR EXISTS (SELECT 1 FROM public.bling_supplier_sync_jobs WHERE company_id <> account.company_id)
    THEN RAISE EXCEPTION 'Cross-company read allowed'; END IF;
    IF EXISTS (SELECT 1 FROM public.fornecedor_produtos p JOIN public.fornecedores f ON f.id=p.fornecedor_id
      WHERE f.company_id IS NOT NULL AND f.company_id <> account.company_id)
    THEN RAISE EXCEPTION 'Cross-company supplier catalog allowed'; END IF;
    RAISE NOTICE 'Company %: % products, % ML matches, % supplier jobs; isolation OK', account.company_id, account.products, account.matches, account.supplier_jobs;
  END LOOP;
END $$;
ROLLBACK;