BEGIN;
SET LOCAL statement_timeout = '120s';
DO $$
<<audit_resume_finish>>
DECLARE
  p public.bling_products%ROWTYPE;
  run_id uuid;
  state text;
  started boolean;
  results int;
  job_seen boolean;
BEGIN
  SELECT * INTO p FROM public.bling_products WHERE codigo = 'O338274' LIMIT 1;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Missing audit resume fixture product'; END IF;
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT user_id::text FROM public.company_users WHERE company_id = p.company_id AND ativo = true LIMIT 1), true);

  -- 1) Auditoria sem regra de fotos: retomar finaliza a auditoria na hora.
  INSERT INTO public.audit_runs(company_id,user_id,status,product_ids,rule_ids,total_products,only_active,started_at,image_scan_started,image_scan_done)
  VALUES(p.company_id,auth.uid(),'processando',ARRAY[p.id],
    ARRAY[(SELECT id FROM public.validation_rules WHERE slug='titulo-maximo' AND (company_id IS NULL OR company_id=p.company_id) LIMIT 1)],
    1,false,now(),true,true) RETURNING id INTO run_id;
  PERFORM public.resume_audit_run(run_id);
  SELECT status INTO state FROM public.audit_runs WHERE id = run_id;
  IF state IS DISTINCT FROM 'concluida' THEN RAISE EXCEPTION 'Resume without photo rules must conclude the run'; END IF;
  SELECT processed_products, finished_at IS NOT NULL INTO results, started FROM public.audit_runs WHERE id = run_id;
  IF results <> 1 OR started IS DISTINCT FROM true THEN RAISE EXCEPTION 'Resumed run must process its products and record the finish time'; END IF;

  -- 2) Auditoria com fotos ainda por conferir: retomar devolve o comando para a varredura.
  INSERT INTO public.audit_runs(company_id,user_id,status,product_ids,rule_ids,total_products,only_active,started_at,image_scan_started,image_scan_done)
  VALUES(p.company_id,auth.uid(),'processando',ARRAY[p.id],
    ARRAY[(SELECT id FROM public.validation_rules WHERE slug='imagem-placeholder' AND active=true LIMIT 1)],
    1,false,now(),false,false) RETURNING id INTO run_id;
  PERFORM public.resume_audit_run(run_id);
  SELECT status, image_scan_started INTO state, started FROM public.audit_runs WHERE id = run_id;
  IF state IS DISTINCT FROM 'processando' OR started IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Resume with pending photos must restart the photo scan, not the rules';
  END IF;
  SELECT count(*) INTO results FROM public.audit_results ar WHERE ar.run_id = audit_resume_finish.run_id;
  IF results <> 0 THEN RAISE EXCEPTION 'Photo restart must not run the rules yet'; END IF;

  -- 3) Dono da auditoria saiu da empresa: a corrida é encerrada, não fica presa.
  DELETE FROM public.company_users WHERE company_id = p.company_id AND user_id = auth.uid();
  INSERT INTO public.audit_runs(company_id,user_id,status,product_ids,rule_ids,total_products,only_active,started_at,image_scan_started,image_scan_done)
  VALUES(p.company_id,auth.uid(),'processando',ARRAY[p.id],'{}'::uuid[],1,false,now(),true,true) RETURNING id INTO run_id;
  PERFORM public.resume_audit_run(run_id);
  SELECT status INTO state FROM public.audit_runs WHERE id = run_id;
  IF state IS DISTINCT FROM 'cancelada' THEN RAISE EXCEPTION 'Run of a former member must be cancelled'; END IF;

  -- 4) Agendamento do término: um único job, removido quando o trabalho acaba.
  INSERT INTO public.audit_runs(company_id,user_id,status,product_ids,rule_ids,total_products,only_active,started_at,image_scan_started,image_scan_done)
  VALUES(p.company_id,(SELECT user_id FROM public.company_users WHERE company_id=p.company_id AND ativo=true LIMIT 1),
    'processando',ARRAY[p.id],'{}'::uuid[],1,false,now(),true,true) RETURNING id INTO run_id;
  PERFORM set_config('request.jwt.claim.sub',(SELECT user_id::text FROM public.company_users WHERE company_id=p.company_id AND ativo=true LIMIT 1),true);
  PERFORM public.schedule_audit_finish(run_id);
  PERFORM public.schedule_audit_finish(run_id);
  SELECT count(*) INTO results FROM cron.job WHERE jobname = 'audit-finish-' || run_id::text;
  IF results <> 1 THEN RAISE EXCEPTION 'Scheduling the finish twice must keep a single job'; END IF;
  PERFORM public.unschedule_audit_finish(run_id);
  SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'audit-finish-' || run_id::text) INTO job_seen;
  IF job_seen THEN RAISE EXCEPTION 'Unscheduling must remove the finish job'; END IF;
  UPDATE public.audit_runs SET status = 'concluida' WHERE id = run_id;
  PERFORM public.schedule_audit_finish(run_id);
  SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'audit-finish-' || run_id::text) INTO job_seen;
  IF job_seen THEN RAISE EXCEPTION 'A finished run must not keep a finish job'; END IF;

  -- 5) Corrida muito antiga: é encerrada em vez de travar o cron para sempre.
  INSERT INTO public.audit_runs(company_id,user_id,status,product_ids,rule_ids,total_products,only_active,started_at,image_scan_started,image_scan_done)
  VALUES(p.company_id,(SELECT user_id FROM public.company_users WHERE company_id=p.company_id AND ativo=true LIMIT 1),
    'processando',ARRAY[p.id],'{}'::uuid[],1,false,now() - interval '30 days',true,true) RETURNING id INTO run_id;
  PERFORM public.resume_audit_run(run_id);
  SELECT status INTO state FROM public.audit_runs WHERE id = run_id;
  IF state IS DISTINCT FROM 'cancelada' THEN RAISE EXCEPTION 'A run older than a week must be cancelled on resume'; END IF;

  RAISE NOTICE 'Resume concludes rule-only runs, restarts photo scans, cancels orphan runs; finish job is single and removable.';
