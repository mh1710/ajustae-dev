-- Corrected audits inherit the previous run's context (only_active): products
-- inactivated by a correction leave the audit instead of being re-flagged.
CREATE OR REPLACE FUNCTION public.start_corrected_audit(_company_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ids uuid[]; rid uuid; previous public.audit_runs%ROWTYPE; removed int := 0;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.company_users WHERE company_id=_company_id AND user_id=auth.uid() AND ativo) THEN RAISE EXCEPTION 'Sem acesso a esta empresa.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_company_id::text, 930));
  IF EXISTS(SELECT 1 FROM public.audit_runs WHERE company_id=_company_id AND status='processando') THEN RAISE EXCEPTION 'Já existe uma auditoria em andamento nesta empresa.'; END IF;
  SELECT * INTO previous FROM public.audit_runs WHERE company_id=_company_id AND status='concluida' ORDER BY created_at DESC LIMIT 1;
  IF previous.id IS NULL THEN RAISE EXCEPTION 'Execute uma auditoria antes de auditar os corrigidos.'; END IF;
  IF previous.only_active IS TRUE THEN
    UPDATE public.bling_products SET audit_correction_changed_at=NULL, last_audit_at=NULL,
      last_audit_errors=0, last_audit_warnings=0
    WHERE company_id=_company_id AND audit_correction_changed_at IS NOT NULL
      AND upper(btrim(coalesce(situacao,''))) NOT LIKE 'A%';
    GET DIAGNOSTICS removed = ROW_COUNT;
  END IF;
  SELECT array_agg(id ORDER BY id) INTO ids FROM public.bling_products WHERE company_id=_company_id AND audit_correction_changed_at IS NOT NULL;
  IF coalesce(cardinality(ids),0)=0 THEN
    IF removed > 0 THEN RETURN jsonb_build_object('run_id',NULL,'total',0,'removed_inactive',removed); END IF;
    RAISE EXCEPTION 'Nenhum produto alterado desde a última auditoria.';
  END IF;
  INSERT INTO public.audit_runs(company_id,user_id,status,product_ids,rule_ids,total_products,only_active,started_at,preserve_other_results)
  VALUES(_company_id,auth.uid(),'processando',ids,previous.rule_ids,cardinality(ids),coalesce(previous.only_active,false),clock_timestamp(),true) RETURNING id INTO rid;
  UPDATE public.audit_runs SET created_at=clock_timestamp() WHERE id=rid;
  RETURN jsonb_build_object('run_id',rid,'total',cardinality(ids),'removed_inactive',removed);
END $$;
REVOKE ALL ON FUNCTION public.start_corrected_audit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_corrected_audit(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finish_corrected_audit(_run_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.audit_runs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.audit_runs WHERE id=_run_id FOR UPDATE;
  IF r.status <> 'concluida' THEN RETURN; END IF;
  UPDATE public.bling_products p SET audit_correction_changed_at=NULL
  WHERE p.company_id=r.company_id AND p.audit_correction_changed_at <= r.started_at
    AND (coalesce(cardinality(r.product_ids),0)=0 OR p.id=ANY(r.product_ids));
  IF r.only_active IS TRUE THEN
    -- Inactive products are outside this audit's context: drop their stale results.
    UPDATE public.bling_products p SET last_audit_at=NULL, last_audit_errors=0, last_audit_warnings=0
    WHERE p.company_id=r.company_id AND p.id=ANY(r.product_ids) AND upper(btrim(coalesce(p.situacao,''))) NOT LIKE 'A%';
  END IF;
  IF NOT r.preserve_other_results OR r.preserved_results_at IS NOT NULL THEN RETURN; END IF;
  INSERT INTO public.audit_results(run_id,company_id,product_id,rule_id,rule_slug,category,severity,status,message,details,created_at)
  SELECT r.id,a.company_id,a.product_id,a.rule_id,a.rule_slug,a.category,a.severity,a.status,a.message,a.details,a.created_at
  FROM public.audit_results a
  JOIN public.bling_products p ON p.id=a.product_id AND p.company_id=r.company_id
  JOIN public.audit_runs old ON old.id=a.run_id AND old.status='concluida'
  WHERE a.company_id=r.company_id AND NOT(a.product_id=ANY(r.product_ids)) AND old.created_at<r.created_at
    AND (r.only_active IS NOT TRUE OR upper(btrim(coalesce(p.situacao,''))) LIKE 'A%')
    AND NOT EXISTS(SELECT 1 FROM public.audit_results newer JOIN public.audit_runs nr ON nr.id=newer.run_id
      WHERE newer.product_id=a.product_id AND nr.status='concluida' AND nr.created_at>old.created_at AND nr.created_at<r.created_at);
  UPDATE public.audit_runs SET preserved_results_at=clock_timestamp(),
    errors_count=(SELECT count(*) FROM public.bling_products WHERE company_id=r.company_id AND last_audit_at IS NOT NULL AND last_audit_errors>0 AND (r.only_active IS NOT TRUE OR upper(btrim(coalesce(situacao,''))) LIKE 'A%')),
    warnings_count=(SELECT count(*) FROM public.bling_products WHERE company_id=r.company_id AND last_audit_at IS NOT NULL AND coalesce(last_audit_errors,0)=0 AND last_audit_warnings>0 AND (r.only_active IS NOT TRUE OR upper(btrim(coalesce(situacao,''))) LIKE 'A%')),
    passed_count=(SELECT count(*) FROM public.bling_products WHERE company_id=r.company_id AND last_audit_at IS NOT NULL AND coalesce(last_audit_errors,0)=0 AND coalesce(last_audit_warnings,0)=0 AND (r.only_active IS NOT TRUE OR upper(btrim(coalesce(situacao,''))) LIKE 'A%'))
  WHERE id=r.id;
END $$;
REVOKE ALL ON FUNCTION public.finish_corrected_audit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_corrected_audit(uuid) TO service_role;
