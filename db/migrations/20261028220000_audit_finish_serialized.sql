-- Etapas finais de auditoria rodam no máximo 2 por vez no banco inteiro; as demais aguardam o próximo minuto do cron.
CREATE OR REPLACE FUNCTION public.resume_audit_run(_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
 SET lock_timeout TO '20s'
AS $function$
DECLARE r public.audit_runs%ROWTYPE; result jsonb;
BEGIN
  SELECT * INTO r FROM public.audit_runs WHERE id = _run_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'processando' THEN
    PERFORM public.unschedule_audit_finish(_run_id);
    RETURN jsonb_build_object('skipped', true);
  END IF;

  -- O dono da auditoria saiu da empresa: nada a retomar, encerra a corrida.
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = r.company_id AND user_id = r.user_id AND ativo = true
  ) THEN
    UPDATE public.audit_runs SET status = 'cancelada', finished_at = now() WHERE id = _run_id;
    PERFORM public.unschedule_audit_finish(_run_id);
    RETURN jsonb_build_object('cancelled', true);
  END IF;

  -- Corridas de semanas atrás: a duração não cabe no campo inteiro e reprocessar
  -- um catálogo tão antigo não vale a pena; encerra para a empresa poder auditar.
  IF r.started_at IS NOT NULL AND r.started_at < now() - interval '7 days' THEN
    UPDATE public.audit_runs SET status = 'cancelada', finished_at = now() WHERE id = _run_id;
    PERFORM public.unschedule_audit_finish(_run_id);
    RETURN jsonb_build_object('cancelled', 'antiga');
  END IF;

  PERFORM set_config('request.jwt.claim.sub', r.user_id::text, true);

  IF EXISTS (
      SELECT 1 FROM public.validation_rules vr
      WHERE vr.slug = 'imagem-placeholder' AND vr.active = true AND vr.id = ANY(r.rule_ids)
    ) AND NOT r.image_scan_done THEN
    -- Ainda faltam fotos: devolve o comando para a varredura, que o vigia segue
    -- reenfileirando a cada minuto.
    UPDATE public.audit_runs SET image_scan_started = true WHERE id = _run_id;
    PERFORM public.unschedule_audit_finish(_run_id);
    RETURN jsonb_build_object('resumed', 'imagens');
  END IF;

  -- Várias etapas finais simultâneas disputam memória/disco e travam todas.
  IF NOT (pg_try_advisory_xact_lock(hashtext('audit-finish-slot'), 1)
          OR pg_try_advisory_xact_lock(hashtext('audit-finish-slot'), 2)) THEN
    RETURN jsonb_build_object('aguardando', 'vaga');
  END IF;

  result := public.run_audit_sql(_run_id);
  PERFORM public.run_audit_extra_rules(_run_id);
  PERFORM public.unschedule_audit_finish(_run_id);
  RETURN result;
END;
$function$;