END;
$$;
ROLLBACK;

--run_audit_sql creates temp tables dropped only on commit, so this scenario needs
--its own transaction.
BEGIN;
SET LOCAL statement_timeout = '120s';
DO $$
<<audit_resume_service_role>>
DECLARE p public.bling_products%ROWTYPE; run_id uuid; state text;
BEGIN
  SELECT * INTO p FROM public.bling_products WHERE codigo = 'O338274' LIMIT 1;
  -- 6) O papel de servi\u00e7o do sistema consegue agendar, remover e retomar corridas.
  INSERT INTO public.audit_runs(company_id,user_id,status,product_ids,rule_ids,total_products,only_active,started_at,image_scan_started,image_scan_done)
  VALUES(p.company_id,(SELECT user_id FROM public.company_users WHERE company_id=p.company_id AND ativo=true LIMIT 1),
    'processando',ARRAY[p.id],'{}'::uuid[],1,false,now(),true,true) RETURNING id INTO run_id;
  SET ROLE service_role;
  PERFORM public.schedule_audit_finish(run_id);
  RESET ROLE;
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'audit-finish-' || run_id::text) THEN
    RAISE EXCEPTION 'service_role must be able to schedule the finish';
  END IF;
  SET ROLE service_role;
  PERFORM public.unschedule_audit_finish(run_id);
  RESET ROLE;
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'audit-finish-' || run_id::text) THEN
    RAISE EXCEPTION 'service_role must be able to remove the finish job';
  END IF;
  SET ROLE service_role;
  PERFORM public.resume_audit_run(run_id);
  RESET ROLE;
  SELECT status INTO state FROM public.audit_runs WHERE id = run_id;
  IF state IS DISTINCT FROM 'concluida' THEN RAISE EXCEPTION 'service_role must be able to resume and conclude a run'; END IF;

  RAISE NOTICE 'service_role can schedule, remove and resume audit runs.';
END;
$$;
ROLLBACK;
