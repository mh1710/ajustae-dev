
-- Speed up product listing filters and audit joins
CREATE INDEX IF NOT EXISTS idx_bling_products_company_situacao_nome
  ON public.bling_products (company_id, situacao, nome);

CREATE INDEX IF NOT EXISTS idx_bling_products_company_detail_nome
  ON public.bling_products (company_id, detail_synced, nome);

CREATE INDEX IF NOT EXISTS idx_bling_products_company_errors
  ON public.bling_products (company_id, last_audit_errors)
  WHERE last_audit_errors > 0;

CREATE INDEX IF NOT EXISTS idx_bling_products_company_warnings
  ON public.bling_products (company_id, last_audit_warnings)
  WHERE last_audit_warnings > 0;

CREATE INDEX IF NOT EXISTS idx_bling_products_company_lastaudit
  ON public.bling_products (company_id, last_audit_at DESC NULLS LAST);

-- Audit results join: run_id + rule_slug + status is the common filter
CREATE INDEX IF NOT EXISTS idx_audit_results_run_rule_status
  ON public.audit_results (run_id, rule_slug, status, product_id);

CREATE INDEX IF NOT EXISTS idx_audit_results_product_run
  ON public.audit_results (product_id, run_id);

ANALYZE public.bling_products;
ANALYZE public.audit_results;
