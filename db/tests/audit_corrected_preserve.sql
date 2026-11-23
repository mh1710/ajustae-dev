BEGIN;
SET LOCAL statement_timeout='90s';
DO $$
DECLARE c uuid; uid uuid; p uuid; untouched uuid; baseline uuid; rid uuid; rule uuid; r jsonb; before_state jsonb; after_state jsonb;
BEGIN
  SELECT company_id,user_id INTO c,uid FROM public.company_users WHERE ativo LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub',uid::text,true);
  -- Isolate fixtures without cancelling actual work; all effects roll back.
  UPDATE public.audit_runs SET status='cancelada' WHERE company_id=c AND status='processando';
  SELECT id INTO p FROM public.bling_products WHERE company_id=c LIMIT 1;
  SELECT id INTO untouched FROM public.bling_products WHERE company_id=c AND id<>p LIMIT 1;
  SELECT id INTO rule FROM public.validation_rules WHERE slug='marca-obrigatoria' AND active LIMIT 1;
  DELETE FROM public.audit_results WHERE product_id IN(p,untouched);
  UPDATE public.bling_products SET last_audit_at=now()-interval '2 hours',last_audit_errors=1,last_audit_warnings=0,marca='' WHERE id IN(p,untouched);
  INSERT INTO public.audit_runs(company_id,user_id,status,rule_ids,product_ids,total_products,started_at,created_at,finished_at)
  VALUES(c,uid,'concluida',ARRAY[rule],ARRAY[p,untouched],2,clock_timestamp(),clock_timestamp(),clock_timestamp()) RETURNING id INTO baseline;
  INSERT INTO public.audit_results(run_id,company_id,product_id,rule_id,rule_slug,category,severity,status,message,details)
  VALUES(baseline,c,untouched,rule,'marca-obrigatoria','cadastro','error','error','Untouched finding', '{"original":true}');
  INSERT INTO public.audit_results(run_id,company_id,product_id,rule_id,rule_slug,category,severity,status,message,details)
  VALUES(baseline,c,untouched,(SELECT id FROM public.validation_rules WHERE slug='imagem-placeholder' LIMIT 1),'imagem-placeholder','imagens','error','error','Previous photo error','{"urls":["https://example.org/photo.jpg"]}'),
    (baseline,c,untouched,(SELECT id FROM public.validation_rules WHERE slug='crossdocking-minimo' LIMIT 1),'crossdocking-minimo','estoque','warning','warning','Previous warning',NULL);
  UPDATE public.bling_products SET audit_correction_changed_at=NULL WHERE company_id=c;
  -- 1: audit summary changes must not enqueue corrections.
  UPDATE public.bling_products SET last_audit_passed=123 WHERE id=untouched;
  IF EXISTS(SELECT 1 FROM public.bling_products WHERE id=untouched AND audit_correction_changed_at IS NOT NULL) THEN RAISE EXCEPTION 'Summary updates marked correction'; END IF;
  -- 2: actual correction must be tracked.
  UPDATE public.bling_products SET marca='Corrected brand' WHERE id=p;
  IF NOT EXISTS(SELECT 1 FROM public.bling_products WHERE id=p AND audit_correction_changed_at IS NOT NULL) THEN RAISE EXCEPTION 'Brand correction not tracked'; END IF;
  SELECT to_jsonb(bp) INTO before_state FROM public.bling_products bp WHERE id=untouched;
  r:=public.start_corrected_audit(c); rid:=(r->>'run_id')::uuid;
  -- 3: scope is only the corrected product, inherits prior rules.
  IF (r->>'total')::int<>1 OR NOT EXISTS(SELECT 1 FROM public.audit_runs WHERE id=rid AND product_ids=ARRAY[p] AND rule_ids=ARRAY[rule] AND preserve_other_results) THEN RAISE EXCEPTION 'Wrong corrected scope or rules'; END IF;
  PERFORM public.run_audit_sql(rid);
  PERFORM public.run_audit_extra_rules(rid);
  -- 4: other product remains exactly unchanged, findings remain visible in new run.
  SELECT to_jsonb(bp) INTO after_state FROM public.bling_products bp WHERE id=untouched;
  IF before_state IS DISTINCT FROM after_state THEN RAISE EXCEPTION 'Untouched product changed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.audit_results WHERE run_id=rid AND product_id=untouched AND message='Untouched finding' AND details='{"original":true}'::jsonb) THEN RAISE EXCEPTION 'Untouched error lost'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.audit_results WHERE run_id=rid AND product_id=untouched AND rule_slug='imagem-placeholder' AND details='{"urls":["https://example.org/photo.jpg"]}'::jsonb) THEN RAISE EXCEPTION 'Untouched photo error lost'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.audit_results WHERE run_id=rid AND product_id=untouched AND status='warning' AND message='Previous warning') THEN RAISE EXCEPTION 'Untouched warning lost'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.list_audit_issue_types_fast(c)->'issues') i WHERE i->>'rule_slug'='imagem-placeholder' AND (i->>'error_count')::int>=1) THEN RAISE EXCEPTION 'Preserved photo error missing in filters'; END IF;
  IF EXISTS(SELECT 1 FROM public.audit_results WHERE run_id=rid AND product_id=p AND rule_slug='marca-obrigatoria') THEN RAISE EXCEPTION 'Corrected brand still error'; END IF;
  IF EXISTS(SELECT 1 FROM public.bling_products WHERE id=p AND audit_correction_changed_at IS NOT NULL) THEN RAISE EXCEPTION 'Successful correction stays pending'; END IF;
  -- 5: no pending products may never expand into full-company audit.
  BEGIN PERFORM public.start_corrected_audit(c); RAISE EXCEPTION 'Empty correction audit accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='Empty correction audit accepted' THEN RAISE; END IF; END;
  -- 6: corrections saved during the run stay pending for next audit.
  UPDATE public.bling_products SET last_audit_errors=1 WHERE id=p;
  UPDATE public.bling_products SET marca='Another brand' WHERE id=p;
  UPDATE public.audit_runs SET started_at=now()-interval '1 hour' WHERE id=rid;
  PERFORM public.finish_corrected_audit(rid);
  IF NOT EXISTS(SELECT 1 FROM public.bling_products WHERE id=p AND audit_correction_changed_at IS NOT NULL) THEN RAISE EXCEPTION 'Concurrent correction lost'; END IF;
  -- 7: in an active-only context, a product inactivated by a correction leaves the audit.
  UPDATE public.audit_runs SET status='concluida', only_active=true WHERE id=rid;
  UPDATE public.bling_products SET audit_correction_changed_at=NULL, last_audit_errors=1, situacao='A' WHERE id IN(p,untouched);
  UPDATE public.bling_products SET audit_correction_changed_at=NULL WHERE company_id=c;
  UPDATE public.bling_products SET situacao='I' WHERE id=p;
  r:=public.start_corrected_audit(c);
  IF (r->>'run_id') IS NOT NULL OR (r->>'removed_inactive')::int<>1 THEN RAISE EXCEPTION 'Inactivated product still audited: %', r; END IF;
  IF EXISTS(SELECT 1 FROM public.bling_products WHERE id=p AND (last_audit_at IS NOT NULL OR last_audit_errors<>0)) THEN RAISE EXCEPTION 'Inactivated product kept errors'; END IF;
  RAISE NOTICE 'Corrected-audit rules passed, including preserved photos, warnings and filters; all fixtures rolled back.';
END $$;
ROLLBACK;
