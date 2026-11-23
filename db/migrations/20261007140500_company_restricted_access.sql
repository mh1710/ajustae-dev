-- Restricted company logins: deny by default while preserving existing administrator behavior.
BEGIN;
CREATE OR REPLACE FUNCTION public.is_company_restricted() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text='company_viewer') $$;
REVOKE ALL ON FUNCTION public.is_company_restricted() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_company_restricted() TO authenticated,service_role;
ALTER TABLE public.ml_sku_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.ml_sku_checks AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.ml_sku_checks AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.ml_sku_checks AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.ml_sku_checks AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.ml_prospect_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.ml_prospect_items AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.ml_prospect_items AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.ml_prospect_items AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.ml_prospect_items AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_product_suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_product_suppliers AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.bling_product_suppliers AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_product_suppliers AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_product_suppliers AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.ai_transform_job_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.ai_transform_job_items AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.ai_transform_job_items AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.ai_transform_job_items AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.ai_transform_job_items AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_supplier_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_supplier_map AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_supplier_map AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_supplier_map AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_supplier_map AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.ai_transform_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.ai_transform_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.ai_transform_jobs AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.ai_transform_jobs AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.ai_transform_jobs AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_api_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_api_calls AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_api_calls AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_api_calls AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_api_calls AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.category_ai_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.category_ai_access AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.category_ai_access AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.category_ai_access AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.category_ai_access AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_stores AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.bling_stores AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_stores AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_stores AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.product_cost_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.product_cost_overrides AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.product_cost_overrides AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.product_cost_overrides AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.product_cost_overrides AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_existence_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_existence_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.bling_existence_jobs AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_existence_jobs AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_existence_jobs AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.companies AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.companies AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.companies AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.companies AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_existence_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_existence_items AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.bling_existence_items AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_existence_items AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_existence_items AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.company_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.company_users AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.company_users AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.company_users AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.company_users AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.profiles AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.profiles AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.profiles AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_oauth_states AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_oauth_states AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_oauth_states AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_oauth_states AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_sync_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.bling_sync_jobs AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_sync_jobs AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_sync_jobs AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_sync_job_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_sync_job_errors AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_sync_job_errors AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_sync_job_errors AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_sync_job_errors AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.ml_prospect_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.ml_prospect_candidates AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.ml_prospect_candidates AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.ml_prospect_candidates AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.ml_prospect_candidates AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_store_sync_page_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_store_sync_page_errors AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_store_sync_page_errors AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_store_sync_page_errors AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_store_sync_page_errors AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.ml_prospect_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.ml_prospect_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.ml_prospect_jobs AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.ml_prospect_jobs AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.ml_prospect_jobs AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.ml_refresh_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.ml_refresh_state AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.ml_refresh_state AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.ml_refresh_state AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.ml_refresh_state AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_supplier_sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_supplier_sync_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_supplier_sync_jobs AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_supplier_sync_jobs AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_supplier_sync_jobs AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.anatel_homologacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.anatel_homologacoes AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.anatel_homologacoes AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.anatel_homologacoes AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.anatel_homologacoes AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.anatel_homologacao_modelos ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.anatel_homologacao_modelos AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.anatel_homologacao_modelos AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.anatel_homologacao_modelos AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.anatel_homologacao_modelos AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.audit_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.audit_runs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.audit_runs AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.audit_runs AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.audit_runs AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.validation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.validation_rules AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.validation_rules AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.validation_rules AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.validation_rules AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.product_sheet_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.product_sheet_rows AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.product_sheet_rows AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.product_sheet_rows AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.product_sheet_rows AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.import_batches AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.import_batches AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.import_batches AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.import_batches AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.audit_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.audit_results AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.audit_results AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.audit_results AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.audit_results AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.fornecedor_produtos ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.fornecedor_produtos AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.fornecedor_produtos AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.fornecedor_produtos AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.fornecedor_produtos AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_push_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_push_queue AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.bling_push_queue AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_push_queue AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_push_queue AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.anatel_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.anatel_products AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.anatel_products AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.anatel_products AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.anatel_products AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_products AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.bling_products AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_products AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_products AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_store_sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_store_sync_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.bling_store_sync_jobs AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_store_sync_jobs AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_store_sync_jobs AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.fornecedores AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.fornecedores AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.fornecedores AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.fornecedores AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_product_stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_product_stores AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.bling_product_stores AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_product_stores AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_product_stores AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.marketplaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.marketplaces AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.marketplaces AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.marketplaces AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.marketplaces AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.pricing_settings AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.pricing_settings AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.pricing_settings AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.pricing_settings AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.transform_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.transform_sessions AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.transform_sessions AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.transform_sessions AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.transform_sessions AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_custom_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_custom_fields AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_custom_fields AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_custom_fields AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_custom_fields AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_custom_fields_import_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_custom_fields_import_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_custom_fields_import_jobs AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_custom_fields_import_jobs AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_custom_fields_import_jobs AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.automation_runs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.automation_runs AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.automation_runs AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.automation_runs AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.automation_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.automation_schedules AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.automation_schedules AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.automation_schedules AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.automation_schedules AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.worker_leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.worker_leases AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.worker_leases AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.worker_leases AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.worker_leases AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.automation_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.automation_changes AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.automation_changes AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.automation_changes AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.automation_changes AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_order_items AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.bling_order_items AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_order_items AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_order_items AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_orders_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_orders_sync_state AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.bling_orders_sync_state AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_orders_sync_state AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_orders_sync_state AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_orders_sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_orders_sync_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.bling_orders_sync_jobs AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_orders_sync_jobs AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_orders_sync_jobs AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.ml_oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.ml_oauth_states AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.ml_oauth_states AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.ml_oauth_states AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.ml_oauth_states AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.user_permissions AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.user_permissions AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.user_permissions AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.user_permissions AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.dre_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.dre_expenses AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.dre_expenses AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted() OR app_private.is_company_member(company_id,auth.uid()));
CREATE POLICY company_restricted_update ON public.dre_expenses AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted() OR app_private.is_company_member(company_id,auth.uid())) WITH CHECK (NOT public.is_company_restricted() OR app_private.is_company_member(company_id,auth.uid()));
CREATE POLICY company_restricted_delete ON public.dre_expenses AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted() OR app_private.is_company_member(company_id,auth.uid())) ;
ALTER TABLE public.bling_api_usage_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_api_usage_daily AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_api_usage_daily AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_api_usage_daily AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_api_usage_daily AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.ml_map_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.ml_map_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.ml_map_jobs AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.ml_map_jobs AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.ml_map_jobs AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_orders AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.bling_orders AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_orders AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_orders AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.ml_integration ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.ml_integration AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.ml_integration AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.ml_integration AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.ml_integration AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.user_roles AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.user_roles AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.user_roles AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.user_roles AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_integrations AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_integrations AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_integrations AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_integrations AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_oauth_apps ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_oauth_apps AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_oauth_apps AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_oauth_apps AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_oauth_apps AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.ml_product_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.ml_product_matches AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.ml_product_matches AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.ml_product_matches AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.ml_product_matches AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.stock_audit_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.stock_audit_runs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.stock_audit_runs AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.stock_audit_runs AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.stock_audit_runs AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.stock_audit_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.stock_audit_items AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.stock_audit_items AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.stock_audit_items AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.stock_audit_items AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.supplier_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.supplier_import_batches AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.supplier_import_batches AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.supplier_import_batches AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.supplier_import_batches AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.supplier_import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.supplier_import_rows AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.supplier_import_rows AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.supplier_import_rows AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.supplier_import_rows AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.supplier_import_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.supplier_import_profiles AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.supplier_import_profiles AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.supplier_import_profiles AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.supplier_import_profiles AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.product_category_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.product_category_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.product_category_jobs AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.product_category_jobs AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.product_category_jobs AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.product_ml_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.product_ml_categories AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.product_ml_categories AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.product_ml_categories AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.product_ml_categories AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_product_custom_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_product_custom_values AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_product_custom_values AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_product_custom_values AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_product_custom_values AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_custom_field_push_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_custom_field_push_items AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_custom_field_push_items AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_custom_field_push_items AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_custom_field_push_items AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_custom_field_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_custom_field_roles AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_custom_field_roles AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_custom_field_roles AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_custom_field_roles AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.bling_custom_field_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.bling_custom_field_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.bling_custom_field_jobs AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.bling_custom_field_jobs AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.bling_custom_field_jobs AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.product_category_job_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.product_category_job_items AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted());
CREATE POLICY company_restricted_insert ON public.product_category_job_items AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.product_category_job_items AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.product_category_job_items AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
ALTER TABLE public.supplier_prefix_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_restricted_read ON public.supplier_prefix_map AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_company_restricted() OR true);
CREATE POLICY company_restricted_insert ON public.supplier_prefix_map AS RESTRICTIVE FOR INSERT TO authenticated  WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_update ON public.supplier_prefix_map AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_company_restricted()) WITH CHECK (NOT public.is_company_restricted());
CREATE POLICY company_restricted_delete ON public.supplier_prefix_map AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_company_restricted()) ;
CREATE OR REPLACE FUNCTION public.match_marketplace_store_code(_company_id uuid, _marketplace text, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(product_id uuid, bling_product_id text, bling_product_store_id text, bling_store_id text, store_name text, codigo_atual text, codigo_novo text, preco numeric, preco_promocional numeric, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 RETURN QUERY SELECT
    bps.internal_product_id,
    p.bling_product_id,
    bps.bling_product_store_id,
    bps.bling_store_id,
    bps.store_name,
    bps.store_product_code,
    CASE _marketplace
      WHEN 'kabum' THEN nullif(btrim(p.codigo), '')
      WHEN 'web_continental' THEN nullif(btrim(bps.bling_store_id), '')
    END,
    bps.current_price,
    bps.current_promotional_price,
    CASE
      WHEN _marketplace NOT IN ('kabum', 'web_continental') THEN 'marketplace_invalido'
      WHEN nullif(btrim(p.bling_product_id), '') IS NULL
        OR nullif(btrim(bps.bling_product_store_id), '') IS NULL
        OR nullif(btrim(bps.bling_store_id), '') IS NULL
        OR bps.current_price IS NULL THEN 'sem_dados'
      WHEN _marketplace = 'kabum' AND nullif(btrim(p.codigo), '') IS NULL THEN 'sem_dados'
      WHEN btrim(coalesce(bps.store_product_code, '')) = btrim(CASE _marketplace
        WHEN 'kabum' THEN coalesce(p.codigo, '')
        WHEN 'web_continental' THEN coalesce(bps.bling_store_id, '')
      END) THEN 'ja_correto'
      ELSE 'atualizar'
    END
  FROM public.bling_product_stores bps
  JOIN public.bling_products p
    ON p.id = bps.internal_product_id
   AND p.company_id = bps.company_id
  LEFT JOIN public.bling_stores bs
    ON bs.company_id = bps.company_id
   AND bs.bling_store_id = bps.bling_store_id
  LEFT JOIN public.marketplaces m
    ON m.id = bs.marketplace_id
  WHERE bps.company_id = _company_id
    AND bps.is_linked = true
    AND (_product_ids IS NULL OR bps.internal_product_id = ANY(_product_ids))
    AND (
      (_marketplace = 'kabum' AND (
        (bs.marketplace_id IS NOT NULL AND lower(coalesce(m.nome, '')) LIKE '%kabum%')
        OR
        (bs.marketplace_id IS NULL AND (
          lower(coalesce(bps.store_type, '')) = 'kabum'
          OR lower(coalesce(bps.store_name, '')) LIKE '%kabum%'
        ))
      ))
      OR
      (_marketplace = 'web_continental' AND (
        (bs.marketplace_id IS NOT NULL AND (
          lower(coalesce(m.nome, '')) LIKE '%web continental%'
          OR lower(coalesce(m.nome, '')) LIKE '%webco%'
        ))
        OR
        (bs.marketplace_id IS NULL AND (
          lower(coalesce(bps.store_name, '')) LIKE '%webco%'
          OR lower(coalesce(bps.store_name, '')) LIKE '%continental%'
          OR lower(coalesce(bps.store_name, '')) LIKE '%web ung%'
        ))
      ))
    );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.preview_marketplace_store_code(_company_id uuid, _marketplace text, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _result jsonb;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF _marketplace NOT IN ('kabum', 'web_continental') THEN
    RAISE EXCEPTION 'Marketplace inválido.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN RAISE EXCEPTION 'not a member of company'; END IF;

  SELECT jsonb_build_object(
    'total', count(*),
    'to_update', count(*) FILTER (WHERE status = 'atualizar'),
    'already_correct', count(*) FILTER (WHERE status = 'ja_correto'),
    'skipped', count(*) FILTER (WHERE status NOT IN ('atualizar', 'ja_correto'))
  ) INTO _result
  FROM public.match_marketplace_store_code(_company_id, _marketplace, _product_ids);
  RETURN _result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_stuck_bling_stores_jobs(_minutes integer DEFAULT 15)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  WITH upd AS (
    UPDATE public.bling_store_sync_jobs
       SET status = 'cancelada',
           cancel_requested = true,
           finished_at = now(),
           last_error = COALESCE(last_error, 'Job travado — finalizado automaticamente.')
     WHERE status IN ('processando','retomando','catalogando','cancelando','pendente')
       AND COALESCE(claimed_at, started_at, created_at) < now() - make_interval(mins => GREATEST(_minutes, 1))
    RETURNING 1
  ) SELECT count(*) INTO _n FROM upd;
  RETURN _n;
END; $function$
;
CREATE OR REPLACE FUNCTION public.apply_store_code_sheet(_company_id uuid, _rows jsonb, _force_existing boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '180s'
AS $function$
DECLARE
  _integration_id uuid;
  _enqueued integer := 0;
  _skipped integer := 0;
  _duplicadas integer := 0;
  _existing_enqueued integer := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT id INTO _integration_id
  FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada'
  LIMIT 1;

  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada.';
  END IF;

  CREATE TEMP TABLE _sheet_work ON COMMIT DROP AS
  SELECT * FROM public.match_store_code_sheet(_company_id, _rows);

  SELECT count(*) INTO _skipped
  FROM _sheet_work
  WHERE status NOT IN ('ok', 'ja_atualizado')
     OR (status = 'ja_atualizado' AND NOT _force_existing);

  CREATE TEMP TABLE _sheet_eligible ON COMMIT DROP AS
  SELECT DISTINCT ON (w.product_id, w.bling_product_store_id) w.*
  FROM _sheet_work w
  WHERE w.status = 'ok'
     OR (_force_existing AND w.status = 'ja_atualizado')
  ORDER BY w.product_id, w.bling_product_store_id, w.linha DESC;

  SELECT
    (SELECT count(*) FROM _sheet_work
      WHERE status = 'ok' OR (_force_existing AND status = 'ja_atualizado'))
    - (SELECT count(*) FROM _sheet_eligible)
  INTO _duplicadas;

  SELECT count(*) INTO _existing_enqueued
  FROM _sheet_eligible
  WHERE status = 'ja_atualizado';

  DELETE FROM public.bling_push_queue q
  USING _sheet_eligible w
  WHERE q.integration_id = _integration_id
    AND q.tipo = 'codigo_loja_planilha'
    AND q.bling_product_store_id = w.bling_product_store_id
    AND q.status IN ('pendente', 'processando');

  WITH inserted AS (
    INSERT INTO public.bling_push_queue (
      company_id, integration_id, product_id, bling_product_id,
      bling_product_store_id, tipo, valor_novo, payload,
      status, proxima_tentativa_em
    )
    SELECT
      _company_id, _integration_id, w.product_id, w.bling_product_id,
      w.bling_product_store_id, 'codigo_loja_planilha', w.preco,
      jsonb_build_object(
        'bling_store_id', w.bling_store_id,
        'codigo', w.codigo_novo,
        'preco', w.preco,
        'preco_promocional', w.preco_promocional,
        'origem', 'planilha',
        'reenvio', w.status = 'ja_atualizado'
      ),
      'pendente', now()
    FROM _sheet_eligible w
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _enqueued FROM inserted;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'enqueued', _enqueued,
    'existing_enqueued', _existing_enqueued,
    'skipped', _skipped,
    'duplicadas', _duplicadas
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.apply_marketplace_store_code(_company_id uuid, _marketplace text, _product_ids uuid[] DEFAULT NULL::uuid[], _force_existing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '180s'
AS $function$
DECLARE
  _integration_id uuid;
  _enqueued integer := 0;
  _skipped integer := 0;
  _existing_enqueued integer := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF _marketplace NOT IN ('kabum', 'web_continental') THEN
    RAISE EXCEPTION 'Marketplace inválido.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT id INTO _integration_id
  FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada'
  LIMIT 1;

  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada.';
  END IF;

  CREATE TEMP TABLE _marketplace_codes ON COMMIT DROP AS
  SELECT * FROM public.match_marketplace_store_code(_company_id, _marketplace, _product_ids);

  CREATE TEMP TABLE _marketplace_eligible ON COMMIT DROP AS
  SELECT *
  FROM _marketplace_codes
  WHERE status = 'atualizar'
     OR (_force_existing AND status = 'ja_correto');

  SELECT count(*) INTO _skipped
  FROM _marketplace_codes
  WHERE status NOT IN ('atualizar', 'ja_correto')
     OR (status = 'ja_correto' AND NOT _force_existing);

  SELECT count(*) INTO _existing_enqueued
  FROM _marketplace_eligible
  WHERE status = 'ja_correto';

  DELETE FROM public.bling_push_queue q
  USING _marketplace_eligible w
  WHERE q.integration_id = _integration_id
    AND q.tipo = 'codigo_loja_planilha'
    AND q.bling_product_store_id = w.bling_product_store_id
    AND q.status IN ('pendente', 'processando');

  WITH inserted AS (
    INSERT INTO public.bling_push_queue (
      company_id, integration_id, product_id, bling_product_id,
      bling_product_store_id, tipo, valor_novo, payload, status, proxima_tentativa_em
    )
    SELECT
      _company_id, _integration_id, w.product_id, w.bling_product_id,
      w.bling_product_store_id, 'codigo_loja_planilha', w.preco,
      jsonb_build_object(
        'bling_store_id', w.bling_store_id,
        'codigo', w.codigo_novo,
        'preco', w.preco,
        'preco_promocional', w.preco_promocional,
        'origem', 'marketplace',
        'marketplace', _marketplace,
        'reenvio', w.status = 'ja_correto'
      ),
      'pendente', now()
    FROM _marketplace_eligible w
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _enqueued FROM inserted;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'enqueued', _enqueued,
    'existing_enqueued', _existing_enqueued,
    'skipped', _skipped
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_bling_supplier_map(_company_id uuid, _bling_supplier_id text, _supplier_codigo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT app_private.is_company_member(_company_id, auth.uid()) THEN RAISE EXCEPTION 'not a member of company'; END IF;
  UPDATE public.bling_supplier_map SET supplier_codigo = NULLIF(btrim(_supplier_codigo), ''), updated_at = now()
  WHERE company_id = _company_id AND bling_supplier_id = _bling_supplier_id;
END $function$
;
CREATE OR REPLACE FUNCTION public.enqueue_supplier_links(_company_id uuid, _mode text, _product_ids uuid[] DEFAULT NULL::uuid[], _bling_supplier_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE _integ uuid; _n int := 0; _skipped int := 0; _no_cost int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT app_private.is_company_member(_company_id, auth.uid()) THEN RAISE EXCEPTION 'not a member of company'; END IF;
  SELECT id INTO _integ FROM public.bling_integrations WHERE company_id = _company_id LIMIT 1;
  IF _integ IS NULL THEN RAISE EXCEPTION 'Empresa sem integração Bling'; END IF;
  IF _mode = 'manual' AND COALESCE(_bling_supplier_id, '') = '' THEN RAISE EXCEPTION 'Fornecedor não informado'; END IF;

  CREATE TEMP TABLE _cand ON COMMIT DROP AS
  WITH base AS (
    SELECT p.id, p.bling_product_id, p.preco_custo,
           NULLIF(btrim(substring(btrim(coalesce(p.codigo,'')) from '^[A-Za-z]+(.*)$')), '') AS cod_forn,
           CASE WHEN _mode = 'manual' THEN _bling_supplier_id
                ELSE (SELECT m.bling_supplier_id FROM public.bling_supplier_map m
                      WHERE m.company_id = _company_id AND m.supplier_codigo = public.map_sku_prefix(p.codigo)
                      ORDER BY m.bling_supplier_id LIMIT 1) END AS forn,
           CASE WHEN _mode = 'manual' THEN (SELECT m.supplier_codigo FROM public.bling_supplier_map m
                      WHERE m.company_id = _company_id AND m.bling_supplier_id = _bling_supplier_id)
                ELSE public.map_sku_prefix(p.codigo) END AS sup_cod
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
      AND NOT EXISTS (SELECT 1 FROM public.bling_product_suppliers s WHERE s.company_id = _company_id AND s.product_id = p.id)
  )
  SELECT b.*, COALESCE((
      SELECT COALESCE(NULLIF((fp.precos->>'PR')::numeric,0), NULLIF((fp.precos->>'base')::numeric,0),
                      NULLIF((fp.precos->>'dropshipping')::numeric,0), NULLIF((fp.precos->>'crossdocking')::numeric,0))
      FROM public.fornecedor_produtos fp JOIN public.fornecedores f ON f.id = fp.fornecedor_id
      WHERE f.codigo = b.sup_cod AND b.cod_forn IS NOT NULL AND ltrim(fp.codigo, '0') = ltrim(b.cod_forn, '0')
      LIMIT 1), NULLIF(b.preco_custo, 0)) AS custo
  FROM base b;

  SELECT count(*) FILTER (WHERE forn IS NULL OR COALESCE(bling_product_id, '') = ''),
         count(*) FILTER (WHERE forn IS NOT NULL AND COALESCE(bling_product_id, '') <> '' AND custo IS NULL)
    INTO _skipped, _no_cost FROM _cand;

  UPDATE public.bling_products bp SET preco_custo = c.custo, updated_at = now()
  FROM _cand c
  WHERE bp.id = c.id AND c.forn IS NOT NULL AND c.custo IS NOT NULL AND bp.preco_custo IS DISTINCT FROM c.custo;

  INSERT INTO public.bling_push_queue (company_id, integration_id, product_id, bling_product_id, tipo, valor_novo, payload)
  SELECT _company_id, _integ, c.id, c.bling_product_id, 'fornecedor_vinculo', c.custo,
         jsonb_build_object('bling_supplier_id', c.forn, 'codigo', COALESCE(c.cod_forn, ''), 'preco_custo', c.custo)
  FROM _cand c
  WHERE c.forn IS NOT NULL AND COALESCE(c.bling_product_id, '') <> '' AND c.custo IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('enqueued', _n, 'skipped', _skipped, 'no_cost', _no_cost);
END $function$
;
CREATE OR REPLACE FUNCTION public.anatel_code_for(_codigo text, _gtin text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _c text := btrim(coalesce(_codigo, ''));
  _g text := btrim(coalesce(_gtin, ''));
  _num text;
  _forn text;
  _r text;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF _c <> '' THEN
    SELECT btrim(codigo_anatel) INTO _r FROM anatel_products
     WHERE btrim(codigo) = _c AND codigo_anatel ~ '\d{5}' LIMIT 1;
    IF _r IS NOT NULL THEN RETURN _r; END IF;
  END IF;

  IF _g ~ '^\d{8,14}$' THEN
    SELECT btrim(codigo_anatel) INTO _r FROM anatel_products
     WHERE btrim(ean) = _g AND codigo_anatel ~ '\d{5}' LIMIT 1;
    IF _r IS NOT NULL THEN RETURN _r; END IF;
  END IF;

  IF _c ~ '^[A-Za-z]+\d+$' THEN
    _num := ltrim(regexp_replace(_c, '^[A-Za-z]+', ''), '0');
    _forn := map_sku_prefix(_c);
    IF _forn IS NOT NULL AND _num <> '' THEN
      SELECT btrim(a.codigo_anatel) INTO _r FROM anatel_products a
       WHERE ltrim(regexp_replace(btrim(a.codigo), '^[A-Za-z]+', ''), '0') = _num
         AND a.codigo_anatel ~ '\d{5}'
         AND map_sku_prefix(btrim(a.codigo)) = _forn
       LIMIT 1;
      IF _r IS NOT NULL THEN RETURN _r; END IF;
    END IF;
  END IF;

  RETURN 'isento';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.list_product_custom_fields(_company_id uuid, _search text DEFAULT NULL::text, _field_id uuid DEFAULT NULL::uuid, _field_mode text DEFAULT NULL::text, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _total int; _rows jsonb;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT app_private.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem acesso';
  END IF;
  WITH base AS (
    SELECT p.id, p.codigo, p.nome, p.situacao FROM bling_products p
    WHERE p.company_id = _company_id
      AND (_search IS NULL OR _search = '' OR p.codigo ILIKE '%'||_search||'%' OR p.nome ILIKE '%'||_search||'%')
      AND (_field_id IS NULL OR _field_mode IS NULL OR
        CASE _field_mode
          WHEN 'vazio' THEN NOT EXISTS (SELECT 1 FROM bling_product_custom_values v
            WHERE v.product_id = p.id AND v.custom_field_id = _field_id AND coalesce(btrim(v.valor),'') <> '')
          WHEN 'preenchido' THEN EXISTS (SELECT 1 FROM bling_product_custom_values v
            WHERE v.product_id = p.id AND v.custom_field_id = _field_id AND coalesce(btrim(v.valor),'') <> '')
          ELSE true END)
  )
  SELECT count(*) INTO _total FROM base;
  SELECT coalesce(jsonb_agg(r ORDER BY r->>'codigo'), '[]'::jsonb) INTO _rows FROM (
    SELECT jsonb_build_object('id', b.id, 'codigo', b.codigo, 'nome', b.nome, 'situacao', b.situacao,
      'valores', coalesce((SELECT jsonb_object_agg(v.custom_field_id, v.valor) FROM bling_product_custom_values v WHERE v.product_id = b.id), '{}'::jsonb)) r
    FROM (
      SELECT p.id, p.codigo, p.nome, p.situacao FROM bling_products p
      WHERE p.company_id = _company_id
        AND (_search IS NULL OR _search = '' OR p.codigo ILIKE '%'||_search||'%' OR p.nome ILIKE '%'||_search||'%')
        AND (_field_id IS NULL OR _field_mode IS NULL OR
          CASE _field_mode
            WHEN 'vazio' THEN NOT EXISTS (SELECT 1 FROM bling_product_custom_values v
              WHERE v.product_id = p.id AND v.custom_field_id = _field_id AND coalesce(btrim(v.valor),'') <> '')
            WHEN 'preenchido' THEN EXISTS (SELECT 1 FROM bling_product_custom_values v
              WHERE v.product_id = p.id AND v.custom_field_id = _field_id AND coalesce(btrim(v.valor),'') <> '')
            ELSE true END)
      ORDER BY p.codigo LIMIT _limit OFFSET _offset
    ) b
  ) s;
  RETURN jsonb_build_object('total', _total, 'rows', _rows);
END $function$
;
CREATE OR REPLACE FUNCTION public.anatel_official_suggestions(_company_id uuid, _limit integer DEFAULT 3000)
 RETURNS TABLE(product_id uuid, codigo text, nome text, marca text, gtin text, codigo_atual text, numero text, fabricante text, modelo text, nome_comercial text, tipo text, marca_confere boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM company_users cu WHERE cu.company_id = _company_id AND cu.user_id = auth.uid() AND cu.ativo)
     AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  RETURN QUERY
  WITH prods AS (
    SELECT p.id, p.codigo, COALESCE(sn.nome, p.nome) AS nome, p.marca, p.gtin,
      upper(regexp_replace(split_part(replace(btrim(coalesce(p.marca,'')),'-',''),' ',1), '[^A-Za-z0-9]', '', 'g')) AS bkey
    FROM bling_products p
    LEFT JOIN LATERAL public.supplier_product_names(ARRAY[p.codigo]) sn ON true
    WHERE p.company_id = _company_id AND coalesce(p.situacao,'Ativo') IN ('A','Ativo')
  ),
  toks AS (
    SELECT DISTINCT pr.id, upper(regexp_replace(t, '[^A-Za-z0-9]', '', 'g')) AS tok
    FROM prods pr, regexp_split_to_table(coalesce(pr.nome,''), '\s+') t
  ),
  hits AS (
    SELECT tk.id, h.numero, h.fabricante, h.modelo, h.nome_comercial, h.tipo, h.solicitante, h.data_homologacao, length(tk.tok) AS l,
      upper(regexp_replace(coalesce(h.fabricante,'') || coalesce(h.solicitante,'') || coalesce(h.nome_comercial,''), '[^A-Za-z0-9]', '', 'g')) AS fkey
    FROM toks tk
    JOIN anatel_homologacao_modelos m ON m.modelo_norm = tk.tok
    JOIN anatel_homologacoes h ON h.numero = m.numero
    WHERE length(tk.tok) >= 4 AND tk.tok ~ '[A-Z]' AND tk.tok ~ '[0-9]'
  ),
  ranked AS (
    SELECT pr.id, pr.codigo, pr.nome, pr.marca, pr.gtin, hi.numero, hi.fabricante, hi.modelo, hi.nome_comercial, hi.tipo,
      (length(pr.bkey) >= 2 AND hi.fkey LIKE '%' || pr.bkey || '%') AS marca_ok,
      row_number() OVER (PARTITION BY pr.id ORDER BY
         (length(pr.bkey) >= 2 AND hi.fkey LIKE '%' || pr.bkey || '%') DESC,
         hi.l DESC, hi.data_homologacao DESC NULLS LAST) AS rn
    FROM hits hi JOIN prods pr ON pr.id = hi.id
  )
  SELECT r.id, r.codigo, r.nome, r.marca, r.gtin,
    nullif(anatel_code_for(r.codigo, r.gtin), 'isento') AS codigo_atual,
    r.numero, r.fabricante, r.modelo, r.nome_comercial, r.tipo, r.marca_ok
  FROM ranked r
  WHERE r.rn = 1 AND r.marca_ok
  ORDER BY r.codigo
  LIMIT _limit;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.suggest_supplier_ncm(_company_id uuid, _product_ids uuid[])
 RETURNS TABLE(product_id uuid, sku text, nome text, ncm text, fornecedor_nome text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.company_users cu WHERE cu.company_id = _company_id AND cu.user_id = auth.uid() AND cu.ativo = true
  ) THEN RAISE EXCEPTION 'not a member of company'; END IF;
  RETURN QUERY
  SELECT p.id, p.codigo::text, coalesce(fp.titulo, fp.nome_nota)::text,
    regexp_replace(btrim(fp.ncm), '[^0-9]', '', 'g')::text, f.codigo::text
  FROM public.bling_products p
  JOIN public.fornecedores f ON f.codigo = public.map_sku_prefix(p.codigo)
  JOIN public.fornecedor_produtos fp ON fp.fornecedor_id = f.id
    AND ltrim(fp.codigo, '0') = ltrim(regexp_replace(btrim(p.codigo), '^[A-Za-z]+', ''), '0')
  WHERE p.company_id = _company_id AND p.id = ANY(_product_ids)
    AND nullif(btrim(p.ncm), '') IS NULL
    AND length(regexp_replace(btrim(fp.ncm), '[^0-9]', '', 'g')) = 8;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_strip_html(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE _updated int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH upd AS (
    UPDATE public.bling_products SET
      nome = regexp_replace(coalesce(nome,''), '<[^>]+>', '', 'g'),
      descricao_curta = regexp_replace(coalesce(descricao_curta,''), '<[^>]+>', '', 'g'),
      descricao_complementar = regexp_replace(coalesce(descricao_complementar,''), '<[^>]+>', '', 'g')
    WHERE company_id = _company_id
      AND (nome ~ '<[^>]+>' OR descricao_curta ~ '<[^>]+>' OR descricao_complementar ~ '<[^>]+>')
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM upd;
  RETURN jsonb_build_object('updated', _updated);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_fill_desc_complementar(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE _updated int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH upd AS (
    UPDATE public.bling_products SET descricao_complementar = nome
    WHERE company_id = _company_id
      AND btrim(coalesce(nome,'')) <> ''
      AND btrim(coalesce(descricao_complementar,'')) <> btrim(coalesce(nome,''))
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM upd;
  RETURN jsonb_build_object('updated', _updated);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_remove_garantia_anatel(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE _updated int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH cleaned AS (
    SELECT id,
      COALESCE(descricao_curta,'') AS original,
      btrim(
        regexp_replace(
          COALESCE(descricao_curta,''),
          '(\s*\n)*\s*Garantia:\s*3\s*meses\s*\|\s*Código\s+Anatel\s*:[^\n\r]*',
          '',
          'gi'
        )
      ) AS novo
    FROM public.bling_products
    WHERE company_id = _company_id
      AND descricao_curta ~* 'Garantia:\s*3\s*meses\s*\|\s*Código\s+Anatel\s*:'
  ),
  upd AS (
    UPDATE public.bling_products bp
       SET descricao_curta = c.novo
      FROM cleaned c
     WHERE bp.id = c.id
       AND COALESCE(bp.descricao_curta,'') <> c.novo
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM upd;

  RETURN jsonb_build_object('updated', _updated);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_strip_html(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE _updated int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH upd AS (
    UPDATE public.bling_products SET
      nome = regexp_replace(coalesce(nome,''), '<[^>]+>', '', 'g'),
      descricao_curta = regexp_replace(coalesce(descricao_curta,''), '<[^>]+>', '', 'g'),
      descricao_complementar = regexp_replace(coalesce(descricao_complementar,''), '<[^>]+>', '', 'g')
    WHERE company_id = _company_id
      AND (_product_ids IS NULL OR id = ANY(_product_ids))
      AND (nome ~ '<[^>]+>' OR descricao_curta ~ '<[^>]+>' OR descricao_complementar ~ '<[^>]+>')
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM upd;
  RETURN jsonb_build_object('updated', _updated);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_fill_desc_complementar(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE _updated int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH upd AS (
    UPDATE public.bling_products SET descricao_complementar = nome
    WHERE company_id = _company_id
      AND (_product_ids IS NULL OR id = ANY(_product_ids))
      AND btrim(coalesce(nome,'')) <> ''
      AND btrim(coalesce(descricao_complementar,'')) <> btrim(coalesce(nome,''))
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM upd;
  RETURN jsonb_build_object('updated', _updated);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_remove_garantia_anatel(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE _updated int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH upd AS (
    UPDATE public.bling_products SET
      descricao_curta = btrim(
        regexp_replace(
          COALESCE(descricao_curta,''),
          '(\r?\n)*\s*Garantia:\s*3\s*meses\s*\|\s*Código\s+Anatel\s*:[^\n\r]*',
          '',
          'gi'
        )
      )
    WHERE company_id = _company_id
      AND (_product_ids IS NULL OR id = ANY(_product_ids))
      AND descricao_curta ~* 'Garantia:\s*3\s*meses\s*\|\s*Código\s+Anatel\s*:'
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM upd;
  RETURN jsonb_build_object('updated', _updated);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_sync_supplier_stock_price(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  _total int := 0;
  _found int := 0;
  _not_found int := 0;
  _price_updated int := 0;
  _stock_updated int := 0;
  _both_updated int := 0;
  _unchanged int := 0;
  _no_supplier int := 0;
  _items jsonb;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  CREATE TEMP TABLE _work ON COMMIT DROP AS
  WITH prods AS (
    SELECT p.id, p.codigo AS sku, p.nome,
           p.preco_custo AS preco_atual,
           p.estoque AS estoque_atual,
           upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix,
           btrim(substring(p.codigo from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
  ),
  mapped AS (
    SELECT pr.*,
      public.map_supplier_prefix(prefix) AS sup_codigo
    FROM prods pr
  ),
  joined AS (
    SELECT m.*,
      s.id AS sup_id, s.nome AS sup_nome,
      fp.qt_estoque AS fp_estoque,
      COALESCE(
        NULLIF((fp.precos->>'PR')::numeric, 0),
        NULLIF((fp.precos->>'base')::numeric, 0),
        NULLIF((fp.precos->>'dropshipping')::numeric, 0),
        NULLIF((fp.precos->>'crossdocking')::numeric, 0)
      ) AS fp_preco
    FROM mapped m
    LEFT JOIN public.fornecedores s
      ON s.codigo = m.sup_codigo
    LEFT JOIN public.fornecedor_produtos fp
      ON fp.fornecedor_id = s.id AND btrim(fp.codigo) = m.num_code AND m.num_code <> ''
  )
  SELECT * FROM joined;

  SELECT count(*) INTO _total FROM _work;

  UPDATE public.bling_products bp SET
    preco_custo = CASE
      WHEN w.fp_preco IS NOT NULL AND (bp.preco_custo IS DISTINCT FROM w.fp_preco)
      THEN w.fp_preco ELSE bp.preco_custo END,
    estoque = CASE
      WHEN w.fp_estoque IS NOT NULL AND (bp.estoque IS DISTINCT FROM w.fp_estoque)
      THEN w.fp_estoque ELSE bp.estoque END,
    dirty = CASE
      WHEN (w.fp_preco IS NOT NULL AND bp.preco_custo IS DISTINCT FROM w.fp_preco)
        OR (w.fp_estoque IS NOT NULL AND bp.estoque IS DISTINCT FROM w.fp_estoque)
      THEN true ELSE bp.dirty END,
    updated_at = now()
  FROM _work w
  WHERE bp.id = w.id
    AND w.sup_id IS NOT NULL
    AND w.fp_estoque IS NOT NULL;

  SELECT
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL),
    count(*) FILTER (WHERE sup_codigo IS NOT NULL AND (sup_id IS NULL OR fp_estoque IS NULL)),
    count(*) FILTER (WHERE sup_codigo IS NULL),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco
        AND (estoque_atual IS NOT DISTINCT FROM fp_estoque)),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND estoque_atual IS DISTINCT FROM fp_estoque
        AND (fp_preco IS NULL OR preco_atual IS NOT DISTINCT FROM fp_preco)),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco
        AND estoque_atual IS DISTINCT FROM fp_estoque),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND (fp_preco IS NULL OR preco_atual IS NOT DISTINCT FROM fp_preco)
        AND estoque_atual IS NOT DISTINCT FROM fp_estoque)
  INTO _found, _not_found, _no_supplier, _price_updated, _stock_updated, _both_updated, _unchanged
  FROM _work;

  SELECT jsonb_agg(row_to_json(t)) INTO _items FROM (
    SELECT
      sku, nome, sup_codigo AS fornecedor,
      CASE
        WHEN sup_codigo IS NULL THEN 'sem_fornecedor'
        WHEN sup_id IS NULL OR fp_estoque IS NULL THEN 'nao_encontrado'
        WHEN (fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco)
          AND estoque_atual IS DISTINCT FROM fp_estoque THEN 'preco_e_estoque_atualizados'
        WHEN (fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco) THEN 'preco_atualizado'
        WHEN estoque_atual IS DISTINCT FROM fp_estoque THEN 'estoque_atualizado'
        ELSE 'inalterado'
      END AS status,
      preco_atual, fp_preco AS preco_novo,
      estoque_atual, fp_estoque AS estoque_novo
    FROM _work
    ORDER BY sku
  ) t;

  RETURN jsonb_build_object(
    'total', _total,
    'encontrados', _found,
    'nao_encontrados', _not_found,
    'sem_fornecedor', _no_supplier,
    'preco_atualizado', _price_updated,
    'estoque_atualizado', _stock_updated,
    'preco_e_estoque_atualizados', _both_updated,
    'inalterados', _unchanged,
    'items', COALESCE(_items, '[]'::jsonb)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.retry_bling_push_errors(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  WITH upd AS (
    UPDATE public.bling_push_queue SET
      status = 'pendente', tentativas = 0, proxima_tentativa_em = now(), erro = NULL
    WHERE company_id = _company_id AND status = 'erro'
    RETURNING 1
  ) SELECT count(*) INTO _n FROM upd;
  RETURN jsonb_build_object('reenfileirados', _n);
END; $function$
;
CREATE OR REPLACE FUNCTION public.get_bling_push_progress(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _res jsonb;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  SELECT jsonb_build_object(
    'total', count(*),
    'pendentes', count(*) FILTER (WHERE status IN ('pendente','processando')),
    'pausados', count(*) FILTER (WHERE status = 'pausado'),
    'concluidos', count(*) FILTER (WHERE status = 'concluido'),
    'erros', count(*) FILTER (WHERE status = 'erro'),
    'products_total', count(DISTINCT product_id),
    'products_done', count(DISTINCT product_id) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM public.bling_push_queue q2
        WHERE q2.company_id = _company_id
          AND q2.product_id = public.bling_push_queue.product_id
          AND q2.status IN ('pendente','processando','pausado')
      )
    ),
    'oldest_pending', min(created_at) FILTER (WHERE status IN ('pendente','processando')),
    'last_processed', max(updated_at) FILTER (WHERE status IN ('concluido','erro'))
  ) INTO _res FROM public.bling_push_queue WHERE company_id = _company_id;
  RETURN COALESCE(_res, '{}'::jsonb);
END; $function$
;
CREATE OR REPLACE FUNCTION public.finish_bling_push_error(_item_id uuid, _erro text, _status_code integer DEFAULT NULL::integer, _body_safe text DEFAULT NULL::text, _retry_in_seconds integer DEFAULT NULL::integer, _max_attempts integer DEFAULT 5)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _tent int; _pid uuid;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  SELECT tentativas, product_id INTO _tent, _pid
    FROM public.bling_push_queue WHERE id = _item_id;

  IF _retry_in_seconds IS NOT NULL AND _tent < _max_attempts THEN
    UPDATE public.bling_push_queue SET
      status = 'pendente',
      proxima_tentativa_em = now() + make_interval(secs => _retry_in_seconds),
      erro = _erro,
      last_response_status = _status_code,
      last_response_body_safe = _body_safe,
      updated_at = now()
    WHERE id = _item_id;
  ELSE
    UPDATE public.bling_push_queue SET
      status = 'erro',
      erro = _erro,
      last_response_status = _status_code,
      last_response_body_safe = _body_safe,
      processed_at = now(),
      updated_at = now()
    WHERE id = _item_id;
    IF _pid IS NOT NULL THEN
      UPDATE public.bling_products SET
        sincronizacao_status = 'erro',
        sincronizacao_erro = _erro
      WHERE id = _pid;
    END IF;
  END IF;
END; $function$
;
CREATE OR REPLACE FUNCTION public.set_bling_channel_intermediador(_integration_id uuid, _bling_store_id text, _cnpj text, _nome text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  UPDATE public.bling_stores SET
    intermediador_cnpj = COALESCE(_cnpj, intermediador_cnpj),
    intermediador_nome = COALESCE(_nome, intermediador_nome),
    updated_at = now()
   WHERE integration_id = _integration_id AND bling_store_id = _bling_store_id;

  UPDATE public.bling_product_stores SET
    intermediador_cnpj = COALESCE(_cnpj, intermediador_cnpj),
    intermediador_nome = COALESCE(_nome, intermediador_nome),
    updated_at = now()
   WHERE integration_id = _integration_id AND bling_store_id = _bling_store_id;
END; $function$
;
CREATE OR REPLACE FUNCTION public.set_bling_stores_job_total(_job_id uuid, _total integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 
  UPDATE public.bling_store_sync_jobs SET total_estimate = _total WHERE id = _job_id;

END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_bling_default_deposito(_company_id uuid, _integration_id uuid, _deposito_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  UPDATE public.bling_integrations
     SET default_deposito_id = _deposito_id, updated_at = now()
   WHERE id = _integration_id AND company_id = _company_id;
END; $function$
;
CREATE OR REPLACE FUNCTION public.upsert_bling_product_store(_company_id uuid, _integration_id uuid, _run_id uuid, _row jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _bling_product_id text := COALESCE(_row->>'bling_product_id','');
  _bling_store_id text := COALESCE(_row->>'bling_store_id','');
  _link_id text := COALESCE(_row->>'bling_product_store_id','');
  _internal uuid;
  _existed boolean;
  _result text;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF _bling_product_id = '' OR _bling_store_id = '' OR _link_id = '' THEN
    RETURN 'skipped';
  END IF;

  SELECT id INTO _internal FROM public.bling_products
   WHERE company_id = _company_id AND bling_product_id = _bling_product_id
   LIMIT 1;

  SELECT EXISTS(
    SELECT 1 FROM public.bling_product_stores
     WHERE integration_id = _integration_id AND bling_product_store_id = _link_id
  ) INTO _existed;

  INSERT INTO public.bling_product_stores AS b (
    company_id, integration_id, internal_product_id,
    bling_product_id, bling_store_id, bling_product_store_id,
    store_name, store_type, store_product_code,
    current_price, current_promotional_price,
    supplier_store_id, brand_store_id,
    categories_json, raw_data_json,
    is_linked, last_bling_update_at, last_imported_at, last_seen_run_id,
    sync_status, sync_error
  ) VALUES (
    _company_id, _integration_id, _internal,
    _bling_product_id, _bling_store_id, _link_id,
    NULLIF(_row->>'store_name',''), NULLIF(_row->>'store_type',''), NULLIF(_row->>'store_product_code',''),
    NULLIF(_row->>'current_price','')::numeric, NULLIF(_row->>'current_promotional_price','')::numeric,
    NULLIF(_row->>'supplier_store_id',''), NULLIF(_row->>'brand_store_id',''),
    _row->'categories_json', _row->'raw_data_json',
    true,
    NULLIF(_row->>'last_bling_update_at','')::timestamptz,
    now(), _run_id,
    CASE WHEN _internal IS NULL THEN 'produto_nao_encontrado' ELSE 'ok' END,
    NULL
  )
  ON CONFLICT (integration_id, bling_product_store_id) DO UPDATE SET
    company_id = EXCLUDED.company_id,
    internal_product_id = EXCLUDED.internal_product_id,
    bling_product_id = EXCLUDED.bling_product_id,
    bling_store_id = EXCLUDED.bling_store_id,
    store_name = COALESCE(EXCLUDED.store_name, b.store_name),
    store_type = COALESCE(EXCLUDED.store_type, b.store_type),
    store_product_code = EXCLUDED.store_product_code,
    current_price = EXCLUDED.current_price,
    current_promotional_price = EXCLUDED.current_promotional_price,
    supplier_store_id = EXCLUDED.supplier_store_id,
    brand_store_id = EXCLUDED.brand_store_id,
    categories_json = EXCLUDED.categories_json,
    raw_data_json = EXCLUDED.raw_data_json,
    is_linked = true,
    last_bling_update_at = EXCLUDED.last_bling_update_at,
    last_imported_at = now(),
    last_seen_run_id = _run_id,
    sync_status = EXCLUDED.sync_status,
    sync_error = NULL;

  IF _existed THEN _result := 'updated'; ELSE _result := 'inserted'; END IF;
  RETURN _result;
END; $function$
;
CREATE OR REPLACE FUNCTION public.claim_bling_stores_job(_job_id uuid)
 RETURNS TABLE(id uuid, integration_id uuid, company_id uuid, scope text, bling_product_id text, proxima_pagina integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _integ uuid; _cancel boolean; _status text;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  SELECT j.integration_id, j.cancel_requested, j.status
    INTO _integ, _cancel, _status
    FROM public.bling_store_sync_jobs j WHERE j.id = _job_id;
  IF _integ IS NULL THEN RETURN; END IF;

  -- If cancellation was requested, immediately mark cancelled and return nothing.
  IF _cancel OR _status = 'cancelando' THEN
    UPDATE public.bling_store_sync_jobs
       SET status = 'cancelada', finished_at = COALESCE(finished_at, now()),
           last_error = COALESCE(last_error, 'Cancelado.')
     WHERE id = _job_id AND status IN ('pendente','processando','cancelando');
    RETURN;
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtextextended(_integ::text, 77)) THEN
    RETURN;
  END IF;
  UPDATE public.bling_store_sync_jobs j
     SET status = 'processando', claimed_at = now(),
         started_at = COALESCE(j.started_at, now())
   WHERE j.id = _job_id AND j.status IN ('pendente','processando');
  RETURN QUERY
    SELECT j.id, j.integration_id, j.company_id, j.scope, j.bling_product_id, j.proxima_pagina
      FROM public.bling_store_sync_jobs j WHERE j.id = _job_id;
END; $function$
;
CREATE OR REPLACE FUNCTION public.upsert_bling_channel(_company_id uuid, _integration_id uuid, _row jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sid text := COALESCE(_row->>'bling_store_id','');
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF _sid = '' THEN RETURN 'skipped'; END IF;
  INSERT INTO public.bling_stores AS s (
    company_id, integration_id, bling_store_id, descricao, tipo, agrupador, situacao,
    cnpj_filial, unidade_negocio, intermediador_cnpj, intermediador_nome,
    raw_json, last_imported_at
  ) VALUES (
    _company_id, _integration_id, _sid,
    NULLIF(_row->>'descricao',''), NULLIF(_row->>'tipo',''),
    NULLIF(_row->>'agrupador','')::int, NULLIF(_row->>'situacao','')::int,
    NULLIF(_row->>'cnpj_filial',''), NULLIF(_row->>'unidade_negocio',''),
    NULLIF(_row->>'intermediador_cnpj',''), NULLIF(_row->>'intermediador_nome',''),
    _row->'raw_json', now()
  )
  ON CONFLICT (integration_id, bling_store_id) DO UPDATE SET
    descricao = COALESCE(EXCLUDED.descricao, s.descricao),
    tipo = COALESCE(EXCLUDED.tipo, s.tipo),
    agrupador = COALESCE(EXCLUDED.agrupador, s.agrupador),
    situacao = COALESCE(EXCLUDED.situacao, s.situacao),
    cnpj_filial = COALESCE(EXCLUDED.cnpj_filial, s.cnpj_filial),
    unidade_negocio = COALESCE(EXCLUDED.unidade_negocio, s.unidade_negocio),
    intermediador_cnpj = COALESCE(EXCLUDED.intermediador_cnpj, s.intermediador_cnpj),
    intermediador_nome = COALESCE(EXCLUDED.intermediador_nome, s.intermediador_nome),
    raw_json = COALESCE(EXCLUDED.raw_json, s.raw_json),
    last_imported_at = now();

  -- Backfill existing product-store links
  UPDATE public.bling_product_stores ps SET
    store_name = COALESCE(NULLIF(_row->>'descricao',''), ps.store_name),
    store_type = COALESCE(NULLIF(_row->>'tipo',''), ps.store_type),
    intermediador_cnpj = COALESCE(NULLIF(_row->>'intermediador_cnpj',''), ps.intermediador_cnpj),
    intermediador_nome = COALESCE(NULLIF(_row->>'intermediador_nome',''), ps.intermediador_nome),
    updated_at = now()
  WHERE ps.integration_id = _integration_id AND ps.bling_store_id = _sid;

  RETURN 'ok';
END; $function$
;
CREATE OR REPLACE FUNCTION public.finish_bling_stores_page(_job_id uuid, _page integer, _total_pages integer, _found integer, _inserted integer, _updated integer, _matched integer, _unmatched integer, _errors integer, _next_page integer, _last_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.bling_store_sync_jobs
     WHERE id = _job_id AND (cancel_requested = true OR status = 'cancelada')
  ) THEN
    RETURN;
  END IF;

  UPDATE public.bling_store_sync_jobs SET
    paginas_processadas = paginas_processadas + 1,
    proxima_pagina = COALESCE(_next_page, proxima_pagina),
    total_paginas = COALESCE(_total_pages, total_paginas),
    vinculos_encontrados = vinculos_encontrados + COALESCE(_found,0),
    vinculos_salvos = vinculos_salvos + COALESCE(_inserted,0),
    vinculos_atualizados = vinculos_atualizados + COALESCE(_updated,0),
    produtos_relacionados = produtos_relacionados + COALESCE(_matched,0),
    produtos_nao_encontrados = produtos_nao_encontrados + COALESCE(_unmatched,0),
    erros = erros + COALESCE(_errors,0),
    last_error = COALESCE(_last_error, last_error)
   WHERE id = _job_id;
END; $function$
;
CREATE OR REPLACE FUNCTION public.finish_bling_stores_job(_job_id uuid, _status text, _last_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _job public.bling_store_sync_jobs%ROWTYPE;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  SELECT * INTO _job FROM public.bling_store_sync_jobs WHERE id = _job_id;
  IF _job.id IS NULL THEN RETURN; END IF;

  IF (_job.cancel_requested OR _job.status = 'cancelada') AND _status <> 'cancelada' THEN
    RETURN;
  END IF;

  UPDATE public.bling_store_sync_jobs
     SET status = _status, finished_at = now(),
         last_error = COALESCE(_last_error, last_error)
   WHERE id = _job_id;

  IF _status = 'concluida' AND _job.scope = 'full' THEN
    UPDATE public.bling_product_stores
       SET is_linked = false, updated_at = now()
     WHERE integration_id = _job.integration_id
       AND (last_seen_run_id IS NULL OR last_seen_run_id <> _job_id)
       AND is_linked = true;
  END IF;
END; $function$
;
CREATE OR REPLACE FUNCTION public.enqueue_bling_delete(_company_id uuid, _product_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _integration_id uuid;
  _created int := 0;
  _updated int := 0;
  _skipped_sem_bling int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  IF _product_ids IS NULL OR array_length(_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecione ao menos um produto para excluir.';
  END IF;

  SELECT id INTO _integration_id
  FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada'
  LIMIT 1;
  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada para esta empresa.';
  END IF;

  CREATE TEMP TABLE _pending_del ON COMMIT DROP AS
  SELECT p.id AS product_id, p.bling_product_id
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND p.id = ANY(_product_ids);

  SELECT count(*) INTO _skipped_sem_bling
    FROM _pending_del WHERE bling_product_id IS NULL OR btrim(bling_product_id) = '';
  DELETE FROM _pending_del WHERE bling_product_id IS NULL OR btrim(bling_product_id) = '';

  UPDATE public.bling_push_queue
     SET status = 'cancelado', updated_at = now()
   WHERE integration_id = _integration_id
     AND product_id IN (SELECT product_id FROM _pending_del)
     AND tipo IN ('preco','estoque','produto','criar')
     AND status IN ('pendente','processando');

  WITH ins AS (
    INSERT INTO public.bling_push_queue AS q
      (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
       tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
    SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, NULL,
           'excluir', NULL, 0, 'pendente', now()
    FROM _pending_del p
    ON CONFLICT (integration_id, product_id, tipo)
      WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
      DO UPDATE SET
        proxima_tentativa_em = now(),
        tentativas = 0, erro = NULL, status = 'pendente'
    RETURNING xmax = 0 AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
    INTO _created, _updated FROM ins;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'created', _created,
    'updated_existing', _updated,
    'skipped_sem_bling_id', _skipped_sem_bling
  );
END; $function$
;
CREATE OR REPLACE FUNCTION public.delete_company(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  _is_member boolean;
  _deleted_products int := 0;
  _deleted_audit_results int := 0;
  _deleted_push int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) INTO _is_member;
  IF NOT _is_member THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  DELETE FROM public.audit_results WHERE company_id = _company_id;
  GET DIAGNOSTICS _deleted_audit_results = ROW_COUNT;
  DELETE FROM public.bling_push_queue WHERE company_id = _company_id;
  GET DIAGNOSTICS _deleted_push = ROW_COUNT;
  DELETE FROM public.bling_product_stores WHERE company_id = _company_id;
  DELETE FROM public.bling_sync_job_errors WHERE company_id = _company_id;
  DELETE FROM public.bling_sync_jobs WHERE company_id = _company_id;
  DELETE FROM public.bling_store_sync_jobs WHERE company_id = _company_id;
  DELETE FROM public.bling_stores WHERE company_id = _company_id;
  DELETE FROM public.product_sheet_rows WHERE company_id = _company_id;
  DELETE FROM public.import_batches WHERE company_id = _company_id;
  DELETE FROM public.audit_runs WHERE company_id = _company_id;
  DELETE FROM public.bling_products WHERE company_id = _company_id;
  GET DIAGNOSTICS _deleted_products = ROW_COUNT;
  DELETE FROM public.bling_integrations WHERE company_id = _company_id;
  DELETE FROM public.bling_oauth_states WHERE company_id = _company_id;
  DELETE FROM public.company_users WHERE company_id = _company_id;
  DELETE FROM public.companies WHERE id = _company_id;

  RETURN jsonb_build_object(
    'ok', true,
    'produtos_removidos', _deleted_products,
    'audit_results_removidos', _deleted_audit_results,
    'push_queue_removidos', _deleted_push
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_bling_store_marketplace(_company_id uuid, _bling_store_id text, _marketplace_id uuid, _is_default boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.';
  END IF;

  IF _is_default THEN
    UPDATE public.bling_stores
       SET is_default = false, updated_at = now()
     WHERE company_id = _company_id AND is_default = true AND bling_store_id <> _bling_store_id;
  END IF;

  UPDATE public.bling_stores
     SET marketplace_id = _marketplace_id,
         is_default = COALESCE(_is_default, false),
         updated_at = now()
   WHERE company_id = _company_id AND bling_store_id = _bling_store_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_fill_ean_from_supplier(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated int := 0;
  v_candidates int := 0;
  v_not_found int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  WITH candidates AS (
    SELECT p.id, p.codigo,
      CASE
        WHEN p.codigo ~* '^ODS' THEN 'oderco'
        WHEN p.codigo ~* '^HX' THEN 'hayamax'
        WHEN p.codigo ~* '^HA' THEN 'hayamax'
        WHEN p.codigo ~* '^EV' THEN 'evolusom'
        WHEN p.codigo ~* '^O'  THEN 'oderco'
        WHEN p.codigo ~* '^E'  THEN 'evolusom'
        ELSE NULL
      END AS sup_codigo,
      btrim(regexp_replace(p.codigo, '^[A-Za-z]+', '')) AS numeric_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
      AND (p.gtin IS NULL OR btrim(p.gtin) = '')
      AND p.codigo IS NOT NULL AND btrim(p.codigo) <> ''
  ),
  matched AS (
    SELECT DISTINCT ON (c.id) c.id, fp.codigobarras
    FROM candidates c
    JOIN public.fornecedores f ON f.codigo = c.sup_codigo
    JOIN public.fornecedor_produtos fp
      ON fp.fornecedor_id = f.id AND fp.codigo = c.numeric_code
    WHERE c.sup_codigo IS NOT NULL
      AND c.numeric_code <> ''
      AND fp.codigobarras IS NOT NULL
      AND btrim(fp.codigobarras) <> ''
    ORDER BY c.id, fp.updated_at DESC NULLS LAST
  ),
  upd AS (
    UPDATE public.bling_products p
      SET gtin = m.codigobarras,
          dirty = true,
          updated_at = now()
    FROM matched m
    WHERE p.id = m.id
    RETURNING p.id
  )
  SELECT COUNT(*) INTO v_updated FROM upd;

  SELECT COUNT(*) INTO v_candidates
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
    AND (p.gtin IS NULL OR btrim(p.gtin) = '');

  v_not_found := GREATEST(v_candidates - v_updated, 0);

  RETURN jsonb_build_object(
    'updated', v_updated,
    'candidates', v_candidates,
    'not_found', v_not_found
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_set_crossdocking(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[], _dias integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  _updated int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH upd AS (
    UPDATE public.bling_products bp SET
      cross_docking = _dias::text,
      dirty = true,
      updated_at = now()
    WHERE bp.company_id = _company_id
      AND (_product_ids IS NULL OR bp.id = ANY(_product_ids))
      AND COALESCE(NULLIF(substring(btrim(coalesce(bp.cross_docking, '')) from '^[0-9]+'), '')::int, 0) < _dias
    RETURNING 1
  )
  SELECT count(*)::int INTO _updated FROM upd;

  RETURN jsonb_build_object('updated', _updated);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.finish_bling_push_created(_item_id uuid, _bling_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _pid uuid;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  UPDATE public.bling_push_queue
     SET status = 'concluido', erro = NULL, processed_at = now(), updated_at = now(),
         bling_product_id = _bling_id
   WHERE id = _item_id
   RETURNING product_id INTO _pid;

  IF _pid IS NULL THEN RETURN; END IF;

  UPDATE public.bling_products SET
    bling_product_id = _bling_id,
    sincronizado_em = now(),
    sincronizacao_status = 'ok',
    sincronizacao_erro = NULL
  WHERE id = _pid;
END; $function$
;
CREATE OR REPLACE FUNCTION public.transform_trim_images(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[], _max integer DEFAULT 18)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated int := 0;
  v_removed_total bigint := 0;
  r record;
  arr text[];
  kept text[];
  new_val text;
  removed int;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF _max IS NULL OR _max < 1 THEN
    _max := 18;
  END IF;

  FOR r IN
    SELECT id, url_imagens_externas
    FROM public.bling_products
    WHERE company_id = _company_id
      AND (_product_ids IS NULL OR id = ANY(_product_ids))
      AND url_imagens_externas IS NOT NULL
      AND url_imagens_externas <> ''
  LOOP
    -- Split por pipe ou quebra de linha, aparar espaços, remover vazios
    arr := ARRAY(
      SELECT btrim(u)
      FROM regexp_split_to_table(r.url_imagens_externas, E'[|\n\r]+') AS u
      WHERE btrim(u) <> ''
    );
    IF array_length(arr, 1) IS NULL OR array_length(arr, 1) <= _max THEN
      CONTINUE;
    END IF;
    kept := arr[1:_max];
    removed := array_length(arr, 1) - _max;
    new_val := array_to_string(kept, '|');
    UPDATE public.bling_products
    SET url_imagens_externas = new_val,
        updated_at = now()
    WHERE id = r.id;
    v_updated := v_updated + 1;
    v_removed_total := v_removed_total + removed;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'removed', v_removed_total, 'max', _max);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.pause_bling_push(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  UPDATE public.bling_push_queue
     SET status = 'pausado', updated_at = now()
   WHERE company_id = _company_id AND status = 'pendente';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('pausados', _n);
END; $function$
;
CREATE OR REPLACE FUNCTION public.resume_bling_push(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  UPDATE public.bling_push_queue
     SET status = 'pendente', proxima_tentativa_em = now(), updated_at = now()
   WHERE company_id = _company_id AND status = 'pausado';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('retomados', _n);
END; $function$
;
CREATE OR REPLACE FUNCTION public.cancel_bling_push(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  DELETE FROM public.bling_push_queue
   WHERE company_id = _company_id AND status IN ('pendente','pausado');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('cancelados', _n);
END; $function$
;
CREATE OR REPLACE FUNCTION public.delete_bling_push_errors(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  DELETE FROM public.bling_push_queue
   WHERE company_id = _company_id AND status = 'erro';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('excluidos', _n);
END; $function$
;
CREATE OR REPLACE FUNCTION public.clear_bling_push_queue(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _deleted int;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  WITH d AS (DELETE FROM public.bling_push_queue WHERE company_id = _company_id RETURNING 1)
  SELECT count(*) INTO _deleted FROM d;
  RETURN jsonb_build_object('excluidos', _deleted);
END; $function$
;
CREATE OR REPLACE FUNCTION public.transform_zero_stock(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  UPDATE public.bling_products p
  SET estoque = 0, updated_at = now()
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
    AND (p.estoque IS DISTINCT FROM 0 OR TRUE);
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_updated);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.low_margin_products(_company_id uuid, _threshold numeric DEFAULT 20, _limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p pricing_settings%ROWTYPE;
  _default_comissao numeric;
  _count int := 0;
  _items jsonb;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT * INTO _p FROM public.pricing_settings WHERE company_id = _company_id;

  SELECT m.taxa_percent INTO _default_comissao
  FROM public.bling_stores bs
  JOIN public.marketplaces m ON m.id = bs.marketplace_id
  WHERE bs.company_id = _company_id AND bs.is_default = true
  LIMIT 1;

  IF _default_comissao IS NULL AND _p.default_marketplace_id IS NOT NULL THEN
    SELECT taxa_percent INTO _default_comissao FROM public.marketplaces WHERE id = _p.default_marketplace_id;
  END IF;

  WITH prods AS (
    SELECT p.id, p.codigo AS sku, p.nome, p.preco, p.preco_custo,
           upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND p.preco_custo IS NOT NULL AND p.preco_custo > 0
  ),
  mapped AS (
    SELECT pr.*, public.map_supplier_prefix(prefix) AS sup_codigo
    FROM prods pr
  ),
  joined AS (
    SELECT m.*, s.preco_embalagem AS sup_emb, s.preco_transporte AS sup_transp,
           s.taxa_devolucao AS sup_devol, s.taxa_promocao AS sup_promo,
           ov.embalagem AS ov_emb, ov.transporte AS ov_transp, ov.taxa_operacional AS ov_taxa_op
    FROM mapped m
    LEFT JOIN public.fornecedores s ON s.codigo = m.sup_codigo
    LEFT JOIN public.product_cost_overrides ov ON ov.product_id = m.id AND ov.company_id = _company_id
  ),
  calc AS (
    SELECT j.*,
      (
        j.preco_custo
        + COALESCE(j.ov_emb, j.sup_emb, COALESCE(_p.embalagem_default, 0))
        + COALESCE(j.ov_transp, j.sup_transp, COALESCE(_p.transporte_default, 0))
        + CASE
            WHEN COALESCE(j.ov_taxa_op, _p.taxa_operacional_valor, 0) > 0
             AND j.preco_custo >= COALESCE(_p.taxa_operacional_min_custo, 0)
            THEN COALESCE(j.ov_taxa_op, _p.taxa_operacional_valor, 0) ELSE 0 END
      ) AS cmv_base
    FROM joined j
  ),
  calc2 AS (
    SELECT c.*, (c.cmv_base * (1 + COALESCE(_p.frete_medio_percent, 0)/100)) AS cmv_total FROM calc c
  ),
  calc3 AS (
    SELECT c.*,
      (c.cmv_total
       + c.cmv_total * COALESCE(_p.custo_fixo_percent, 0)/100
       + c.cmv_total * COALESCE(_p.devolucao_percent, 0)/100) AS custo_completo
    FROM calc2 c
  ),
  -- uma linha por produto x loja vinculada
  per_store AS (
    SELECT c.id, c.sku, c.nome, c.custo_completo, c.sup_devol, c.sup_promo,
           bps.bling_store_id AS loja_id,
           COALESCE(bs2.nome_loja, bps.store_name, 'Loja ' || bps.bling_store_id) AS loja_nome,
           mk.nome AS marketplace_nome,
           COALESCE(bps.current_promotional_price, bps.current_price, c.preco) AS preco,
           COALESCE(mk.taxa_percent, _default_comissao, 0) AS comissao
    FROM calc3 c
    JOIN public.bling_product_stores bps
      ON bps.internal_product_id = c.id AND bps.company_id = _company_id
     AND COALESCE(bps.is_linked, true) = true
    LEFT JOIN public.bling_stores bs2
      ON bs2.bling_store_id = bps.bling_store_id AND bs2.company_id = _company_id
    LEFT JOIN public.marketplaces mk ON mk.id = bs2.marketplace_id
  ),
  no_store AS (
    SELECT c.id, c.sku, c.nome, c.custo_completo, c.sup_devol, c.sup_promo,
           NULL::text AS loja_id, NULL::text AS loja_nome, NULL::text AS marketplace_nome,
           c.preco, COALESCE(_default_comissao, 0) AS comissao
    FROM calc3 c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bling_product_stores bps
      WHERE bps.internal_product_id = c.id AND bps.company_id = _company_id
        AND COALESCE(bps.is_linked, true) = true
    )
  ),
  rows_all AS (
    SELECT * FROM per_store UNION ALL SELECT * FROM no_store
  ),
  fin AS (
    SELECT r.id, r.sku, r.nome, r.loja_id, r.loja_nome, r.marketplace_nome,
           r.preco, r.custo_completo, r.comissao,
      round(((
        r.preco
        - r.custo_completo
        - r.preco * (r.comissao + COALESCE(r.sup_devol,0) + COALESCE(r.sup_promo,0))/100
      ) / NULLIF(r.preco,0) * 100)::numeric, 2) AS margem_percent
    FROM rows_all r
    WHERE r.preco IS NOT NULL AND r.preco > 0
  ),
  low AS (
    SELECT * FROM fin WHERE margem_percent < _threshold
  )
  SELECT (SELECT count(*) FROM low),
         COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.margem_percent ASC)
                     FROM (SELECT * FROM low ORDER BY margem_percent ASC LIMIT _limit) x), '[]'::jsonb)
  INTO _count, _items;

  RETURN jsonb_build_object('count', _count, 'threshold', _threshold, 'items', _items);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.dashboard_stats(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result JSONB;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT app_private.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.';
  END IF;

  WITH prods AS (
    SELECT last_audit_errors, last_audit_warnings, last_audit_at, categoria_produto
    FROM public.bling_products WHERE company_id = _company_id
  ),
  agg AS (
    SELECT
      count(*) AS total_products,
      count(*) FILTER (WHERE last_audit_errors > 0) AS com_erro,
      count(*) FILTER (WHERE last_audit_errors = 0 AND last_audit_warnings > 0) AS com_aviso,
      count(*) FILTER (WHERE last_audit_errors = 0 AND last_audit_warnings = 0 AND last_audit_at IS NOT NULL) AS sem_erro,
      count(*) FILTER (WHERE last_audit_at IS NOT NULL) AS auditados
    FROM prods
  ),
  cats AS (
    SELECT COALESCE(NULLIF(TRIM(categoria_produto), ''), '(sem categoria)') AS name, count(*) AS value
    FROM prods GROUP BY 1 ORDER BY count(*) DESC LIMIT 10
  ),
  rules AS (
    SELECT count(*) AS n FROM public.validation_rules
    WHERE company_id IS NULL OR company_id = _company_id
  ),
  runs AS (
    SELECT count(*) AS n FROM public.audit_runs WHERE company_id = _company_id
  )
  SELECT jsonb_build_object(
    'totalProducts', agg.total_products,
    'totalRules', rules.n,
    'totalRuns', runs.n,
    'comErro', agg.com_erro,
    'comAviso', agg.com_aviso,
    'semErro', agg.sem_erro,
    'naoAuditados', GREATEST(0, agg.total_products - agg.auditados),
    'categorias', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'value', value)) FROM cats), '[]'::jsonb)
  ) INTO result
  FROM agg, rules, runs;

  RETURN result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.automation_run_report(_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 RETURN (SELECT jsonb_build_object(
    'resumo', COALESCE((
      SELECT jsonb_object_agg(tipo, qtd) FROM (
        SELECT c.tipo, count(*) AS qtd
        FROM public.automation_changes c
        JOIN public.automation_runs r ON r.id = c.run_id
        WHERE c.run_id = _run_id
          AND EXISTS (SELECT 1 FROM public.company_users cu
                      WHERE cu.company_id = r.company_id AND cu.user_id = auth.uid() AND cu.ativo = true)
        GROUP BY c.tipo
      ) s
    ), '{}'::jsonb),
    'total', COALESCE((
      SELECT count(*) FROM public.automation_changes c
      JOIN public.automation_runs r ON r.id = c.run_id
      WHERE c.run_id = _run_id
        AND EXISTS (SELECT 1 FROM public.company_users cu
                    WHERE cu.company_id = r.company_id AND cu.user_id = auth.uid() AND cu.ativo = true)
    ), 0)
  ));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.apply_import_batch(_batch_id uuid, _company_id uuid, _default_new text, _default_existing text, _overrides jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  _imported int := 0;
  _updated int := 0;
  _ignored int := 0;
  _dups int := 0;
  _total int;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  UPDATE product_sheet_rows
     SET action = _default_new
   WHERE batch_id = _batch_id AND match_type = 'none' AND applied_at IS NULL;

  UPDATE product_sheet_rows
     SET action = _default_existing
   WHERE batch_id = _batch_id AND match_type <> 'none' AND applied_at IS NULL;

  IF _overrides IS NOT NULL AND jsonb_array_length(_overrides) > 0 THEN
    UPDATE product_sheet_rows r
       SET action = (o->>'action')
      FROM jsonb_array_elements(_overrides) o
     WHERE r.id = (o->>'id')::uuid
       AND r.batch_id = _batch_id
       AND r.applied_at IS NULL;
  END IF;

  -- Deduplicate: keep only the LAST row per codigo (new) / per matched product (existing)
  WITH dupnew AS (
    SELECT id FROM (
      SELECT r.id,
             row_number() OVER (
               PARTITION BY lower(btrim(r.parsed->>'codigo'))
               ORDER BY r.row_number DESC, r.id DESC
             ) AS rn
        FROM product_sheet_rows r
       WHERE r.batch_id = _batch_id
         AND r.applied_at IS NULL
         AND r.action = 'import'
         AND r.match_type = 'none'
         AND COALESCE(NULLIF(btrim(r.parsed->>'codigo'), ''), '') <> ''
    ) t WHERE rn > 1
  ), dupex AS (
    SELECT id FROM (
      SELECT r.id,
             row_number() OVER (
               PARTITION BY r.match_product_id
               ORDER BY r.row_number DESC, r.id DESC
             ) AS rn
        FROM product_sheet_rows r
       WHERE r.batch_id = _batch_id
         AND r.applied_at IS NULL
         AND r.match_product_id IS NOT NULL
         AND r.action IN ('update_all', 'update_changed')
    ) t WHERE rn > 1
  ), marked AS (
    UPDATE product_sheet_rows r
       SET applied_at = now(),
           action = 'ignore',
           error = COALESCE(r.error, 'Linha duplicada na planilha (mesmo codigo). Apenas a ultima linha foi aplicada.')
     WHERE r.id IN (SELECT id FROM dupnew UNION SELECT id FROM dupex)
    RETURNING 1
  )
  SELECT count(*) INTO _dups FROM marked;

  SELECT count(*) INTO _total FROM product_sheet_rows WHERE batch_id = _batch_id;

  UPDATE import_batches
     SET status = 'aplicando',
         apply_total = _total,
         apply_processed = (
           SELECT count(*) FROM product_sheet_rows
            WHERE batch_id = _batch_id AND applied_at IS NOT NULL
         ),
         new_count = 0,
         updated_count = 0,
         ignored_count = 0
   WHERE id = _batch_id;

  WITH ig AS (
    UPDATE product_sheet_rows
       SET applied_at = now()
     WHERE batch_id = _batch_id AND applied_at IS NULL AND action = 'ignore'
    RETURNING 1
  )
  SELECT count(*) INTO _ignored FROM ig;

  WITH src AS (
    SELECT DISTINCT ON (lower(btrim(r.parsed->>'codigo')))
           r.id AS rid,
           (jsonb_populate_record(
              NULL::bling_products,
              r.parsed
                || jsonb_build_object('company_id', _company_id::text, 'source', 'planilha')
           )).*
      FROM product_sheet_rows r
     WHERE r.batch_id = _batch_id
       AND r.applied_at IS NULL
       AND r.action = 'import'
       AND r.match_type = 'none'
       AND COALESCE(NULLIF(btrim(r.parsed->>'codigo'), ''), '') <> ''
     ORDER BY lower(btrim(r.parsed->>'codigo')), r.row_number DESC, r.id DESC
  ),
  ins AS (
    INSERT INTO bling_products (
      company_id, bling_product_id, codigo, nome, descricao_complementar, descricao_curta, observacoes,
      unidade, unidade_medida, ncm, origem_fiscal, situacao, gtin, gtin_embalagem, marca, categoria_produto,
      fornecedor, cod_fornecedor, localizacao, grupo_produtos, grupo_tags, tipo_item, tipo_producao,
      produto_variacao, codigo_pai, codigo_integracao, departamento, condicao_produto, frete_gratis,
      cross_docking, clonar_dados_pai, meses_garantia_fornecedor, numero_fci, cest, classe_ipi,
      codigo_lista_servicos, tributos, descricao_fornecedor, informacoes_adicionais, url_imagens_externas,
      link_externo, video, preco, preco_custo, preco_compra, valor_ipi_fixo, icms_st_base, icms_st_retencao,
      icms_proprio_substituto, estoque, estoque_minimo, estoque_maximo, itens_caixa, volumes,
      peso_liquido, peso_bruto, largura, altura, profundidade, data_validade, source, last_imported_at
    )
    SELECT company_id, bling_product_id, codigo, nome, descricao_complementar, descricao_curta, observacoes,
      unidade, unidade_medida, ncm, origem_fiscal, situacao, gtin, gtin_embalagem, marca, categoria_produto,
      fornecedor, cod_fornecedor, localizacao, grupo_produtos, grupo_tags, tipo_item, tipo_producao,
      produto_variacao, codigo_pai, codigo_integracao, departamento, condicao_produto, frete_gratis,
      cross_docking, clonar_dados_pai, meses_garantia_fornecedor, numero_fci, cest, classe_ipi,
      codigo_lista_servicos, tributos, descricao_fornecedor, informacoes_adicionais, url_imagens_externas,
      link_externo, video, preco, preco_custo, preco_compra, valor_ipi_fixo, icms_st_base, icms_st_retencao,
      icms_proprio_substituto, estoque, estoque_minimo, estoque_maximo, itens_caixa, volumes,
      peso_liquido, peso_bruto, largura, altura, profundidade, data_validade, 'planilha', now()
    FROM src
    ON CONFLICT (company_id, codigo) DO UPDATE SET
      last_imported_at = EXCLUDED.last_imported_at
    RETURNING 1
  )
  SELECT count(*) INTO _imported FROM ins;

  UPDATE product_sheet_rows
     SET applied_at = now()
   WHERE batch_id = _batch_id
     AND applied_at IS NULL
     AND action = 'import'
     AND match_type = 'none';

  WITH src AS (
    SELECT DISTINCT ON (r.match_product_id)
           r.id AS rid,
           r.match_product_id AS pid,
           r.action AS act,
           jsonb_populate_record(NULL::bling_products, r.parsed) AS rec
      FROM product_sheet_rows r
     WHERE r.batch_id = _batch_id
       AND r.applied_at IS NULL
       AND r.match_product_id IS NOT NULL
       AND (
         r.action = 'update_all'
         OR (r.action = 'update_changed' AND r.diff IS NOT NULL AND jsonb_array_length(r.diff) > 0)
       )
     ORDER BY r.match_product_id, r.row_number DESC, r.id DESC
  ),
  upd AS (
    UPDATE bling_products bp SET
      bling_product_id = COALESCE((s.rec).bling_product_id, bp.bling_product_id),
      nome = (s.rec).nome,
      descricao_complementar = (s.rec).descricao_complementar,
      descricao_curta = (s.rec).descricao_curta,
      observacoes = (s.rec).observacoes,
      unidade = (s.rec).unidade,
      unidade_medida = (s.rec).unidade_medida,
      ncm = (s.rec).ncm,
      origem_fiscal = (s.rec).origem_fiscal,
      situacao = (s.rec).situacao,
      gtin = (s.rec).gtin,
      gtin_embalagem = (s.rec).gtin_embalagem,
      marca = (s.rec).marca,
      categoria_produto = (s.rec).categoria_produto,
      fornecedor = (s.rec).fornecedor,
      cod_fornecedor = (s.rec).cod_fornecedor,
      localizacao = (s.rec).localizacao,
      grupo_produtos = (s.rec).grupo_produtos,
      grupo_tags = (s.rec).grupo_tags,
      tipo_item = (s.rec).tipo_item,
      tipo_producao = (s.rec).tipo_producao,
      produto_variacao = (s.rec).produto_variacao,
      codigo_pai = (s.rec).codigo_pai,
      codigo_integracao = (s.rec).codigo_integracao,
      departamento = (s.rec).departamento,
      condicao_produto = (s.rec).condicao_produto,
      frete_gratis = (s.rec).frete_gratis,
      cross_docking = (s.rec).cross_docking,
      clonar_dados_pai = (s.rec).clonar_dados_pai,
      meses_garantia_fornecedor = (s.rec).meses_garantia_fornecedor,
      numero_fci = (s.rec).numero_fci,
      cest = (s.rec).cest,
      classe_ipi = (s.rec).classe_ipi,
      codigo_lista_servicos = (s.rec).codigo_lista_servicos,
      tributos = (s.rec).tributos,
      descricao_fornecedor = (s.rec).descricao_fornecedor,
      informacoes_adicionais = (s.rec).informacoes_adicionais,
      url_imagens_externas = (s.rec).url_imagens_externas,
      link_externo = (s.rec).link_externo,
      video = (s.rec).video,
      preco = (s.rec).preco,
      preco_custo = (s.rec).preco_custo,
      preco_compra = (s.rec).preco_compra,
      valor_ipi_fixo = (s.rec).valor_ipi_fixo,
      icms_st_base = (s.rec).icms_st_base,
      icms_st_retencao = (s.rec).icms_st_retencao,
      icms_proprio_substituto = (s.rec).icms_proprio_substituto,
      estoque = (s.rec).estoque,
      estoque_minimo = (s.rec).estoque_minimo,
      estoque_maximo = (s.rec).estoque_maximo,
      itens_caixa = (s.rec).itens_caixa,
      volumes = (s.rec).volumes,
      peso_liquido = (s.rec).peso_liquido,
      peso_bruto = (s.rec).peso_bruto,
      largura = (s.rec).largura,
      altura = (s.rec).altura,
      profundidade = (s.rec).profundidade,
      data_validade = (s.rec).data_validade,
      source = 'planilha',
      last_imported_at = now(),
      dirty = CASE WHEN s.act = 'update_changed' THEN true ELSE bp.dirty END
    FROM src s
    WHERE bp.id = s.pid
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM upd;

  UPDATE product_sheet_rows
     SET applied_at = now()
   WHERE batch_id = _batch_id
     AND applied_at IS NULL
     AND match_product_id IS NOT NULL
     AND action IN ('update_all', 'update_changed');

  UPDATE product_sheet_rows
     SET applied_at = now(),
         error = COALESCE(error, 'Linha sem SKU ou sem correspondência.')
   WHERE batch_id = _batch_id AND applied_at IS NULL;

  UPDATE import_batches
     SET status = 'aplicada',
         applied_at = now(),
         apply_processed = _total,
         new_count = _imported,
         updated_count = _updated,
         ignored_count = _ignored
   WHERE id = _batch_id;

  RETURN jsonb_build_object('imported', _imported, 'updated', _updated, 'ignored', _ignored, 'duplicates', _dups);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enqueue_bling_inactivate(_company_id uuid, _product_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _integration_id uuid;
  _created int := 0;
  _updated int := 0;
  _skipped_sem_bling int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  IF _product_ids IS NULL OR array_length(_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecione ao menos um produto para inativar.';
  END IF;

  SELECT id INTO _integration_id
  FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada'
  LIMIT 1;
  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada para esta empresa.';
  END IF;

  CREATE TEMP TABLE _pending_inact ON COMMIT DROP AS
  SELECT p.id AS product_id, p.bling_product_id
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND p.id = ANY(_product_ids);

  SELECT count(*) INTO _skipped_sem_bling
    FROM _pending_inact WHERE bling_product_id IS NULL OR btrim(bling_product_id) = '';
  DELETE FROM _pending_inact WHERE bling_product_id IS NULL OR btrim(bling_product_id) = '';

  WITH ins AS (
    INSERT INTO public.bling_push_queue AS q
      (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
       tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
    SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, NULL,
           'inativar', NULL, 0, 'pendente', now()
    FROM _pending_inact p
    ON CONFLICT (integration_id, product_id, tipo)
      WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
      DO UPDATE SET
        proxima_tentativa_em = now(),
        tentativas = 0, erro = NULL, status = 'pendente'
    RETURNING xmax = 0 AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
    INTO _created, _updated FROM ins;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'created', _created,
    'updated_existing', _updated,
    'skipped_sem_bling_id', _skipped_sem_bling
  );
END; $function$
;
CREATE OR REPLACE FUNCTION public.transform_fill_dimensions_from_supplier(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  _updated int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH alvo AS (
    SELECT p.id, p.peso_liquido, p.peso_bruto, p.largura, p.altura, p.profundidade,
           upper(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+')) AS prefix,
           btrim(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
      AND (COALESCE(p.peso_liquido, 0) <= 0 OR COALESCE(p.largura, 0) <= 0
        OR COALESCE(p.altura, 0) <= 0 OR COALESCE(p.profundidade, 0) <= 0)
  ),
  mapped AS (
    SELECT a.*, public.map_supplier_prefix(a.prefix) AS sup_codigo
    FROM alvo a
  ),
  joined AS (
    SELECT m.id,
      COALESCE(NULLIF(m.peso_liquido, 0), NULLIF(fp.peso, 0)) AS peso_liquido,
      COALESCE(NULLIF(m.peso_bruto, 0), NULLIF(fp.peso, 0)) AS peso_bruto,
      COALESCE(NULLIF(m.largura, 0), NULLIF(fp.largura, 0)) AS largura,
      COALESCE(NULLIF(m.altura, 0), NULLIF(fp.altura, 0)) AS altura,
      COALESCE(NULLIF(m.profundidade, 0), NULLIF(fp.comprimento, 0)) AS profundidade
    FROM mapped m
    JOIN public.fornecedores f ON f.codigo = m.sup_codigo
      AND (f.company_id IS NULL OR f.company_id = _company_id)
    JOIN public.fornecedor_produtos fp ON fp.fornecedor_id = f.id
      AND btrim(fp.codigo) = m.num_code
    WHERE m.sup_codigo IS NOT NULL AND COALESCE(m.num_code, '') <> ''
  ),
  upd AS (
    UPDATE public.bling_products bp SET
      peso_liquido = j.peso_liquido,
      peso_bruto = j.peso_bruto,
      largura = j.largura,
      altura = j.altura,
      profundidade = j.profundidade,
      dirty = true,
      updated_at = now()
    FROM joined j
    WHERE bp.id = j.id
      AND (bp.peso_liquido IS DISTINCT FROM j.peso_liquido
        OR bp.peso_bruto IS DISTINCT FROM j.peso_bruto
        OR bp.largura IS DISTINCT FROM j.largura
        OR bp.altura IS DISTINCT FROM j.altura
        OR bp.profundidade IS DISTINCT FROM j.profundidade)
    RETURNING 1
  )
  SELECT count(*)::int INTO _updated FROM upd;

  RETURN jsonb_build_object('updated', _updated);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_next_push_batch(_integration_id uuid DEFAULT NULL::uuid, _limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, integration_id uuid, company_id uuid, product_id uuid, bling_product_id text, bling_deposit_id text, tipo text, valor_novo numeric, tentativas integer, bling_product_store_id text, payload jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _target uuid;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  PERFORM set_config('lock_timeout','3s', true);
  PERFORM set_config('statement_timeout','20s', true);

  IF _integration_id IS NOT NULL THEN
    _target := _integration_id;
  ELSE
    SELECT q.integration_id INTO _target
    FROM public.bling_push_queue q
    WHERE q.status = 'pendente' AND q.proxima_tentativa_em <= now()
    ORDER BY q.created_at
    LIMIT 1;
  END IF;
  IF _target IS NULL THEN RETURN; END IF;

  IF NOT pg_try_advisory_xact_lock(hashtextextended(_target::text, 42)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT q.id FROM public.bling_push_queue q
    WHERE q.integration_id = _target
      AND q.status = 'pendente'
      AND q.proxima_tentativa_em <= now()
    ORDER BY q.created_at
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.bling_push_queue q
       SET status = 'processando', claimed_at = now(), tentativas = q.tentativas + 1
      FROM picked WHERE q.id = picked.id
    RETURNING q.*
  )
  SELECT u.id, u.integration_id, u.company_id, u.product_id,
         u.bling_product_id, u.bling_deposit_id, u.tipo,
         u.valor_novo, u.tentativas, u.bling_product_store_id, u.payload
  FROM upd u;
END; $function$
;
CREATE OR REPLACE FUNCTION public.reclaim_stuck_workers_throttled(_minutes integer DEFAULT 10, _every_seconds integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE inserted boolean;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  PERFORM set_config('lock_timeout','2s', true);
  INSERT INTO public.worker_leases(key, pool, holder, expires_at)
  VALUES ('reclaim:sweep', 'maintenance', 'sweep',
          now() + make_interval(secs => GREATEST(COALESCE(_every_seconds,60),5)))
  ON CONFLICT (key) DO UPDATE
     SET expires_at = EXCLUDED.expires_at
   WHERE public.worker_leases.expires_at < now();
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF NOT inserted THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;
  RETURN public.reclaim_stuck_workers(_minutes);
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('skipped', true, 'error', SQLERRM);
END; $function$
;
CREATE OR REPLACE FUNCTION public.bump_bling_api_usage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NEW.company_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.bling_api_usage_daily (company_id, dia, total, updated_at)
  VALUES (NEW.company_id, ((COALESCE(NEW.created_at, now())) AT TIME ZONE 'America/Sao_Paulo')::date, 1, now())
  ON CONFLICT (company_id, dia)
  DO UPDATE SET total = public.bling_api_usage_daily.total + 1, updated_at = now();
  RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.start_bling_stores_sync(_company_id uuid, _scope text DEFAULT 'full'::text, _bling_product_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _integ_id uuid;
  _job_id uuid;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN RAISE EXCEPTION 'not a member of company'; END IF;

  SELECT id INTO _integ_id FROM public.bling_integrations
   WHERE company_id = _company_id AND status = 'conectada' LIMIT 1;
  IF _integ_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada.';
  END IF;

  -- If a job is already active for this integration, return it
  SELECT id INTO _job_id FROM public.bling_store_sync_jobs
   WHERE integration_id = _integ_id AND status IN ('pendente','processando')
   LIMIT 1;
  IF _job_id IS NOT NULL THEN
    RETURN jsonb_build_object('job_id', _job_id, 'already_running', true);
  END IF;

  INSERT INTO public.bling_store_sync_jobs(company_id, integration_id, scope, bling_product_id, status, started_at)
  VALUES (_company_id, _integ_id, COALESCE(_scope,'full'), _bling_product_id, 'pendente', now())
  RETURNING id INTO _job_id;

  RETURN jsonb_build_object('job_id', _job_id, 'integration_id', _integ_id, 'already_running', false);
END; $function$
;
CREATE OR REPLACE FUNCTION public.classify_import_batch(_batch_id uuid, _company_id uuid, _limit integer DEFAULT 3000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  _total int;
  _pending int;
  _done int;
  _new int;
  _existing int;
  _processed int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  SELECT count(*) INTO _total FROM product_sheet_rows WHERE batch_id = _batch_id;

  IF _total = 0 THEN
    UPDATE import_batches
       SET status = 'aguardando_revisao', new_count = 0, existing_count = 0,
           classify_total = 0, classify_processed = 0, finished_at = now()
     WHERE id = _batch_id;
    RETURN jsonb_build_object('ok', true, 'done', true, 'remaining', 0, 'new', 0, 'existing', 0);
  END IF;

  UPDATE import_batches
     SET status = 'classificando',
         classify_total = _total
   WHERE id = _batch_id;

  -- Lote de linhas ainda não classificadas
  WITH batch AS (
    SELECT id, sku, bling_id, gtin
      FROM product_sheet_rows
     WHERE batch_id = _batch_id AND match_type IS NULL
     ORDER BY row_number
     LIMIT _limit
  ),
  matched AS (
    SELECT r.id AS rid,
           COALESCE(p_sku.id, p_bid.id, p_gtin.id) AS product_id,
           CASE
             WHEN p_sku.id IS NOT NULL THEN 'sku'
             WHEN p_bid.id IS NOT NULL THEN 'bling_id'
             WHEN p_gtin.id IS NOT NULL THEN 'gtin'
             ELSE 'none'
           END AS mt
    FROM batch r
    LEFT JOIN bling_products p_sku
      ON r.sku IS NOT NULL AND p_sku.company_id = _company_id AND p_sku.codigo = r.sku
    LEFT JOIN bling_products p_bid
      ON p_sku.id IS NULL AND r.bling_id IS NOT NULL
     AND p_bid.company_id = _company_id AND p_bid.bling_product_id = r.bling_id
    LEFT JOIN bling_products p_gtin
      ON p_sku.id IS NULL AND p_bid.id IS NULL AND r.gtin IS NOT NULL
     AND p_gtin.company_id = _company_id AND p_gtin.gtin = r.gtin
  ),
  upd AS (
    UPDATE product_sheet_rows r
       SET match_type = m.mt,
           match_product_id = m.product_id,
           diff = NULL,
           action = CASE WHEN m.mt = 'none' THEN 'import' ELSE 'update_changed' END
      FROM matched m
     WHERE r.id = m.rid
    RETURNING r.id
  )
  SELECT count(*) INTO _processed FROM upd;

  -- Diffs apenas das linhas recém classificadas com produto correspondente
  WITH pairs AS (
    SELECT r.id AS rid, r.parsed AS p, to_jsonb(bp) AS s
    FROM product_sheet_rows r
    JOIN bling_products bp ON bp.id = r.match_product_id
    WHERE r.batch_id = _batch_id
      AND r.match_product_id IS NOT NULL
      AND r.diff IS NULL
      AND r.applied_at IS NULL
    ORDER BY r.row_number
    LIMIT _limit
  ),
  diffs AS (
    SELECT rid,
      (
        SELECT jsonb_agg(elem)
        FROM (VALUES
          ('nome'), ('descricao_complementar'), ('descricao_curta'), ('preco'), ('preco_custo'), ('estoque'),
          ('marca'), ('fornecedor'), ('categoria_produto'), ('gtin'), ('gtin_embalagem'),
          ('peso_liquido'), ('peso_bruto'), ('largura'), ('altura'), ('profundidade'), ('ncm'), ('unidade'),
          ('url_imagens_externas'), ('situacao'), ('codigo_pai'), ('tipo_item'), ('grupo_produtos')
        ) AS f(name)
        CROSS JOIN LATERAL (
          SELECT jsonb_build_object('field', f.name, 'sistema', s->>f.name, 'planilha', p->>f.name) AS elem
          WHERE public.norm_cmp(s->>f.name) IS DISTINCT FROM public.norm_cmp(p->>f.name)
        ) x
      ) AS d
    FROM pairs
  )
  UPDATE product_sheet_rows r
     SET diff = diffs.d
    FROM diffs
   WHERE r.id = diffs.rid AND diffs.d IS NOT NULL;

  SELECT count(*) FILTER (WHERE match_type IS NULL),
         count(*) FILTER (WHERE match_type IS NOT NULL),
         count(*) FILTER (WHERE match_type = 'none'),
         count(*) FILTER (WHERE match_type IS NOT NULL AND match_type <> 'none')
    INTO _pending, _done, _new, _existing
  FROM product_sheet_rows
  WHERE batch_id = _batch_id;

  IF _pending = 0 THEN
    UPDATE import_batches
       SET status = 'aguardando_revisao',
           new_count = _new,
           existing_count = _existing,
           classify_processed = _total,
           finished_at = now()
     WHERE id = _batch_id;
  ELSE
    UPDATE import_batches
       SET new_count = _new,
           existing_count = _existing,
           classify_processed = _done
     WHERE id = _batch_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'done', _pending = 0,
    'processed', _processed,
    'remaining', _pending,
    'new', _new,
    'existing', _existing
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enqueue_bling_link_store(_company_id uuid, _product_ids uuid[], _bling_store_id text, _action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  _integration_id uuid;
  _pricing pricing_settings%ROWTYPE;
  _store_comissao numeric;
  _enqueued int := 0;
  _skipped int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  IF _action NOT IN ('link','unlink') THEN
    RAISE EXCEPTION 'invalid action';
  END IF;

  SELECT id INTO _integration_id
  FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada'
  LIMIT 1;

  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada.';
  END IF;

  IF _action = 'unlink' THEN
    WITH src AS (
      SELECT p.id AS product_id, p.bling_product_id, bps.bling_product_store_id
      FROM public.bling_products p
      JOIN public.bling_product_stores bps
        ON bps.internal_product_id = p.id
       AND bps.company_id = p.company_id
      WHERE p.company_id = _company_id
        AND p.id = ANY(_product_ids)
        AND bps.bling_store_id = _bling_store_id
        AND bps.bling_product_store_id IS NOT NULL
        AND btrim(bps.bling_product_store_id) <> ''
        AND p.bling_product_id IS NOT NULL
        AND btrim(p.bling_product_id) <> ''
    ), del AS (
      DELETE FROM public.bling_push_queue q
      USING src s
      WHERE q.integration_id = _integration_id
        AND q.product_id = s.product_id
        AND q.tipo = 'desvincular_loja'
        AND q.bling_product_store_id = s.bling_product_store_id
        AND q.status IN ('pendente','processando')
      RETURNING 1
    ), ins AS (
      INSERT INTO public.bling_push_queue
        (company_id, integration_id, product_id, bling_product_id, bling_product_store_id,
         tipo, valor_novo, payload, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, s.product_id, s.bling_product_id, s.bling_product_store_id,
             'desvincular_loja', 0,
             jsonb_build_object('bling_store_id', _bling_store_id),
             'pendente', now()
      FROM src s
      RETURNING 1
    )
    SELECT count(*) INTO _enqueued FROM ins;

    RETURN jsonb_build_object(
      'integration_id', _integration_id,
      'action', _action,
      'bling_store_id', _bling_store_id,
      'enqueued', _enqueued,
      'skipped', 0
    );
  END IF;

  SELECT * INTO _pricing
  FROM public.pricing_settings
  WHERE company_id = _company_id;

  SELECT m.taxa_percent INTO _store_comissao
  FROM public.bling_stores bs
  LEFT JOIN public.marketplaces m ON m.id = bs.marketplace_id
  WHERE bs.company_id = _company_id
    AND bs.bling_store_id = _bling_store_id
  LIMIT 1;

  CREATE TEMP TABLE _work ON COMMIT DROP AS
  WITH prods AS (
    SELECT p.id, p.codigo, p.bling_product_id,
           upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix,
           btrim(substring(p.codigo from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND p.id = ANY(_product_ids)
      AND p.bling_product_id IS NOT NULL
      AND btrim(p.bling_product_id) <> ''
  ), mapped AS (
    SELECT pr.*,
      public.map_supplier_prefix(prefix) AS sup_codigo
    FROM prods pr
  ), joined AS (
    SELECT m.*,
      s.id AS sup_id,
      s.preco_embalagem AS sup_emb,
      s.preco_transporte AS sup_transp,
      s.taxa_devolucao AS sup_devol,
      s.taxa_promocao AS sup_promo,
      COALESCE(
        NULLIF((fp.precos->>'PR')::numeric, 0),
        NULLIF((fp.precos->>'base')::numeric, 0),
        NULLIF((fp.precos->>'dropshipping')::numeric, 0),
        NULLIF((fp.precos->>'crossdocking')::numeric, 0)
      ) AS fp_preco,
      ov.embalagem AS ov_emb,
      ov.transporte AS ov_transp,
      ov.taxa_operacional AS ov_taxa_op
    FROM mapped m
    LEFT JOIN public.fornecedores s ON s.codigo = m.sup_codigo
    LEFT JOIN public.fornecedor_produtos fp
      ON fp.fornecedor_id = s.id
     AND btrim(fp.codigo) = m.num_code
     AND m.num_code <> ''
    LEFT JOIN public.product_cost_overrides ov
      ON ov.product_id = m.id
     AND ov.company_id = _company_id
  ), calc AS (
    SELECT j.*,
      (
        COALESCE(j.fp_preco, 0)
        + COALESCE(j.ov_emb, j.sup_emb, COALESCE(_pricing.embalagem_default, 0))
        + COALESCE(j.ov_transp, j.sup_transp, COALESCE(_pricing.transporte_default, 0))
        + CASE
            WHEN COALESCE(j.ov_taxa_op, _pricing.taxa_operacional_valor, 0) > 0
             AND COALESCE(j.fp_preco, 0) >= COALESCE(_pricing.taxa_operacional_min_custo, 0)
            THEN COALESCE(j.ov_taxa_op, _pricing.taxa_operacional_valor)
            ELSE 0
          END
      ) AS cmv_base
    FROM joined j
  ), calc2 AS (
    SELECT c.*, (c.cmv_base * (1 + COALESCE(_pricing.frete_medio_percent, 0)/100)) AS cmv_total
    FROM calc c
  ), calc3 AS (
    SELECT c.*,
      (c.cmv_total
       + c.cmv_total * COALESCE(_pricing.custo_fixo_percent, 0)/100
       + c.cmv_total * COALESCE(_pricing.devolucao_percent, 0)/100
      ) AS custo_completo
    FROM calc2 c
  ), priced AS (
    SELECT c.*,
      CASE
        WHEN c.sup_id IS NULL THEN NULL
        WHEN c.fp_preco IS NULL OR c.fp_preco <= 0 THEN NULL
        WHEN _store_comissao IS NULL THEN NULL
        ELSE public._apply_price_anchor(
          public._compute_sale_price(
            c.custo_completo,
            COALESCE(_store_comissao, 0),
            COALESCE(c.sup_devol, 0),
            COALESCE(c.sup_promo, 0),
            COALESCE(_pricing.profit_bands, '[]'::jsonb)
          ),
          COALESCE(_pricing.price_anchors, '[]'::jsonb)
        )
      END AS preco_venda
    FROM calc3 c
  )
  SELECT id,
         codigo,
         bling_product_id,
         sup_promo,
         preco_venda,
         CASE
           WHEN preco_venda IS NULL THEN NULL
           ELSE round((preco_venda * (1 - COALESCE(sup_promo, 0)/100))::numeric, 2)
         END AS preco_promo
  FROM priced;

  DELETE FROM public.bling_push_queue q
  USING _work w
  WHERE q.integration_id = _integration_id
    AND q.product_id = w.id
    AND q.tipo = 'vincular_loja'
    AND q.bling_product_store_id = _bling_store_id
    AND q.status IN ('pendente','processando');

  WITH ins AS (
    INSERT INTO public.bling_push_queue
      (company_id, integration_id, product_id, bling_product_id, bling_product_store_id,
       tipo, valor_novo, payload, status, proxima_tentativa_em)
    SELECT _company_id, _integration_id, w.id, w.bling_product_id, _bling_store_id,
           'vincular_loja', COALESCE(w.preco_venda, 0),
           jsonb_build_object(
             'bling_store_id', _bling_store_id,
             'preco', w.preco_venda,
             'preco_promocional', w.preco_promo,
             'codigo', w.codigo
           ),
           'pendente', now()
    FROM _work w
    WHERE w.preco_venda IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO _enqueued FROM ins;

  SELECT count(*) INTO _skipped
  FROM _work
  WHERE preco_venda IS NULL;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'action', _action,
    'bling_store_id', _bling_store_id,
    'store_comissao', _store_comissao,
    'enqueued', _enqueued,
    'skipped', _skipped
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enqueue_bling_push(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[], _scope text DEFAULT 'ambos'::text, _include_stores boolean DEFAULT false, _only_changed boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  _integration_id uuid;
  _default_dep text;
  _created_preco int := 0;
  _created_estoque int := 0;
  _created_produto int := 0;
  _created_criar int := 0;
  _created_lojas int := 0;
  _updated_existing int := 0;
  _skipped_sem_bling int := 0;
  _skipped_sem_dep int := 0;
  _skipped_sem_mudanca int := 0;
  _tipos text[];
  _enq_at timestamptz := now();
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT id, default_deposito_id INTO _integration_id, _default_dep
  FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada'
  LIMIT 1;

  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada para esta empresa.';
  END IF;

  -- Limpa APENAS os tipos que esta chamada vai reenfileirar; nunca mexe em
  -- itens de outras transformações (ex.: codigo_loja, inativar, excluir).
  _tipos := CASE
    WHEN _scope = 'criar' THEN ARRAY['criar']
    WHEN _scope = 'todos' THEN ARRAY['criar','produto']
    WHEN _scope = 'preco' THEN ARRAY['preco']
    WHEN _scope = 'estoque' THEN ARRAY['estoque']
    ELSE ARRAY['preco','estoque']
  END;
  IF _include_stores AND _scope IN ('preco','ambos','todos') THEN
    _tipos := _tipos || ARRAY['preco_loja'];
  END IF;

  DELETE FROM public.bling_push_queue
  WHERE company_id = _company_id AND tipo = ANY(_tipos);

  -- Se já existir outra transformação na fila, esta entra no FINAL dela.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.bling_push_queue
    WHERE company_id = _company_id
      AND status IN ('pendente','processando')
      AND NOT (tipo = ANY(_tipos))
  ) THEN now() + interval '1 second' ELSE now() END
  INTO _enq_at;

  CREATE TEMP TABLE _pending ON COMMIT DROP AS
  SELECT p.id AS product_id,
         p.bling_product_id,
         COALESCE(p.bling_deposit_id, _default_dep) AS bling_deposit_id,
         p.preco,
         p.estoque,
         p.ultimo_preco_sincronizado,
         p.ultimo_estoque_sincronizado
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids));

  IF _scope = 'criar' THEN
    WITH ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, NULL, p.bling_deposit_id,
             'criar', NULL, COALESCE(p.preco, 0), 'pendente', _enq_at
      FROM _pending p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          valor_novo = EXCLUDED.valor_novo,
          proxima_tentativa_em = now(),
          tentativas = 0, erro = NULL, status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
      INTO _created_criar, _updated_existing FROM ins;

    RETURN jsonb_build_object(
      'integration_id', _integration_id,
      'created_preco', 0, 'created_estoque', 0, 'created_produto', 0,
      'created_criar', _created_criar, 'created_lojas', 0,
      'updated_existing', _updated_existing,
      'skipped_sem_bling_id', 0, 'skipped_sem_deposito', 0,
      'skipped_sem_mudanca', 0
    );
  END IF;

  CREATE TEMP TABLE _pending_no_id ON COMMIT DROP AS
  SELECT * FROM _pending WHERE bling_product_id IS NULL OR btrim(bling_product_id) = '';

  DELETE FROM _pending WHERE bling_product_id IS NULL OR btrim(bling_product_id) = '';

  IF _scope = 'todos' THEN
    WITH ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, NULL, p.bling_deposit_id,
             'criar', NULL, COALESCE(p.preco, 0), 'pendente', _enq_at
      FROM _pending_no_id p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          valor_novo = EXCLUDED.valor_novo,
          proxima_tentativa_em = now(),
          tentativas = 0, erro = NULL, status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
      INTO _created_criar, _updated_existing FROM ins;

    WITH ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, p.bling_deposit_id,
             'produto', p.ultimo_preco_sincronizado, COALESCE(p.preco, 0), 'pendente', _enq_at
      FROM _pending p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          valor_novo = EXCLUDED.valor_novo,
          valor_anterior = EXCLUDED.valor_anterior,
          proxima_tentativa_em = now(),
          tentativas = 0, erro = NULL, status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), _updated_existing + count(*) FILTER (WHERE NOT inserted)
      INTO _created_produto, _updated_existing FROM ins;
  ELSE
    SELECT count(*) INTO _skipped_sem_bling FROM _pending_no_id;
  END IF;

  IF _scope = 'preco' OR _scope = 'ambos' THEN
    WITH src AS (
      SELECT * FROM _pending p
      WHERE NOT _only_changed
         OR p.ultimo_preco_sincronizado IS DISTINCT FROM COALESCE(p.preco, 0)
    ), ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, p.bling_deposit_id,
             'preco', p.ultimo_preco_sincronizado, COALESCE(p.preco, 0), 'pendente', _enq_at
      FROM src p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          bling_product_id = EXCLUDED.bling_product_id,
          valor_anterior = EXCLUDED.valor_anterior,
          valor_novo = EXCLUDED.valor_novo,
          proxima_tentativa_em = now(),
          tentativas = 0,
          erro = NULL,
          status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), _updated_existing + count(*) FILTER (WHERE NOT inserted)
      INTO _created_preco, _updated_existing FROM ins;

    IF _only_changed THEN
      SELECT _skipped_sem_mudanca + count(*) INTO _skipped_sem_mudanca
      FROM _pending p
      WHERE p.ultimo_preco_sincronizado IS NOT DISTINCT FROM COALESCE(p.preco, 0);
    END IF;
  END IF;

  IF _scope = 'estoque' OR _scope = 'ambos' THEN
    WITH src AS (
      SELECT * FROM _pending p
      WHERE p.bling_deposit_id IS NOT NULL AND btrim(p.bling_deposit_id) <> ''
        AND (NOT _only_changed
             OR p.ultimo_estoque_sincronizado IS DISTINCT FROM COALESCE(p.estoque, 0))
    ), ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_deposit_id,
         tipo, valor_anterior, valor_novo, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, p.product_id, p.bling_product_id, p.bling_deposit_id,
             'estoque', p.ultimo_estoque_sincronizado, COALESCE(p.estoque, 0), 'pendente', _enq_at
      FROM src p
      ON CONFLICT (integration_id, product_id, tipo)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
        DO UPDATE SET
          bling_product_id = EXCLUDED.bling_product_id,
          bling_deposit_id = EXCLUDED.bling_deposit_id,
          valor_anterior = EXCLUDED.valor_anterior,
          valor_novo = EXCLUDED.valor_novo,
          proxima_tentativa_em = now(),
          tentativas = 0,
          erro = NULL,
          status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), _updated_existing + count(*) FILTER (WHERE NOT inserted)
      INTO _created_estoque, _updated_existing FROM ins;

    SELECT count(*) INTO _skipped_sem_dep
    FROM _pending
    WHERE bling_deposit_id IS NULL OR btrim(bling_deposit_id) = '';

    IF _only_changed THEN
      SELECT _skipped_sem_mudanca + count(*) INTO _skipped_sem_mudanca
      FROM _pending p
      WHERE p.bling_deposit_id IS NOT NULL AND btrim(p.bling_deposit_id) <> ''
        AND p.ultimo_estoque_sincronizado IS NOT DISTINCT FROM COALESCE(p.estoque, 0);
    END IF;
  END IF;

  IF _include_stores AND (_scope = 'preco' OR _scope = 'ambos' OR _scope = 'todos') THEN
    WITH stores AS (
      SELECT ps.internal_product_id AS product_id,
             ps.bling_product_store_id,
             ps.current_price,
             ps.ultimo_preco_sincronizado,
             ps.bling_store_id,
             ps.store_product_code,
             ps.current_promotional_price,
             sup.taxa_promocao AS sup_taxa_promocao,
             p.preco,
             p.codigo,
             p.bling_product_id
      FROM public.bling_product_stores ps
      JOIN public.bling_products p ON p.id = ps.internal_product_id
      LEFT JOIN public.fornecedores sup ON sup.codigo = (public.map_supplier_prefix(upper(substring(p.codigo from '^[A-Za-z]+'))))
      WHERE p.company_id = _company_id
        AND ps.company_id = _company_id
        AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
        AND ps.is_linked = true
        AND ps.bling_product_store_id IS NOT NULL
        AND btrim(ps.bling_product_store_id) <> ''
        AND p.bling_product_id IS NOT NULL
        AND btrim(p.bling_product_id) <> ''
    ), src AS (
      SELECT * FROM stores s
      WHERE NOT _only_changed
         OR s.ultimo_preco_sincronizado IS DISTINCT FROM COALESCE(s.current_price, s.preco, 0)
    ), ins AS (
      INSERT INTO public.bling_push_queue AS q
        (company_id, integration_id, product_id, bling_product_id, bling_product_store_id,
         tipo, valor_anterior, valor_novo, payload, status, proxima_tentativa_em)
      SELECT _company_id, _integration_id, s.product_id, s.bling_product_id, s.bling_product_store_id,
             'preco_loja', s.ultimo_preco_sincronizado, COALESCE(s.current_price, s.preco, 0),
             jsonb_build_object(
               'bling_store_id', s.bling_store_id,
               'codigo', COALESCE(NULLIF(btrim(s.store_product_code), ''), s.codigo),
               'preco_promocional', COALESCE(
                 s.current_promotional_price,
                 round((COALESCE(s.current_price, s.preco, 0) * (1 - COALESCE(s.sup_taxa_promocao, 0)/100))::numeric, 2)
               )
             ),
             'pendente', _enq_at
      FROM src s
      ON CONFLICT (integration_id, product_id, tipo, bling_product_store_id)
        WHERE status IN ('pendente','processando') AND bling_product_store_id IS NOT NULL
        DO UPDATE SET
          bling_product_id = EXCLUDED.bling_product_id,
          valor_anterior = EXCLUDED.valor_anterior,
          valor_novo = EXCLUDED.valor_novo,
          payload = EXCLUDED.payload,
          proxima_tentativa_em = now(),
          tentativas = 0,
          erro = NULL,
          status = 'pendente'
      RETURNING xmax = 0 AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted) INTO _created_lojas FROM ins;
  END IF;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'created_preco', _created_preco,
    'created_estoque', _created_estoque,
    'created_produto', _created_produto,
    'created_criar', _created_criar,
    'created_lojas', _created_lojas,
    'updated_existing', _updated_existing,
    'skipped_sem_bling_id', _skipped_sem_bling,
    'skipped_sem_deposito', _skipped_sem_dep,
    'skipped_sem_mudanca', _skipped_sem_mudanca
  );
END; $function$
;
CREATE OR REPLACE FUNCTION public.delete_products_batch(_company_id uuid, _limit integer DEFAULT 500, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ids uuid[];
  _n integer;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  SELECT array_agg(id) INTO _ids
  FROM (
    SELECT id FROM public.bling_products
    WHERE company_id = _company_id
      AND (_product_ids IS NULL OR id = ANY(_product_ids))
    LIMIT GREATEST(1, LEAST(_limit, 2000))
  ) t;

  IF _ids IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.audit_results WHERE product_id = ANY(_ids);
  DELETE FROM public.bling_push_queue WHERE product_id = ANY(_ids);
  DELETE FROM public.product_cost_overrides WHERE product_id = ANY(_ids);
  DELETE FROM public.bling_product_custom_values WHERE product_id = ANY(_ids);
  DELETE FROM public.ml_product_matches WHERE product_id = ANY(_ids);
  DELETE FROM public.bling_product_stores WHERE company_id = _company_id AND internal_product_id = ANY(_ids);
  UPDATE public.bling_order_items SET product_id = NULL WHERE product_id = ANY(_ids);

  DELETE FROM public.bling_products WHERE id = ANY(_ids);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.delete_store_links_batch(_company_id uuid, _bling_store_id text DEFAULT NULL::text, _limit integer DEFAULT 2000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _n integer;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo
  ) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.';
  END IF;

  WITH doomed AS (
    SELECT id FROM public.bling_product_stores
    WHERE company_id = _company_id
      AND (_bling_store_id IS NULL OR bling_store_id = _bling_store_id)
    LIMIT GREATEST(1, LEAST(_limit, 5000))
  )
  DELETE FROM public.bling_product_stores s USING doomed d WHERE s.id = d.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.finish_bling_push_success(_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _tipo text; _pid uuid; _valor numeric; _store text;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  UPDATE public.bling_push_queue
     SET status = 'concluido', erro = NULL, processed_at = now(), updated_at = now()
   WHERE id = _item_id
   RETURNING tipo, product_id, valor_novo, bling_product_store_id
        INTO _tipo, _pid, _valor, _store;

  IF _pid IS NULL THEN RETURN; END IF;

  IF _tipo = 'preco' THEN
    UPDATE public.bling_products SET
      ultimo_preco_sincronizado = _valor,
      sincronizado_em = now(),
      sincronizacao_status = 'ok',
      sincronizacao_erro = NULL
    WHERE id = _pid;
  ELSIF _tipo = 'estoque' THEN
    UPDATE public.bling_products SET
      ultimo_estoque_sincronizado = _valor,
      sincronizado_em = now(),
      sincronizacao_status = 'ok',
      sincronizacao_erro = NULL
    WHERE id = _pid;
  ELSIF _tipo = 'inativar' THEN
    UPDATE public.bling_products SET
      situacao = 'I',
      dirty = false,
      sincronizado_em = now(),
      sincronizacao_status = 'ok',
      sincronizacao_erro = NULL
    WHERE id = _pid;
  ELSIF _tipo = 'preco_loja' AND _store IS NOT NULL THEN
    UPDATE public.bling_product_stores SET
      ultimo_preco_sincronizado = _valor,
      sincronizado_em = now()
    WHERE bling_product_store_id = _store;
    UPDATE public.bling_products SET
      sincronizado_em = now(),
      sincronizacao_status = 'ok',
      sincronizacao_erro = NULL
    WHERE id = _pid;
  ELSE
    UPDATE public.bling_products SET
      sincronizado_em = now(),
      sincronizacao_status = 'ok',
      sincronizacao_erro = NULL
    WHERE id = _pid;
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_session_product_ids(_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 RETURN (WITH s AS (
    SELECT id, company_id, started_at, COALESCE(finished_at, now()) AS ended_at
    FROM public.transform_sessions
    WHERE id = _session_id
      AND app_private.is_company_member(company_id, auth.uid())
  ),
  base AS (
    SELECT bp.id, bp.updated_at AS ts
    FROM s JOIN public.bling_products bp ON bp.company_id = s.company_id
    WHERE bp.updated_at >= s.started_at AND bp.updated_at <= s.ended_at
    UNION
    SELECT ps.internal_product_id AS id, ps.updated_at AS ts
    FROM s JOIN public.bling_product_stores ps ON ps.company_id = s.company_id
    WHERE ps.internal_product_id IS NOT NULL
      AND ps.updated_at >= s.started_at AND ps.updated_at <= s.ended_at
  )
  SELECT COALESCE(jsonb_agg(id ORDER BY ts DESC), '[]'::jsonb)
  FROM (SELECT id, MAX(ts) AS ts FROM base GROUP BY id) d);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_session_products(_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 RETURN (WITH s AS (
    SELECT id, company_id, started_at, COALESCE(finished_at, now()) AS ended_at
    FROM public.transform_sessions
    WHERE id = _session_id
      AND app_private.is_company_member(company_id, auth.uid())
  ),
  stores AS (
    SELECT ps.internal_product_id AS pid,
           COUNT(*)::int AS lojas_alteradas,
           MAX(ps.updated_at) AS ts
    FROM s JOIN public.bling_product_stores ps ON ps.company_id = s.company_id
    WHERE ps.internal_product_id IS NOT NULL
      AND ps.updated_at >= s.started_at AND ps.updated_at <= s.ended_at
    GROUP BY ps.internal_product_id
  ),
  prods AS (
    SELECT bp.id AS pid, bp.updated_at AS ts
    FROM s JOIN public.bling_products bp ON bp.company_id = s.company_id
    WHERE bp.updated_at >= s.started_at AND bp.updated_at <= s.ended_at
  ),
  ids AS (
    SELECT pid, MAX(ts) AS ts FROM (
      SELECT pid, ts FROM prods
      UNION ALL
      SELECT pid, ts FROM stores
    ) u GROUP BY pid
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', bp.id, 'codigo', bp.codigo, 'nome', bp.nome,
    'preco', bp.preco, 'estoque', bp.estoque,
    'situacao', bp.situacao,
    'updated_at', i.ts,
    'lojas_alteradas', COALESCE(st.lojas_alteradas, 0)
  ) ORDER BY i.ts DESC), '[]'::jsonb)
  FROM ids i
  JOIN public.bling_products bp ON bp.id = i.pid
  LEFT JOIN stores st ON st.pid = i.pid);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.list_products_without_stores(_company_id uuid, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS TABLE(bling_product_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 RETURN QUERY SELECT * FROM public.list_products_without_stores(_company_id, _limit, _offset, NULL::text);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_bling_stores_job_cursor(_job_id uuid, _cursor text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 
  UPDATE public.bling_store_sync_jobs SET bling_product_id = _cursor WHERE id = _job_id;

END;
$function$
;
CREATE OR REPLACE FUNCTION public.list_products_without_stores(_company_id uuid, _limit integer DEFAULT 50, _offset integer DEFAULT 0, _after text DEFAULT NULL::text)
 RETURNS TABLE(bling_product_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 RETURN QUERY SELECT p.bling_product_id
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND p.bling_product_id IS NOT NULL
    AND (_after IS NULL OR p.bling_product_id > _after)
    AND NOT EXISTS (
      SELECT 1 FROM public.bling_product_stores s
      WHERE s.company_id = _company_id AND s.is_linked AND s.internal_product_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bling_product_stores s2
      WHERE s2.company_id = _company_id AND s2.is_linked AND s2.bling_product_id = p.bling_product_id
    )
  ORDER BY p.bling_product_id
  LIMIT GREATEST(_limit, 0) OFFSET GREATEST(_offset, 0);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.audit_price_policy(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  _pricing pricing_settings%ROWTYPE;
  _default_comissao numeric;
  _no_default_marketplace boolean := false;
  _total int := 0;
  _avaliados int := 0;
  _ok int := 0;
  _diverg int := 0;
  _sem_base int := 0;
  _items jsonb;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT * INTO _pricing FROM public.pricing_settings WHERE company_id = _company_id;

  SELECT m.taxa_percent INTO _default_comissao
  FROM public.bling_stores bs
  JOIN public.marketplaces m ON m.id = bs.marketplace_id
  WHERE bs.company_id = _company_id AND bs.is_default = true
  LIMIT 1;

  IF _default_comissao IS NULL AND _pricing.default_marketplace_id IS NOT NULL THEN
    SELECT taxa_percent INTO _default_comissao
    FROM public.marketplaces WHERE id = _pricing.default_marketplace_id;
  END IF;
  IF _default_comissao IS NULL THEN _no_default_marketplace := true; END IF;

  CREATE TEMP TABLE _audit_work ON COMMIT DROP AS
  WITH prods AS (
    SELECT p.id, p.codigo AS sku, p.nome, p.preco AS preco_atual,
           upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix,
           btrim(substring(p.codigo from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
  ),
  mapped AS (
    SELECT pr.*, public.map_supplier_prefix(prefix) AS sup_codigo
    FROM prods pr
  ),
  joined AS (
    SELECT m.*, s.id AS sup_id,
      s.preco_embalagem AS sup_emb, s.preco_transporte AS sup_transp,
      s.taxa_devolucao AS sup_devol, s.taxa_promocao AS sup_promo,
      COALESCE(
        NULLIF((fp.precos->>'PR')::numeric, 0),
        NULLIF((fp.precos->>'base')::numeric, 0),
        NULLIF((fp.precos->>'dropshipping')::numeric, 0),
        NULLIF((fp.precos->>'crossdocking')::numeric, 0)
      ) AS fp_preco
    FROM mapped m
    LEFT JOIN public.fornecedores s ON s.codigo = m.sup_codigo
    LEFT JOIN public.fornecedor_produtos fp
      ON fp.fornecedor_id = s.id AND btrim(fp.codigo) = m.num_code AND m.num_code <> ''
  ),
  calc AS (
    SELECT j.*, (
      COALESCE(j.fp_preco, 0)
      + COALESCE(j.sup_emb, COALESCE(_pricing.embalagem_default, 0))
      + COALESCE(j.sup_transp, COALESCE(_pricing.transporte_default, 0))
      + CASE WHEN COALESCE(_pricing.taxa_operacional_valor, 0) > 0
              AND COALESCE(j.fp_preco, 0) >= COALESCE(_pricing.taxa_operacional_min_custo, 0)
             THEN _pricing.taxa_operacional_valor ELSE 0 END
    ) AS cmv_base
    FROM joined j
  ),
  calc2 AS (
    SELECT c.*, (c.cmv_base * (1 + COALESCE(_pricing.frete_medio_percent, 0)/100)) AS cmv_total FROM calc c
  ),
  calc3 AS (
    SELECT c.*, (
      c.cmv_total
      + c.cmv_total * COALESCE(_pricing.custo_fixo_percent, 0)/100
      + c.cmv_total * COALESCE(_pricing.devolucao_percent, 0)/100
    ) AS custo_completo
    FROM calc2 c
  )
  SELECT c.id, c.sku, c.nome, c.preco_atual,
    CASE
      WHEN _no_default_marketplace THEN NULL
      WHEN c.sup_id IS NULL THEN NULL
      WHEN c.fp_preco IS NULL OR c.fp_preco <= 0 THEN NULL
      ELSE public._apply_price_anchor(
        public._compute_sale_price(
          c.custo_completo,
          COALESCE(_default_comissao, 0),
          COALESCE(c.sup_devol, 0),
          COALESCE(c.sup_promo, 0),
          COALESCE(_pricing.profit_bands, '[]'::jsonb)
        ),
        COALESCE(_pricing.price_anchors, '[]'::jsonb)
      )
    END AS preco_esperado
  FROM calc3 c;

  SELECT
    count(*),
    count(*) FILTER (WHERE preco_esperado IS NOT NULL),
    count(*) FILTER (WHERE preco_esperado IS NOT NULL AND abs(COALESCE(preco_atual, -1) - preco_esperado) <= 0.005),
    count(*) FILTER (WHERE preco_esperado IS NOT NULL AND abs(COALESCE(preco_atual, -1) - preco_esperado) > 0.005),
    count(*) FILTER (WHERE preco_esperado IS NULL)
  INTO _total, _avaliados, _ok, _diverg, _sem_base
  FROM _audit_work;

  SELECT jsonb_agg(row_to_json(t)) INTO _items FROM (
    SELECT sku, nome, preco_atual, preco_esperado,
           round((COALESCE(preco_atual,0) - preco_esperado)::numeric, 2) AS diferenca
    FROM _audit_work
    WHERE preco_esperado IS NOT NULL
      AND abs(COALESCE(preco_atual, -1) - preco_esperado) > 0.005
    ORDER BY abs(COALESCE(preco_atual, 0) - preco_esperado) DESC
    LIMIT GREATEST(1, COALESCE(_limit, 100))
  ) t;

  RETURN jsonb_build_object(
    'total', _total,
    'avaliados', _avaliados,
    'ok', _ok,
    'divergentes', _diverg,
    'sem_base', _sem_base,
    'no_default_marketplace', _no_default_marketplace,
    'items', COALESCE(_items, '[]'::jsonb)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.request_cancel_bling_stores_sync(_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  WITH upd AS (
    UPDATE public.bling_store_sync_jobs
       SET cancel_requested = true,
           status = 'cancelada',
           finished_at = now(),
           last_error = COALESCE(last_error, 'Cancelado pelo usuário.')
     WHERE id = _job_id
       AND status IN ('pendente','processando','cancelando','retomando','catalogando')
    RETURNING 1
  ) SELECT count(*) INTO _n FROM upd;
  RETURN _n > 0;
END; $function$
;
CREATE OR REPLACE FUNCTION public.prune_old_operational_data()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  DELETE FROM public.product_sheet_rows r
  USING public.import_batches b
  WHERE r.batch_id = b.id AND b.created_at < now() - interval '2 days';

  DELETE FROM public.audit_results a
  WHERE a.run_id IN (SELECT id FROM public.audit_runs WHERE created_at < now() - interval '3 days');

  DELETE FROM public.bling_api_calls WHERE created_at < now() - interval '3 days';

  DELETE FROM public.bling_push_queue
  WHERE status IN ('concluido','cancelado')
    AND COALESCE(processed_at, updated_at, created_at) < now() - interval '2 days';

  DELETE FROM public.bling_api_usage_daily WHERE dia < (now() AT TIME ZONE 'America/Sao_Paulo')::date - 60;

  -- respostas do pg_net: só interessam por alguns minutos
  BEGIN
    DELETE FROM net._http_response WHERE created < now() - interval '10 minutes';
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    NULL;
  END;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.automation_update_stock_only(_company_id uuid, _run_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  _total integer := 0;
  _found integer := 0;
  _no_supplier integer := 0;
  _stock_updated integer := 0;
  _via_ml integer := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  DROP TABLE IF EXISTS pg_temp._stock_work;
  CREATE TEMP TABLE _stock_work ON COMMIT DROP AS
  WITH mapped AS (
    SELECT p.id, p.codigo AS sku, p.nome, p.estoque AS estoque_atual,
      public.map_supplier_prefix(upper(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+'))) AS sup_codigo,
      btrim(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
  )
  SELECT m.id, m.sku, m.nome, m.estoque_atual, m.sup_codigo,
    f.id AS fornecedor_id,
    CASE
      WHEN fp.qt_estoque IS NULL THEN NULL
      WHEN EXISTS (
             SELECT 1 FROM public.ml_product_matches mm
             WHERE mm.sku = m.sku AND mm.qualifies IS TRUE
           )
        THEN GREATEST(
          CASE
            WHEN COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default) IS NOT NULL
              THEN LEAST(fp.qt_estoque, COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default))
            ELSE fp.qt_estoque
          END, 4)
      WHEN COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default) IS NOT NULL
        THEN LEAST(fp.qt_estoque, COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default))
      ELSE fp.qt_estoque
    END AS estoque_novo,
    (fp.qt_estoque IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.ml_product_matches mm
             WHERE mm.sku = m.sku AND mm.qualifies IS TRUE
           ) AND (CASE
            WHEN COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default) IS NOT NULL
              THEN LEAST(fp.qt_estoque, COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default))
            ELSE fp.qt_estoque
          END) < 4) AS via_ml
  FROM mapped m
  LEFT JOIN public.fornecedores f
    ON f.codigo = m.sup_codigo AND (f.company_id IS NULL OR f.company_id = _company_id)
  LEFT JOIN public.fornecedor_produtos fp
    ON fp.fornecedor_id = f.id AND btrim(fp.codigo) = m.num_code AND m.num_code <> ''
  LEFT JOIN public.product_cost_overrides ov
    ON ov.product_id = m.id AND ov.company_id = _company_id
  LEFT JOIN public.pricing_settings ps ON ps.company_id = _company_id;

  SELECT count(*) INTO _via_ml FROM _stock_work
   WHERE fornecedor_id IS NOT NULL AND estoque_novo IS NOT NULL
     AND via_ml AND estoque_atual IS DISTINCT FROM estoque_novo;

  SELECT count(*),
         count(*) FILTER (WHERE fornecedor_id IS NOT NULL AND estoque_novo IS NOT NULL),
         count(*) FILTER (WHERE sup_codigo IS NULL OR fornecedor_id IS NULL OR estoque_novo IS NULL),
         count(*) FILTER (WHERE fornecedor_id IS NOT NULL AND estoque_novo IS NOT NULL
                          AND estoque_atual IS DISTINCT FROM estoque_novo)
    INTO _total, _found, _no_supplier, _stock_updated
  FROM _stock_work;

  IF _run_id IS NOT NULL THEN
    INSERT INTO public.automation_changes
      (run_id, company_id, product_id, sku, nome, tipo, valor_anterior, valor_novo)
    SELECT _run_id, _company_id, w.id, w.sku, w.nome,
           CASE WHEN w.via_ml THEN 'estoque_ml' ELSE 'estoque' END,
           w.estoque_atual::text, w.estoque_novo::text
    FROM _stock_work w
    WHERE w.fornecedor_id IS NOT NULL AND w.estoque_novo IS NOT NULL
      AND w.estoque_atual IS DISTINCT FROM w.estoque_novo;
  END IF;

  UPDATE public.bling_products bp
     SET estoque = w.estoque_novo,
         dirty = true,
         updated_at = now()
    FROM _stock_work w
   WHERE bp.id = w.id
     AND w.fornecedor_id IS NOT NULL
     AND w.estoque_novo IS NOT NULL
     AND bp.estoque IS DISTINCT FROM w.estoque_novo;

  RETURN jsonb_build_object(
    'total', _total,
    'estoque_via_ml', _via_ml,
    'encontrados', _found,
    'sem_fornecedor', _no_supplier,
    'estoque_atualizado', _stock_updated,
    'preco_atualizado', 0,
    'preco_e_estoque_atualizados', 0,
    'stores_updated', 0,
    'items', '[]'::jsonb
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.start_stock_sync_audit(_company_id uuid, _user_id uuid, _pct numeric DEFAULT 10)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_run_id uuid;
  v_total_com integer;
  v_total_zero integer;
  v_take_com integer;
  v_take_zero integer;
  v_total integer;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  select count(*) into v_total_com
  from bling_products
  where company_id = _company_id and bling_product_id is not null and coalesce(estoque, 0) > 0;

  select count(*) into v_total_zero
  from bling_products
  where company_id = _company_id and bling_product_id is not null and coalesce(estoque, 0) <= 0;

  v_take_com := greatest(case when v_total_com > 0 then ceil(v_total_com * _pct / 100.0)::int else 0 end, case when v_total_com > 0 then 1 else 0 end);
  v_take_zero := greatest(case when v_total_zero > 0 then ceil(v_total_zero * _pct / 100.0)::int else 0 end, case when v_total_zero > 0 then 1 else 0 end);

  insert into stock_audit_runs (company_id, user_id, sample_pct, status)
  values (_company_id, _user_id, _pct, 'processando')
  returning id into v_run_id;

  insert into stock_audit_items (run_id, company_id, product_id, bling_product_id, codigo, nome, bucket, estoque_local)
  select v_run_id, _company_id, p.id, p.bling_product_id, p.codigo, p.nome, 'com_estoque', coalesce(p.estoque, 0)
  from (
    select id, bling_product_id, codigo, nome, estoque
    from bling_products
    where company_id = _company_id and bling_product_id is not null and coalesce(estoque, 0) > 0
    order by random()
    limit v_take_com
  ) p;

  insert into stock_audit_items (run_id, company_id, product_id, bling_product_id, codigo, nome, bucket, estoque_local)
  select v_run_id, _company_id, p.id, p.bling_product_id, p.codigo, p.nome, 'zerado', coalesce(p.estoque, 0)
  from (
    select id, bling_product_id, codigo, nome, estoque
    from bling_products
    where company_id = _company_id and bling_product_id is not null and coalesce(estoque, 0) <= 0
    order by random()
    limit v_take_zero
  ) p;

  select count(*) into v_total from stock_audit_items where run_id = v_run_id;

  update stock_audit_runs
  set total_products = v_total,
      status = case when v_total = 0 then 'concluida' else 'processando' end,
      finished_at = case when v_total = 0 then now() else null end
  where id = v_run_id;

  return json_build_object('run_id', v_run_id, 'total', v_total, 'com_estoque', v_take_com, 'zerados', v_take_zero);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.count_cross_company_import_candidates(_target_company uuid, _other_companies uuid[], _search text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 RETURN (select count(*)::int from (
    select distinct btrim(p.codigo) cod
    from public.bling_products p
    where p.company_id = any(_other_companies)
      and p.last_audit_at is not null
      and p.last_audit_errors = 0
      and p.last_audit_warnings = 0
      and p.codigo is not null and btrim(p.codigo) <> ''
      and upper(coalesce(p.situacao,'')) like 'A%'
      and coalesce(p.descricao_curta,'') ~* 'garantia'
      and coalesce(p.descricao_curta,'') ~* 'anatel'
      and coalesce(p.descricao_curta,'') ~* 'anvisa'
      and (_search is null or _search = '' or p.codigo ilike '%'||_search||'%' or p.nome ilike '%'||_search||'%')
      and not exists (
        select 1 from public.bling_products d
        where d.company_id = _target_company and btrim(d.codigo) = btrim(p.codigo)
      )
  ) t);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ml_account_sku_total(_company_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 RETURN (select count(distinct codigo)::int
  from public.bling_products
  where company_id = any(_company_ids)
    and codigo is not null
    and codigo <> '');
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ml_bump_progress(_job_id uuid, _processed integer, _found integer, _full integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 
  update public.ml_map_jobs
     set processed = coalesce(processed,0) + coalesce(_processed,0),
         found_count = coalesce(found_count,0) + coalesce(_found,0),
         full_count = coalesce(full_count,0) + coalesce(_full,0),
         updated_at = now()
   where id = _job_id;

END;
$function$
;
CREATE OR REPLACE FUNCTION public.ml_claim_batch(_job_id uuid, _limit integer)
 RETURNS TABLE(id uuid, company_id uuid, codigo text, nome text, gtin text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _cur uuid;
  _ids uuid[];
  _last uuid;
  rec record;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  select j.cursor_id, coalesce(j.company_ids, array[j.company_id])
    into _cur, _ids
  from public.ml_map_jobs j
  where j.id = _job_id
  for update;

  if _ids is null then
    return;
  end if;

  for rec in
    select p.id, p.company_id, p.codigo, p.nome, p.gtin
    from public.bling_products p
    where p.company_id = any(_ids)
      and (_cur is null or p.id > _cur)
    order by p.id
    limit greatest(_limit, 1)
  loop
    id := rec.id;
    company_id := rec.company_id;
    codigo := rec.codigo;
    nome := rec.nome;
    gtin := rec.gtin;
    _last := rec.id;
    return next;
  end loop;

  if _last is not null then
    update public.ml_map_jobs
       set cursor_id = _last, updated_at = now()
     where ml_map_jobs.id = _job_id;
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.suggest_ncm_cest(_titulo text, _marca text DEFAULT NULL::text)
 RETURNS TABLE(ncm text, cest text, score numeric, amostras integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 RETURN QUERY with base as (
    select p.ncm, p.cest, similarity(p.nome, _titulo) as s
    from public.bling_products p
    where p.ncm is not null and p.ncm <> ''
      and _titulo is not null and length(_titulo) > 5
      and p.nome % _titulo
    order by similarity(p.nome, _titulo) desc
    limit 40
  ),
  agg as (
    select b.ncm,
           max(b.s) as score,
           count(*)::int as amostras,
           (array_agg(b.cest order by (b.cest is null), b.s desc))[1] as cest
    from base b
    group by b.ncm
  )
  select a.ncm, a.cest, round(a.score::numeric, 3), a.amostras
  from agg a
  order by a.amostras desc, a.score desc
  limit 1;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.resume_ai_transform_job(_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ai_transform_jobs j
    JOIN public.company_users cu ON cu.company_id = j.company_id
    WHERE j.id = _job_id AND cu.user_id = auth.uid() AND cu.ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  UPDATE public.ai_transform_jobs
     SET status = 'pendente', last_error = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE id = _job_id AND status IN ('pausado_creditos', 'pausado_limite', 'erro');
  RETURN true;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.cancel_ai_transform_job(_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ai_transform_jobs j
    JOIN public.company_users cu ON cu.company_id = j.company_id
    WHERE j.id = _job_id AND cu.user_id = auth.uid() AND cu.ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  UPDATE public.ai_transform_jobs
     SET status = 'cancelado', finished_at = now(), lease_expires_at = NULL, updated_at = now()
   WHERE id = _job_id AND status NOT IN ('concluido', 'cancelado');

  DELETE FROM public.ai_transform_job_items WHERE job_id = _job_id AND status = 'pendente';
  RETURN true;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enqueue_ai_transform_job(_company_id uuid, _kind text, _product_ids uuid[], _params jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  _job_id uuid;
  _total int := 0;
  _existing uuid;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  IF _product_ids IS NULL OR array_length(_product_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('job_id', NULL, 'total', 0, 'reused', false);
  END IF;

  -- Uma tarefa ativa por empresa+tipo: acrescenta produtos na existente.
  SELECT id INTO _existing
  FROM public.ai_transform_jobs
  WHERE company_id = _company_id
    AND kind = _kind
    AND status IN ('pendente', 'executando', 'pausado_creditos', 'pausado_limite')
  ORDER BY created_at
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    _job_id := _existing;
  ELSE
    INSERT INTO public.ai_transform_jobs (company_id, user_id, kind, params, status)
    VALUES (_company_id, auth.uid(), _kind, COALESCE(_params, '{}'::jsonb), 'pendente')
    RETURNING id INTO _job_id;
  END IF;

  WITH ins AS (
    INSERT INTO public.ai_transform_job_items (job_id, company_id, product_id)
    SELECT _job_id, _company_id, p.id
    FROM public.bling_products p
    WHERE p.company_id = _company_id AND p.id = ANY(_product_ids)
    ON CONFLICT (job_id, product_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _total FROM ins;

  UPDATE public.ai_transform_jobs
     SET total = total + _total,
         status = CASE WHEN status IN ('pausado_creditos', 'pausado_limite') THEN status ELSE 'pendente' END,
         params = CASE WHEN _existing IS NULL THEN params ELSE params || COALESCE(_params, '{}'::jsonb) END,
         finished_at = NULL,
         updated_at = now()
   WHERE id = _job_id;

  RETURN jsonb_build_object('job_id', _job_id, 'total', _total, 'reused', _existing IS NOT NULL);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enqueue_bling_inativar(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  _integration_id uuid;
  _enqueued integer := 0;
  _skipped integer := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT id INTO _integration_id
  FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada'
  LIMIT 1;

  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada.';
  END IF;

  SELECT count(*) INTO _skipped
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
    AND (p.bling_product_id IS NULL OR p.bling_product_id = '');

  WITH alvo AS (
    SELECT p.id, p.bling_product_id
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
      AND p.bling_product_id IS NOT NULL
      AND p.bling_product_id <> ''
      AND upper(COALESCE(p.situacao, 'A')) IN ('A', 'ATIVO')
  ), ins AS (
    INSERT INTO public.bling_push_queue
      (company_id, integration_id, product_id, bling_product_id, tipo, valor_novo, status)
    SELECT _company_id, _integration_id, a.id, a.bling_product_id, 'inativar', 0, 'pendente'
    FROM alvo a
    ON CONFLICT DO NOTHING
    RETURNING product_id
  )
  SELECT count(*) INTO _enqueued FROM ins;

  UPDATE public.bling_products p
  SET situacao = 'Inativo', updated_at = now()
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
    AND p.bling_product_id IS NOT NULL
    AND p.bling_product_id <> ''
    AND upper(COALESCE(p.situacao, 'A')) IN ('A', 'ATIVO');

  RETURN jsonb_build_object('enqueued', _enqueued, 'skipped', _skipped, 'integration_id', _integration_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_remove_invalid_image_urls(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated int := 0;
  v_removed_total bigint := 0;
  r record;
  arr text[];
  kept text[];
  new_val text;
  removed int;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  FOR r IN
    SELECT id, url_imagens_externas
    FROM public.bling_products
    WHERE company_id = _company_id
      AND (_product_ids IS NULL OR id = ANY(_product_ids))
      AND url_imagens_externas IS NOT NULL
      AND url_imagens_externas <> ''
  LOOP
    arr := ARRAY(
      SELECT btrim(u)
      FROM regexp_split_to_table(r.url_imagens_externas, E'[|\n\r]+') AS u
      WHERE btrim(u) <> ''
    );
    IF array_length(arr, 1) IS NULL THEN
      CONTINUE;
    END IF;

    kept := ARRAY(
      SELECT u
      FROM unnest(arr) AS u
      -- ignora query string (?) e âncora (#) ao checar a extensão
      WHERE split_part(split_part(u, '?', 1), '#', 1) ~* '\.(png|jpe?g)$'
    );

    removed := array_length(arr, 1) - COALESCE(array_length(kept, 1), 0);
    IF removed <= 0 THEN
      CONTINUE;
    END IF;

    new_val := COALESCE(array_to_string(kept, '|'), '');

    UPDATE public.bling_products
    SET url_imagens_externas = new_val,
        dirty = true,
        updated_at = now()
    WHERE id = r.id;

    v_updated := v_updated + 1;
    v_removed_total := v_removed_total + removed;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'removed', v_removed_total);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.pause_bling_stores_sync(_company_id uuid, _job_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
     WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH upd AS (
    UPDATE public.bling_store_sync_jobs
       SET status = 'pausada',
           claimed_at = NULL,
           cancel_requested = false,
           last_error = 'Pausado pelo usuário.'
     WHERE company_id = _company_id
       AND (_job_id IS NULL OR id = _job_id)
       AND status IN ('pendente','processando','cancelando','retomando','catalogando')
    RETURNING 1
  ) SELECT count(*) INTO _n FROM upd;

  RETURN jsonb_build_object('paused', _n);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.unpause_bling_stores_sync(_company_id uuid, _job_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int := 0; _id uuid;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
     WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH upd AS (
    UPDATE public.bling_store_sync_jobs
       SET status = 'pendente',
           cancel_requested = false,
           claimed_at = NULL,
           finished_at = NULL,
           last_error = NULL
     WHERE company_id = _company_id
       AND (_job_id IS NULL OR id = _job_id)
       AND status = 'pausada'
    RETURNING id
  ) SELECT count(*), min(id) INTO _n, _id FROM upd;

  RETURN jsonb_build_object('resumed', _n, 'job_id', _id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_update_anatel_code(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE _updated int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH src AS (
    SELECT p.id,
           COALESCE(p.descricao_curta,'') AS desc_atual,
           public.anatel_code_for(p.codigo, p.gtin) AS anatel_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
  ),
  final AS (
    SELECT id,
      CASE
        -- já existe "Código Anatel: ..." -> troca apenas o valor
        WHEN desc_atual ~* 'C[oó]digo\s+Anatel\s*:' THEN
          regexp_replace(desc_atual, '(C[oó]digo\s+Anatel\s*:\s*)[^\n\r|]*',
                         '\1' || anatel_code, 'gi')
        -- descrição vazia -> só o campo da Anatel
        WHEN btrim(desc_atual) = '' THEN
          format('Código Anatel: %s', anatel_code)
        -- já existe bloco Garantia/Anvisa na última linha -> anexa com separador " | "
        WHEN (regexp_replace(desc_atual, '^.*(\n|\r)', '')) ~* '(Garantia\s*:|Anvisa\s*:)' THEN
          btrim(desc_atual) || format(' | Código Anatel: %s', anatel_code)
        ELSE
          btrim(desc_atual) || E'\n\n' || format('Código Anatel: %s', anatel_code)
      END AS nova_desc
    FROM src
  ),
  upd AS (
    UPDATE public.bling_products bp
       SET descricao_curta = f.nova_desc,
           dirty = true,
           updated_at = now()
      FROM final f
     WHERE bp.id = f.id
       AND COALESCE(bp.descricao_curta,'') <> f.nova_desc
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM upd;

  RETURN jsonb_build_object('updated', _updated);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_fill_garantia_anatel(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE _updated int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH src AS (
    SELECT p.id,
           COALESCE(p.descricao_curta,'') AS desc_atual,
           public.anatel_code_for(p.codigo, p.gtin) AS anatel_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
  ),
  cleaned AS (
    SELECT id,
      btrim(
        -- limpa sobras de separadores e linhas vazias
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(desc_atual,
                    -- campos com dois-pontos, em qualquer posição
                    '(Anvisa|Garantia|C[oó]digo\s+Anatel|Anatel)\s*:[^\n\r|.]*\.?', '', 'gi'),
                  -- "Garantia de 3 meses" / "Garantia 12 meses" (sem dois-pontos)
                  'Garantia\s+(de\s+)?[0-9]+\s*(meses|mes|m[êe]s|anos|ano)[^\n\r|.]*\.?', '', 'gi'),
                -- separadores duplicados/soltos
                '[ \t]*\|[ \t]*(\|[ \t]*)+', ' | ', 'g'),
              '(^|\n)[ \t]*\|[ \t]*', E'\\1', 'g'),
            '[ \t]*\|[ \t]*($|\n)', E'\\1', 'g'),
          '(\r?\n)[ \t]*(\r?\n[ \t]*)+', E'\n\n', 'g')
      ) AS base,
      anatel_code
    FROM src
  ),
  final AS (
    SELECT id,
      CASE
        WHEN base = '' THEN
          format('Garantia: 3 meses | Código Anatel: %s | Anvisa: Isento', anatel_code)
        ELSE
          base || E'\n\n' || format('Garantia: 3 meses | Código Anatel: %s | Anvisa: Isento', anatel_code)
      END AS nova_desc
    FROM cleaned
  ),
  upd AS (
    UPDATE public.bling_products bp
       SET descricao_curta = f.nova_desc,
           dirty = true,
           updated_at = now()
      FROM final f
     WHERE bp.id = f.id
       AND COALESCE(bp.descricao_curta,'') <> f.nova_desc
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM upd;

  RETURN jsonb_build_object('updated', _updated);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ml_prospect_claim(_job_id uuid, _limit integer)
 RETURNS TABLE(id bigint, catalog_product_id text, source text, source_label text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  return query
  with pick as (
    select c.id from public.ml_prospect_candidates c
    where c.job_id = _job_id and c.status = 'pendente'
    order by c.id limit greatest(_limit, 1) for update skip locked
  )
  update public.ml_prospect_candidates c
     set status = 'processando'
    from pick where c.id = pick.id
  returning c.id, c.catalog_product_id, c.source, c.source_label;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_set_stock(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[], _value numeric DEFAULT 0, _limit integer DEFAULT 250)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '20s'
AS $function$
DECLARE
  v_updated integer := 0;
  v_has_more boolean := false;
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 250), 1), 500);
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF _value IS NULL OR _value < 0 THEN
    RAISE EXCEPTION 'invalid stock value';
  END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH target AS (
    SELECT p.id
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
      AND p.estoque IS DISTINCT FROM _value
    ORDER BY p.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.bling_products p
  SET estoque = _value, updated_at = now()
  FROM target
  WHERE p.id = target.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT EXISTS (
    SELECT 1
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
      AND p.estoque IS DISTINCT FROM _value
  ) INTO v_has_more;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'value', _value,
    'has_more', v_has_more
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ml_refresh_lease(_minutes integer DEFAULT 2)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ok boolean;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  update public.ml_refresh_state
     set lease_until = now() + make_interval(mins => greatest(_minutes,1)),
         last_started_at = now()
   where singleton and lease_until < now()
  returning true into ok;
  return coalesce(ok,false);
end $function$
;
CREATE OR REPLACE FUNCTION public.ml_refresh_release()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 
  update public.ml_refresh_state
     set lease_until = now() - interval '1 minute', last_finished_at = now()
   where singleton;

END;
$function$
;
CREATE OR REPLACE FUNCTION public.match_store_code_sheet(_company_id uuid, _rows jsonb)
 RETURNS TABLE(linha integer, sku text, bling_store_id text, codigo_novo text, product_id uuid, bling_product_id text, bling_product_store_id text, store_name text, codigo_atual text, preco numeric, preco_promocional numeric, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
 RETURN QUERY WITH src AS (
    SELECT
      (ord)::int AS linha,
      upper(btrim(coalesce(r->>'sku', ''))) AS sku,
      btrim(coalesce(r->>'bling_store_id', '')) AS bling_store_id,
      btrim(coalesce(r->>'codigo', '')) AS codigo_novo
    FROM jsonb_array_elements(coalesce(_rows, '[]'::jsonb)) WITH ORDINALITY AS t(r, ord)
  ), joined AS (
    SELECT
      s.*,
      p.id AS product_id,
      p.bling_product_id,
      bps.bling_product_store_id,
      bps.store_name,
      bps.store_product_code AS codigo_atual,
      coalesce(bps.current_price, p.preco) AS preco,
      bps.current_promotional_price AS preco_promocional
    FROM src s
    LEFT JOIN public.bling_products p
      ON p.company_id = _company_id
     AND upper(btrim(p.codigo)) = s.sku
    LEFT JOIN public.bling_product_stores bps
      ON bps.company_id = _company_id
     AND bps.internal_product_id = p.id
     AND bps.bling_store_id = s.bling_store_id
     AND bps.is_linked = true
  )
  SELECT
    linha, sku, bling_store_id, codigo_novo, product_id, bling_product_id,
    bling_product_store_id, store_name, codigo_atual, preco, preco_promocional,
    CASE
      WHEN sku = '' OR bling_store_id = '' OR codigo_novo = '' THEN 'dados_invalidos'
      WHEN product_id IS NULL THEN 'sku_nao_encontrado'
      WHEN bling_product_store_id IS NULL THEN 'loja_nao_vinculada'
      WHEN nullif(btrim(coalesce(bling_product_id, '')), '') IS NULL THEN 'sem_bling_id'
      WHEN preco IS NULL THEN 'sem_preco'
      WHEN coalesce(codigo_atual, '') = codigo_novo THEN 'ja_atualizado'
      ELSE 'ok'
    END AS status
  FROM joined;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.preview_store_code_sheet(_company_id uuid, _rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  _res jsonb;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH m AS (
    SELECT * FROM public.match_store_code_sheet(_company_id, _rows)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM m),
    'ok', (SELECT count(*) FROM m WHERE status = 'ok'),
    'ja_atualizado', (SELECT count(*) FROM m WHERE status = 'ja_atualizado'),
    'sku_nao_encontrado', (SELECT count(*) FROM m WHERE status = 'sku_nao_encontrado'),
    'loja_nao_vinculada', (SELECT count(*) FROM m WHERE status = 'loja_nao_vinculada'),
    'sem_bling_id', (SELECT count(*) FROM m WHERE status = 'sem_bling_id'),
    'sem_preco', (SELECT count(*) FROM m WHERE status = 'sem_preco'),
    'dados_invalidos', (SELECT count(*) FROM m WHERE status = 'dados_invalidos'),
    'amostra', (
      SELECT coalesce(jsonb_agg(x ORDER BY x->>'linha'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'linha', linha, 'sku', sku, 'bling_store_id', bling_store_id,
          'store_name', store_name, 'codigo_atual', codigo_atual,
          'codigo_novo', codigo_novo, 'status', status
        ) AS x
        FROM m ORDER BY (status <> 'ok'), linha LIMIT 300
      ) s
    )
  ) INTO _res;

  RETURN _res;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.request_cancel_bling_stores_sync(_company_id uuid, _job_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int := 0;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
     WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH upd AS (
    UPDATE public.bling_store_sync_jobs
       SET cancel_requested = true,
           status = 'cancelada',
           finished_at = now(),
           last_error = COALESCE(NULLIF(last_error, 'Pausado pelo usuário.'), 'Cancelado pelo usuário.')
     WHERE company_id = _company_id
       AND (_job_id IS NULL OR id = _job_id)
       AND status IN ('pendente','processando','cancelando','retomando','catalogando','pausada')
    RETURNING 1
  ) SELECT count(*) INTO _n FROM upd;

  RETURN jsonb_build_object('cancelled', _n);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.automation_apply_supplier_status(_company_id uuid, _run_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  _inact uuid[] := '{}';
  _act uuid[] := '{}';
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  CREATE TEMP TABLE _tmp_status ON COMMIT DROP AS
  WITH alvo AS (
    SELECT p.id, p.situacao,
           upper(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+')) AS prefix,
           btrim(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
  ),
  mapped AS (
    SELECT a.*, public.map_supplier_prefix(a.prefix) AS sup_codigo
    FROM alvo a
  )
  SELECT m.id,
         upper(btrim(coalesce(m.situacao, ''))) AS sit,
         fp.id IS NOT NULL AS tem_fornecedor,
         COALESCE(fp.qt_estoque, 0) AS qt_estoque
  FROM mapped m
  LEFT JOIN public.fornecedores f ON f.codigo = m.sup_codigo
    AND (f.company_id IS NULL OR f.company_id = _company_id)
  LEFT JOIN public.fornecedor_produtos fp ON fp.fornecedor_id = f.id
    AND btrim(fp.codigo) = m.num_code;

  WITH upd AS (
    UPDATE public.bling_products bp
    SET situacao = 'I', dirty = true, updated_at = now()
    FROM _tmp_status t
    WHERE bp.id = t.id
      AND t.tem_fornecedor = false
      AND t.sit NOT IN ('I', 'INATIVO')
    RETURNING bp.id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO _inact FROM upd;

  WITH upd2 AS (
    UPDATE public.bling_products bp
    SET situacao = 'A', dirty = true, updated_at = now()
    FROM _tmp_status t
    WHERE bp.id = t.id
      AND t.tem_fornecedor = true
      AND t.qt_estoque > 0
      AND t.sit NOT IN ('A', 'ATIVO')
    RETURNING bp.id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO _act FROM upd2;

  IF _run_id IS NOT NULL THEN
    INSERT INTO public.automation_changes
      (run_id, company_id, product_id, sku, nome, tipo, valor_anterior, valor_novo)
    SELECT _run_id, _company_id, p.id, p.codigo, p.nome, 'inativado', 'Ativo', 'Inativo'
    FROM public.bling_products p WHERE p.id = ANY(_inact);

    INSERT INTO public.automation_changes
      (run_id, company_id, product_id, sku, nome, tipo, valor_anterior, valor_novo)
    SELECT _run_id, _company_id, p.id, p.codigo, p.nome, 'ativado', 'Inativo', 'Ativo'
    FROM public.bling_products p WHERE p.id = ANY(_act);
  END IF;

  RETURN jsonb_build_object(
    'inactivated', COALESCE(array_length(_inact, 1), 0),
    'activated', COALESCE(array_length(_act, 1), 0),
    'inactivate_ids', to_jsonb(_inact),
    'activate_ids', to_jsonb(_act)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transform_update_price_stock(_company_id uuid, _product_ids uuid[] DEFAULT NULL::uuid[], _include_stores boolean DEFAULT false, _run_id uuid DEFAULT NULL::uuid, _only_stock boolean DEFAULT false, _only_price boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  _total int := 0;
  _found int := 0;
  _not_found int := 0;
  _no_supplier int := 0;
  _price_updated int := 0;
  _stock_updated int := 0;
  _both_updated int := 0;
  _unchanged int := 0;
  _stores_updated int := 0;
  _via_ml int := 0;
  _items jsonb;
  _default_comissao numeric;
  _no_default_marketplace boolean := false;
  _pricing pricing_settings%ROWTYPE;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT * INTO _pricing FROM public.pricing_settings WHERE company_id = _company_id;

  SELECT m.taxa_percent INTO _default_comissao
  FROM public.bling_stores bs
  JOIN public.marketplaces m ON m.id = bs.marketplace_id
  WHERE bs.company_id = _company_id AND bs.is_default = true
  LIMIT 1;

  IF _default_comissao IS NULL AND _pricing.default_marketplace_id IS NOT NULL THEN
    SELECT taxa_percent INTO _default_comissao
    FROM public.marketplaces
    WHERE id = _pricing.default_marketplace_id;
  END IF;

  IF _default_comissao IS NULL THEN _no_default_marketplace := true; END IF;

  CREATE TEMP TABLE _work ON COMMIT DROP AS
  WITH prods AS (
    SELECT p.id, p.codigo AS sku, p.nome,
           p.preco AS preco_atual_venda,
           p.preco_custo AS preco_atual,
           p.estoque AS estoque_atual,
           upper(substring(p.codigo from '^[A-Za-z]+')) AS prefix,
           btrim(substring(p.codigo from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
  ),
  mapped AS (
    SELECT pr.*,
      public.map_supplier_prefix(prefix) AS sup_codigo
    FROM prods pr
  ),
  joined AS (
    SELECT m.*,
      s.id AS sup_id, s.nome AS sup_nome,
      s.preco_embalagem AS sup_emb, s.preco_transporte AS sup_transp,
      s.taxa_devolucao AS sup_devol, s.taxa_promocao AS sup_promo,
      s.stock_cap AS sup_stock_cap,
      ov.stock_cap AS ov_stock_cap,
      fp.qt_estoque AS fp_estoque_raw,
      COALESCE(
        NULLIF((fp.precos->>'PR')::numeric, 0),
        NULLIF((fp.precos->>'base')::numeric, 0),
        NULLIF((fp.precos->>'dropshipping')::numeric, 0),
        NULLIF((fp.precos->>'crossdocking')::numeric, 0)
      ) AS fp_preco
    FROM mapped m
    LEFT JOIN public.fornecedores s
      ON s.codigo = m.sup_codigo
    LEFT JOIN public.fornecedor_produtos fp
      ON fp.fornecedor_id = s.id AND btrim(fp.codigo) = m.num_code AND m.num_code <> ''
    LEFT JOIN public.product_cost_overrides ov
      ON ov.product_id = m.id AND ov.company_id = _company_id
  ),
  capped AS (
    SELECT j.*,
      CASE
        WHEN j.fp_estoque_raw IS NULL THEN NULL
        WHEN EXISTS (
               SELECT 1 FROM public.ml_product_matches mm
               WHERE mm.sku = j.sku AND mm.qualifies IS TRUE
             )
          THEN GREATEST(
            CASE
              WHEN COALESCE(j.ov_stock_cap, j.sup_stock_cap, _pricing.stock_cap_default) IS NOT NULL
                THEN LEAST(j.fp_estoque_raw, COALESCE(j.ov_stock_cap, j.sup_stock_cap, _pricing.stock_cap_default))
              ELSE j.fp_estoque_raw
            END, 4)
        WHEN COALESCE(j.ov_stock_cap, j.sup_stock_cap, _pricing.stock_cap_default) IS NOT NULL
          THEN LEAST(j.fp_estoque_raw, COALESCE(j.ov_stock_cap, j.sup_stock_cap, _pricing.stock_cap_default))
        ELSE j.fp_estoque_raw
      END AS fp_estoque,
      (j.fp_estoque_raw IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.ml_product_matches mm
               WHERE mm.sku = j.sku AND mm.qualifies IS TRUE
             ) AND (CASE
              WHEN COALESCE(j.ov_stock_cap, j.sup_stock_cap, _pricing.stock_cap_default) IS NOT NULL
                THEN LEAST(j.fp_estoque_raw, COALESCE(j.ov_stock_cap, j.sup_stock_cap, _pricing.stock_cap_default))
              ELSE j.fp_estoque_raw
            END) < 4) AS via_ml
    FROM joined j
  ),
  calc AS (
    SELECT c.*,
      (
        COALESCE(c.fp_preco, 0)
        + COALESCE(c.sup_emb, COALESCE(_pricing.embalagem_default, 0))
        + COALESCE(c.sup_transp, COALESCE(_pricing.transporte_default, 0))
        + CASE
            WHEN COALESCE(_pricing.taxa_operacional_valor, 0) > 0
             AND COALESCE(c.fp_preco, 0) >= COALESCE(_pricing.taxa_operacional_min_custo, 0)
            THEN _pricing.taxa_operacional_valor ELSE 0 END
      ) AS cmv_base
    FROM capped c
  ),
  calc2 AS (
    SELECT c.*,
      (c.cmv_base * (1 + COALESCE(_pricing.frete_medio_percent, 0)/100)) AS cmv_total
    FROM calc c
  ),
  calc3 AS (
    SELECT c.*,
      (
        c.cmv_total
        + c.cmv_total * COALESCE(_pricing.custo_fixo_percent, 0)/100
        + c.cmv_total * COALESCE(_pricing.devolucao_percent, 0)/100
      ) AS custo_completo
    FROM calc2 c
  ),
  priced AS (
    SELECT c.*,
      CASE
        WHEN _no_default_marketplace THEN NULL
        WHEN c.sup_id IS NULL THEN NULL
        WHEN c.fp_preco IS NULL OR c.fp_preco <= 0 THEN NULL
        ELSE public._apply_price_anchor(
          public._compute_sale_price(
            c.custo_completo,
            COALESCE(_default_comissao, 0),
            COALESCE(c.sup_devol, 0),
            COALESCE(c.sup_promo, 0),
            COALESCE(_pricing.profit_bands, '[]'::jsonb)
          ),
          COALESCE(_pricing.price_anchors, '[]'::jsonb)
        )
      END AS preco_novo_venda
    FROM calc3 c
  )
  SELECT * FROM priced;

  SELECT count(*) INTO _total FROM _work;

  UPDATE public.bling_products bp SET
    preco_custo = CASE
      WHEN NOT _only_stock AND w.fp_preco IS NOT NULL AND (bp.preco_custo IS DISTINCT FROM w.fp_preco)
      THEN w.fp_preco ELSE bp.preco_custo END,
    preco_compra = CASE
      WHEN NOT _only_stock AND w.fp_preco IS NOT NULL AND (bp.preco_compra IS DISTINCT FROM w.fp_preco)
      THEN w.fp_preco ELSE bp.preco_compra END,
    estoque = CASE
      WHEN NOT _only_price AND w.fp_estoque IS NOT NULL AND (bp.estoque IS DISTINCT FROM w.fp_estoque)
      THEN w.fp_estoque ELSE bp.estoque END,
    preco = CASE
      WHEN NOT _only_stock AND w.preco_novo_venda IS NOT NULL AND (bp.preco IS DISTINCT FROM w.preco_novo_venda)
      THEN w.preco_novo_venda ELSE bp.preco END,
    dirty = CASE
      WHEN (NOT _only_stock AND w.fp_preco IS NOT NULL AND bp.preco_custo IS DISTINCT FROM w.fp_preco)
        OR (NOT _only_price AND w.fp_estoque IS NOT NULL AND bp.estoque IS DISTINCT FROM w.fp_estoque)
        OR (NOT _only_stock AND w.preco_novo_venda IS NOT NULL AND bp.preco IS DISTINCT FROM w.preco_novo_venda)
      THEN true ELSE bp.dirty END,
    updated_at = now()
  FROM _work w
  WHERE bp.id = w.id
    AND w.sup_id IS NOT NULL
    AND w.fp_estoque IS NOT NULL;

  IF _run_id IS NOT NULL AND NOT _only_stock THEN
    INSERT INTO public.automation_changes
      (run_id, company_id, product_id, sku, nome, tipo, valor_anterior, valor_novo)
    SELECT _run_id, _company_id, w.id, w.sku, w.nome, 'preco_custo',
           w.preco_atual::text, w.fp_preco::text
    FROM _work w
    WHERE w.sup_id IS NOT NULL AND w.fp_estoque IS NOT NULL
      AND w.fp_preco IS NOT NULL AND w.preco_atual IS DISTINCT FROM w.fp_preco;

    INSERT INTO public.automation_changes
      (run_id, company_id, product_id, sku, nome, tipo, valor_anterior, valor_novo)
    SELECT _run_id, _company_id, w.id, w.sku, w.nome, 'preco_venda',
           w.preco_atual_venda::text, w.preco_novo_venda::text
    FROM _work w
    WHERE w.sup_id IS NOT NULL AND w.fp_estoque IS NOT NULL
      AND w.preco_novo_venda IS NOT NULL AND w.preco_atual_venda IS DISTINCT FROM w.preco_novo_venda;

  END IF;

  IF _run_id IS NOT NULL AND NOT _only_price THEN
    INSERT INTO public.automation_changes
      (run_id, company_id, product_id, sku, nome, tipo, valor_anterior, valor_novo)
    SELECT _run_id, _company_id, w.id, w.sku, w.nome,
           CASE WHEN w.via_ml THEN 'estoque_ml' ELSE 'estoque' END,
           w.estoque_atual::text, w.fp_estoque::text
    FROM _work w
    WHERE w.sup_id IS NOT NULL AND w.fp_estoque IS NOT NULL
      AND w.estoque_atual IS DISTINCT FROM w.fp_estoque;
  END IF;

  IF _include_stores THEN
    WITH s AS (
      SELECT bps.id AS store_row_id, bps.internal_product_id, bps.current_price AS preco_antigo,
             bps.bling_store_id, COALESCE(bs.descricao, bps.store_name) AS loja_nome,
             bs.marketplace_id, m.taxa_percent
      FROM public.bling_product_stores bps
      JOIN public.bling_stores bs ON bs.bling_store_id = bps.bling_store_id AND bs.company_id = bps.company_id
      LEFT JOIN public.marketplaces m ON m.id = bs.marketplace_id
      WHERE bps.company_id = _company_id
        AND bps.internal_product_id IN (SELECT id FROM _work WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL)
    ),
    calc_store AS (
      SELECT s.store_row_id, s.internal_product_id, s.preco_antigo, s.bling_store_id, s.loja_nome,
        w.sku, w.nome, COALESCE(w.sup_promo, 0) AS sup_promo,
        public._apply_price_anchor(
          public._compute_sale_price(
            w.custo_completo,
            COALESCE(s.taxa_percent, _default_comissao, 0),
            COALESCE(w.sup_devol, 0),
            COALESCE(w.sup_promo, 0),
            COALESCE(_pricing.profit_bands, '[]'::jsonb)
          ),
          COALESCE(_pricing.price_anchors, '[]'::jsonb)
        ) AS preco_novo_loja
      FROM s
      JOIN _work w ON w.id = s.internal_product_id
      WHERE w.fp_preco IS NOT NULL AND w.fp_preco > 0
    ),
    calc_store2 AS (
      SELECT cs.*,
        CASE WHEN cs.preco_novo_loja IS NULL THEN NULL
             ELSE round((cs.preco_novo_loja * (1 - COALESCE(cs.sup_promo, 0)/100))::numeric, 2)
        END AS preco_promo_loja
      FROM calc_store cs
    ),
    log AS (
      INSERT INTO public.automation_changes
        (run_id, company_id, product_id, sku, nome, tipo, loja_id, loja_nome, valor_anterior, valor_novo)
      SELECT _run_id, _company_id, cs.internal_product_id, cs.sku, cs.nome, 'preco_loja',
             cs.bling_store_id, cs.loja_nome, cs.preco_antigo::text, cs.preco_novo_loja::text
      FROM calc_store2 cs
      WHERE _run_id IS NOT NULL
        AND cs.preco_novo_loja IS NOT NULL
        AND cs.preco_antigo IS DISTINCT FROM cs.preco_novo_loja
      RETURNING 1
    ),
    upd_stores AS (
      UPDATE public.bling_product_stores bps SET
        current_price = cs.preco_novo_loja,
        current_promotional_price = cs.preco_promo_loja,
        updated_at = now()
      FROM calc_store2 cs
      WHERE bps.id = cs.store_row_id
        AND cs.preco_novo_loja IS NOT NULL
        AND (bps.current_price IS DISTINCT FROM cs.preco_novo_loja
             OR bps.current_promotional_price IS DISTINCT FROM cs.preco_promo_loja)
      RETURNING 1
    )
    SELECT count(*) INTO _stores_updated FROM upd_stores;
  END IF;

  SELECT
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL),
    count(*) FILTER (WHERE sup_codigo IS NOT NULL AND (sup_id IS NULL OR fp_estoque IS NULL)),
    count(*) FILTER (WHERE sup_codigo IS NULL),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND ((fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco) OR (preco_novo_venda IS NOT NULL AND preco_atual_venda IS DISTINCT FROM preco_novo_venda))
        AND (estoque_atual IS NOT DISTINCT FROM fp_estoque)),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND estoque_atual IS DISTINCT FROM fp_estoque
        AND ((fp_preco IS NULL OR preco_atual IS NOT DISTINCT FROM fp_preco) AND (preco_novo_venda IS NULL OR preco_atual_venda IS NOT DISTINCT FROM preco_novo_venda))),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND ((fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco) OR (preco_novo_venda IS NOT NULL AND preco_atual_venda IS DISTINCT FROM preco_novo_venda))
        AND estoque_atual IS DISTINCT FROM fp_estoque),
    count(*) FILTER (WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
        AND ((fp_preco IS NULL OR preco_atual IS NOT DISTINCT FROM fp_preco) AND (preco_novo_venda IS NULL OR preco_atual_venda IS NOT DISTINCT FROM preco_novo_venda))
        AND estoque_atual IS NOT DISTINCT FROM fp_estoque)
  INTO _found, _not_found, _no_supplier, _price_updated, _stock_updated, _both_updated, _unchanged
  FROM _work;

  IF _only_price THEN
    _price_updated := _price_updated + _both_updated;
    _unchanged := _unchanged + _stock_updated;
    _stock_updated := 0;
    _both_updated := 0;
  END IF;

  IF _only_stock THEN
    _stock_updated := _stock_updated + _both_updated;
    _unchanged := _unchanged + _price_updated;
    _price_updated := 0;
    _both_updated := 0;
  END IF;

  SELECT count(*) INTO _via_ml FROM _work
   WHERE sup_id IS NOT NULL AND fp_estoque IS NOT NULL
     AND via_ml AND estoque_atual IS DISTINCT FROM fp_estoque;

  SELECT jsonb_agg(row_to_json(t)) INTO _items FROM (
    SELECT
      sku, nome, sup_codigo AS fornecedor,
      CASE
        WHEN sup_codigo IS NULL THEN 'sem_fornecedor'
        WHEN sup_id IS NULL OR fp_estoque IS NULL THEN 'nao_encontrado'
        WHEN ((fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco) OR (preco_novo_venda IS NOT NULL AND preco_atual_venda IS DISTINCT FROM preco_novo_venda))
          AND estoque_atual IS DISTINCT FROM fp_estoque THEN 'preco_e_estoque_atualizados'
        WHEN ((fp_preco IS NOT NULL AND preco_atual IS DISTINCT FROM fp_preco) OR (preco_novo_venda IS NOT NULL AND preco_atual_venda IS DISTINCT FROM preco_novo_venda)) THEN 'preco_atualizado'
        WHEN estoque_atual IS DISTINCT FROM fp_estoque THEN 'estoque_atualizado'
        ELSE 'inalterado'
      END AS status,
      preco_atual, fp_preco AS preco_novo,
      estoque_atual, fp_estoque AS estoque_novo,
      CASE WHEN via_ml THEN 'mercado_livre' ELSE 'fornecedor' END AS estoque_origem,
      preco_atual_venda, preco_novo_venda
    FROM _work
    ORDER BY sku
    -- execuções agendadas não precisam da lista completa (evita JSON gigante)
    LIMIT CASE WHEN _run_id IS NOT NULL THEN 200 ELSE 1000000 END
  ) t;

  RETURN jsonb_build_object(
    'total', _total,
    'encontrados', _found,
    'nao_encontrados', _not_found,
    'sem_fornecedor', _no_supplier,
    'preco_atualizado', _price_updated,
    'estoque_atualizado', _stock_updated,
    'estoque_via_ml', _via_ml,
    'preco_e_estoque_atualizados', _both_updated,
    'inalterados', _unchanged,
    'stores_updated', COALESCE(_stores_updated, 0),
    'no_default_marketplace', _no_default_marketplace,
    'items', COALESCE(_items, '[]'::jsonb)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.import_ml_prospect_items(_company_id uuid, _item_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
declare
  _fornecedor_id uuid;
  _imported int := 0;
  _skipped int := 0;
  _ids uuid[] := '{}';
  _skus text[] := '{}';
  rec record;
  _num text;
  _sku text;
  _new_id uuid;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  if auth.uid() is not null and not exists (
    select 1 from public.company_users
    where company_id = _company_id and user_id = auth.uid() and ativo = true
  ) then
    raise exception 'not a member of company';
  end if;

  select id into _fornecedor_id from public.fornecedores where codigo = 'mercadolivre';
  if _fornecedor_id is null then
    insert into public.fornecedores (codigo, nome, source_type, preco_embalagem, preco_transporte, taxa_devolucao, taxa_promocao)
    values ('mercadolivre', 'Mercado Livre', 'mercadolivre', 0, 0, 0, 0)
    returning id into _fornecedor_id;
  end if;

  for rec in
    select i.* from public.ml_prospect_items i where i.id = any(_item_ids)
  loop
    _num := regexp_replace(upper(coalesce(rec.catalog_product_id, '')), '^MLB', '');
    if _num = '' then
      _skipped := _skipped + 1;
      continue;
    end if;
    _sku := 'ML' || _num;

    if exists (
      select 1 from public.bling_products p
      where p.company_id = _company_id and p.codigo = _sku
    ) then
      _skipped := _skipped + 1;
      continue;
    end if;

    -- Base do fornecedor: o preço de custo do ML entra como "base", igual às
    -- outras bases de fornecedor, então a precificação calcula igual.
    insert into public.fornecedor_produtos (
      fornecedor_id, codigo, marca, categoria, titulo, estoque, qt_estoque,
      peso, altura, largura, comprimento, ncm, codigobarras, foto,
      tempo_garantia, precos, raw
    ) values (
      _fornecedor_id, _num, rec.marca, rec.category_path, rec.titulo,
      coalesce(rec.available_quantity, 0)::text, greatest(coalesce(rec.available_quantity, 0), 0),
      rec.weight_kg, rec.height_cm, rec.width_cm, rec.length_cm,
      rec.ncm, rec.ean, rec.thumbnail,
      '3 meses',
      jsonb_build_object('base', rec.custo),
      jsonb_build_object(
        'catalog_product_id', rec.catalog_product_id,
        'item_id', rec.item_id,
        'permalink', rec.permalink,
        'shipping_cost', rec.shipping_cost
      )
    )
    on conflict (fornecedor_id, codigo) do update
      set qt_estoque = excluded.qt_estoque,
          estoque = excluded.estoque,
          precos = excluded.precos,
          titulo = excluded.titulo,
          foto = excluded.foto,
          updated_at = now();

    insert into public.bling_products (
      company_id, codigo, nome,
      preco_custo, preco_compra, estoque,
      garantia, cross_docking, situacao, marca, ncm, cest,
      peso_bruto, peso_liquido, largura, altura, profundidade,
      gtin, gtin_embalagem, imagem_principal_url, url_imagens_externas,
      descricao_curta, descricao_complementar,
      origem_fiscal, fornecedor, fornecedor_id,
      link_externo, source, dirty, detail_synced
    ) values (
      _company_id, _sku, left(coalesce(rec.titulo, _sku), 250),
      rec.custo, rec.custo, 0,
      '3 meses', '3', 'Ativo', rec.marca, rec.ncm, rec.cest,
      rec.weight_kg, rec.weight_kg, rec.width_cm, rec.height_cm, rec.length_cm,
      rec.ean, rec.ean, rec.thumbnail,
      (select string_agg(u, '|') from jsonb_array_elements_text(coalesce(rec.pictures, '[]'::jsonb)) u),
      'Garantia: 3 meses | Código Anatel: a verificar | Anvisa: Isento',
      left(coalesce(rec.titulo, _sku), 250),
      '0', 'Mercado Livre', _fornecedor_id,
      rec.permalink, 'garimpo_ml', true, false
    )
    returning id into _new_id;

    -- Entra no mapeamento ML: vale o piso de estoque 4 e a recotação diária.
    insert into public.ml_product_matches (
      company_id, product_id, sku, nome, ean, found, has_full,
      min_price, min_full_price, permalink, match_by, checked_at,
      best_item_id, best_price, best_shipping_cost, best_total_price,
      best_is_full, available_quantity, has_stock, zip_code, qualifies,
      catalog_product_id
    ) values (
      _company_id, _new_id, _sku, rec.titulo, rec.ean, true, true,
      rec.price, rec.price, rec.permalink, 'garimpo', now(),
      rec.item_id, rec.price, rec.shipping_cost, rec.total_price,
      true, rec.available_quantity, true, '87020000', true,
      rec.catalog_product_id
    )
    on conflict (product_id) do nothing;

    _ids := _ids || _new_id;
    _skus := _skus || _sku;
    _imported := _imported + 1;
  end loop;

  return jsonb_build_object(
    'imported', _imported,
    'skipped', _skipped,
    'product_ids', to_jsonb(_ids),
    'skus', to_jsonb(_skus)
  );
end;
$function$
;
COMMIT;
