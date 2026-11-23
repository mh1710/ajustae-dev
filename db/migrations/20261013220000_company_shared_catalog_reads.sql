-- Same canonical company data for admins and company viewers, without write access.
BEGIN;
ALTER POLICY company_restricted_read ON public.ml_product_matches
  USING (NOT public.is_company_restricted() OR app_private.is_company_member(company_id, auth.uid()));
ALTER POLICY company_restricted_read ON public.ml_map_jobs
  USING (NOT public.is_company_restricted() OR app_private.is_company_member(company_id, auth.uid()));
ALTER POLICY company_restricted_read ON public.bling_supplier_sync_jobs
  USING (NOT public.is_company_restricted() OR app_private.is_company_member(company_id, auth.uid()));
ALTER POLICY company_restricted_read ON public.bling_supplier_map
  USING (NOT public.is_company_restricted() OR app_private.is_company_member(company_id, auth.uid()));
ALTER POLICY company_restricted_read ON public.bling_custom_fields
  USING (NOT public.is_company_restricted() OR app_private.is_company_member(company_id, auth.uid()));
ALTER POLICY company_restricted_read ON public.bling_product_custom_values
  USING (NOT public.is_company_restricted() OR app_private.is_company_member(company_id, auth.uid()));
ALTER POLICY company_restricted_read ON public.product_ml_categories
  USING (NOT public.is_company_restricted() OR app_private.is_company_member(company_id, auth.uid()));
ALTER POLICY company_restricted_read ON public.fornecedor_produtos
  USING (NOT public.is_company_restricted() OR EXISTS (
    SELECT 1 FROM public.fornecedores f WHERE f.id = fornecedor_id
      AND (f.company_id IS NULL OR app_private.is_company_member(f.company_id, auth.uid()))
  ));
COMMIT;
NOTIFY pgrst, 'reload schema';