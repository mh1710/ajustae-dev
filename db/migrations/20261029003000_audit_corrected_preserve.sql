-- Incremental audits track real catalog changes, never summary/queue updates.
ALTER TABLE public.bling_products ADD COLUMN IF NOT EXISTS audit_correction_changed_at timestamptz;
ALTER TABLE public.audit_runs ADD COLUMN IF NOT EXISTS preserve_other_results boolean NOT NULL DEFAULT false;
ALTER TABLE public.audit_runs ADD COLUMN IF NOT EXISTS preserved_results_at timestamptz;
CREATE INDEX IF NOT EXISTS bling_products_pending_audit_idx ON public.bling_products(company_id,id) WHERE audit_correction_changed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.track_audit_catalog_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.last_audit_at IS NOT NULL AND
    (to_jsonb(NEW) - ARRAY['updated_at','last_audit_at','last_audit_errors','last_audit_warnings','last_audit_passed','audit_correction_changed_at','dirty','bling_last_sent_payload','sincronizado_em','sincronizacao_status','sincronizacao_erro','ultimo_preco_sincronizado','ultimo_estoque_sincronizado','dados_resumidos_json','dados_completos_json','detail_synced','detail_synced_at','detail_sync_error','last_seen_sync_job_id','bling_updated_at'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['updated_at','last_audit_at','last_audit_errors','last_audit_warnings','last_audit_passed','audit_correction_changed_at','dirty','bling_last_sent_payload','sincronizado_em','sincronizacao_status','sincronizacao_erro','ultimo_preco_sincronizado','ultimo_estoque_sincronizado','dados_resumidos_json','dados_completos_json','detail_synced','detail_synced_at','detail_sync_error','last_seen_sync_job_id','bling_updated_at'])
  THEN NEW.audit_correction_changed_at := clock_timestamp(); END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.track_audit_catalog_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_track_audit_catalog_change ON public.bling_products;
CREATE TRIGGER trg_track_audit_catalog_change BEFORE UPDATE ON public.bling_products FOR EACH ROW EXECUTE FUNCTION public.track_audit_catalog_change();
-- Include already-saved local corrections where the catalog is still dirty.
UPDATE public.bling_products SET audit_correction_changed_at=updated_at
WHERE last_audit_at IS NOT NULL AND updated_at > last_audit_at AND dirty IS TRUE;

CREATE OR REPLACE FUNCTION public.start_corrected_audit(_company_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ids uuid[]; rules uuid[]; rid uuid; previous public.audit_runs%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.company_users WHERE company_id=_company_id AND user_id=auth.uid() AND ativo) THEN RAISE EXCEPTION 'Sem acesso a esta empresa.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_company_id::text, 930));
  IF EXISTS(SELECT 1 FROM public.audit_runs WHERE company_id=_company_id AND status='processando') THEN RAISE EXCEPTION 'Já existe uma auditoria em andamento nesta empresa.'; END IF;
  SELECT * INTO previous FROM public.audit_runs WHERE company_id=_company_id AND status='concluida' ORDER BY created_at DESC LIMIT 1;
  IF previous.id IS NULL THEN RAISE EXCEPTION 'Execute uma auditoria antes de auditar os corrigidos.'; END IF;
  SELECT array_agg(id ORDER BY id) INTO ids FROM public.bling_products WHERE company_id=_company_id AND audit_correction_changed_at IS NOT NULL;
  IF coalesce(cardinality(ids),0)=0 THEN RAISE EXCEPTION 'Nenhum produto alterado desde a última auditoria.'; END IF;
  rules:=previous.rule_ids;
  INSERT INTO public.audit_runs(company_id,user_id,status,product_ids,rule_ids,total_products,only_active,started_at,preserve_other_results)
  VALUES(_company_id,auth.uid(),'processando',ids,rules,cardinality(ids),false,clock_timestamp(),true) RETURNING id INTO rid;
  UPDATE public.audit_runs SET created_at=clock_timestamp() WHERE id=rid;
  RETURN jsonb_build_object('run_id',rid,'total',cardinality(ids));
END $$;
REVOKE ALL ON FUNCTION public.start_corrected_audit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_corrected_audit(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finish_corrected_audit(_run_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.audit_runs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.audit_runs WHERE id=_run_id FOR UPDATE;
  IF r.status <> 'concluida' THEN RETURN; END IF;
  -- Never clear corrections saved after this run began; retries/cancellation retain them.
  UPDATE public.bling_products p SET audit_correction_changed_at=NULL
  WHERE p.company_id=r.company_id AND p.audit_correction_changed_at <= r.started_at
    AND (coalesce(cardinality(r.product_ids),0)=0 OR p.id=ANY(r.product_ids))
    AND (r.only_active IS NOT TRUE OR upper(btrim(coalesce(p.situacao,''))) LIKE 'A%');
  IF NOT r.preserve_other_results OR r.preserved_results_at IS NOT NULL THEN RETURN; END IF;
  -- Copy existing findings unchanged: no reevaluation, no photo scan for untouched products.
  INSERT INTO public.audit_results(run_id,company_id,product_id,rule_id,rule_slug,category,severity,status,message,details,created_at)
  SELECT r.id,a.company_id,a.product_id,a.rule_id,a.rule_slug,a.category,a.severity,a.status,a.message,a.details,a.created_at
  FROM public.audit_results a
  JOIN public.bling_products p ON p.id=a.product_id AND p.company_id=r.company_id
  JOIN public.audit_runs old ON old.id=a.run_id AND old.status='concluida'
  WHERE a.company_id=r.company_id AND NOT(a.product_id=ANY(r.product_ids)) AND old.created_at<r.created_at
    AND NOT EXISTS(SELECT 1 FROM public.audit_results newer JOIN public.audit_runs nr ON nr.id=newer.run_id
      WHERE newer.product_id=a.product_id AND nr.status='concluida' AND nr.created_at>old.created_at AND nr.created_at<r.created_at);
  UPDATE public.audit_runs SET preserved_results_at=clock_timestamp(),
    errors_count=(SELECT count(*) FROM public.bling_products WHERE company_id=r.company_id AND last_audit_at IS NOT NULL AND last_audit_errors>0),
    warnings_count=(SELECT count(*) FROM public.bling_products WHERE company_id=r.company_id AND last_audit_at IS NOT NULL AND coalesce(last_audit_errors,0)=0 AND last_audit_warnings>0),
    passed_count=(SELECT count(*) FROM public.bling_products WHERE company_id=r.company_id AND last_audit_at IS NOT NULL AND coalesce(last_audit_errors,0)=0 AND coalesce(last_audit_warnings,0)=0)
  WHERE id=r.id;
END $$;
REVOKE ALL ON FUNCTION public.finish_corrected_audit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_corrected_audit(uuid) TO service_role;

-- Preserve the existing evaluator and invoke consolidation from every finish path,
-- including the unattended database cron. No browser-only finalization.
DO $$ DECLARE def text; BEGIN
  IF to_regprocedure('public.run_audit_extra_rules_engine(uuid)') IS NULL THEN
    SELECT pg_get_functiondef('public.run_audit_extra_rules(uuid)'::regprocedure) INTO def;
    EXECUTE replace(def,'public.run_audit_extra_rules(', 'public.run_audit_extra_rules_engine(');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.run_audit_extra_rules_engine(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.run_audit_extra_rules(_run_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET statement_timeout='0' SET lock_timeout='20s' AS $$
DECLARE result jsonb; r public.audit_runs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.audit_runs WHERE id=_run_id;
  IF NOT EXISTS(SELECT 1 FROM public.company_users WHERE company_id=r.company_id AND user_id=auth.uid() AND ativo) THEN RAISE EXCEPTION 'Sem acesso a esta empresa.'; END IF;
  result:=public.run_audit_extra_rules_engine(_run_id);
  PERFORM public.finish_corrected_audit(_run_id);
  IF r.preserve_other_results AND NOT coalesce((result->>'cancelled')::boolean,false) THEN
    SELECT result || jsonb_build_object('done',true,'errors',errors_count,'warnings',warnings_count,'passed',passed_count) INTO result FROM public.audit_runs WHERE id=_run_id;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.run_audit_extra_rules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_audit_extra_rules(uuid) TO authenticated, service_role;
-- The latest completed consolidated findings must survive operational pruning.
DO $$ DECLARE def text; BEGIN
  SELECT pg_get_functiondef('public.prune_old_operational_data()'::regprocedure) INTO def;
  def:=replace(def,
    'WHERE a.run_id IN (SELECT id FROM public.audit_runs WHERE created_at < now() - interval ''3 days'');',
    'WHERE a.run_id IN (SELECT id FROM public.audit_runs WHERE created_at < now() - interval ''3 days'') AND a.run_id NOT IN (SELECT DISTINCT ON (company_id) id FROM public.audit_runs WHERE status=''concluida'' ORDER BY company_id,created_at DESC);');
  EXECUTE def;
END $$;
