-- A etapa final da auditoria (run_audit_sql) leva ~40s para 14 mil produtos.
-- Ela era disparada dentro de uma chamada HTTP interna, que é cortada em 60s:
-- se ninguém estivesse no sistema na hora em que a varredura de fotos terminasse,
-- a transação morria, a auditoria ficava "em andamento" para sempre e impedia
-- novas auditorias na empresa. O término passa a ser agendado no cron do banco,
-- sem limite de tempo de HTTP, e o vigia retoma auditorias abandonadas.

CREATE OR REPLACE FUNCTION public.unschedule_audit_finish(_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job_id bigint;
BEGIN
  SELECT jobid INTO _job_id FROM cron.job WHERE jobname = 'audit-finish-' || _run_id::text;
  IF _job_id IS NOT NULL THEN
    PERFORM cron.unschedule(_job_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_audit_finish(_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET statement_timeout = '0' AS $$
DECLARE _job_name text := 'audit-finish-' || _run_id::text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.audit_runs WHERE id = _run_id AND status = 'processando') THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = _job_name) THEN
    RETURN;
  END IF;
  PERFORM cron.schedule(_job_name, '* * * * *',
    'SET statement_timeout = 0; SELECT public.resume_audit_run(' || quote_literal(_run_id::text) || '::uuid)');
END;
$$;

-- Retoma uma auditoria abandonada: confere as fotos que faltarem ou finaliza a
-- auditoria. Roda pelo cron do banco, então não tem limite de 60s de HTTP.
CREATE OR REPLACE FUNCTION public.resume_audit_run(_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public SET statement_timeout = '0' SET lock_timeout = '20s' AS $$
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

  result := public.run_audit_sql(_run_id);
  PERFORM public.run_audit_extra_rules(_run_id);
  PERFORM public.unschedule_audit_finish(_run_id);
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.unschedule_audit_finish(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_audit_finish(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resume_audit_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unschedule_audit_finish(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.schedule_audit_finish(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resume_audit_run(uuid) TO service_role;
