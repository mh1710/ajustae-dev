-- Harden stock automation: stock-only fast path, bounded database work,
-- shared preparation lock, and automatic recovery of abandoned runs.

CREATE INDEX IF NOT EXISTS fornecedor_produtos_fornecedor_codigo_trim_idx
  ON public.fornecedor_produtos (fornecedor_id, (btrim(codigo)));

CREATE OR REPLACE FUNCTION public.automation_update_stock_only(
  _company_id uuid,
  _run_id uuid DEFAULT NULL::uuid
)
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
BEGIN
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
      CASE upper(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+'))
        WHEN 'ODS' THEN 'oderco' WHEN 'O' THEN 'oderco'
        WHEN 'HX' THEN 'hayamax' WHEN 'HA' THEN 'hayamax'
        WHEN 'EV' THEN 'evolusom' WHEN 'E' THEN 'evolusom'
        ELSE NULL
      END AS sup_codigo,
      btrim(substring(btrim(coalesce(p.codigo, '')) from '^[A-Za-z]+(.*)$')) AS num_code
    FROM public.bling_products p
    WHERE p.company_id = _company_id
  )
  SELECT m.id, m.sku, m.nome, m.estoque_atual, m.sup_codigo,
    f.id AS fornecedor_id,
    CASE
      WHEN fp.qt_estoque IS NULL THEN NULL
      WHEN COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default) IS NOT NULL
        THEN LEAST(fp.qt_estoque, COALESCE(ov.stock_cap, f.stock_cap, ps.stock_cap_default))
      ELSE fp.qt_estoque
    END AS estoque_novo
  FROM mapped m
  LEFT JOIN public.fornecedores f
    ON f.codigo = m.sup_codigo AND (f.company_id IS NULL OR f.company_id = _company_id)
  LEFT JOIN public.fornecedor_produtos fp
    ON fp.fornecedor_id = f.id AND btrim(fp.codigo) = m.num_code AND m.num_code <> ''
  LEFT JOIN public.product_cost_overrides ov
    ON ov.product_id = m.id AND ov.company_id = _company_id
  LEFT JOIN public.pricing_settings ps ON ps.company_id = _company_id;

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
    SELECT _run_id, _company_id, w.id, w.sku, w.nome, 'estoque',
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
    'encontrados', _found,
    'sem_fornecedor', _no_supplier,
    'estoque_atualizado', _stock_updated,
    'preco_atualizado', 0,
    'preco_e_estoque_atualizados', 0,
    'stores_updated', 0,
    'items', '[]'::jsonb
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.automation_update_stock_only(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.automation_update_stock_only(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reclaim_stuck_automation_runs(_minutes integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _runs integer := 0;
  _schedules integer := 0;
BEGIN
  WITH stale AS (
    UPDATE public.automation_runs
       SET status = 'error',
           error = 'Execução interrompida automaticamente. Ela poderá ser executada novamente.',
           finished_at = now(),
           current_step = NULL
     WHERE status = 'running'
       AND finished_at IS NULL
       AND updated_at < now() - make_interval(mins => GREATEST(COALESCE(_minutes, 5), 2))
     RETURNING id
  ) SELECT count(*) INTO _runs FROM stale;

  WITH fixed AS (
    UPDATE public.automation_schedules s
       SET last_status = 'error'
     WHERE s.last_status = 'running'
       AND s.last_run_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.automation_runs r
         WHERE r.id = s.last_run_id AND r.status = 'error'
       )
     RETURNING s.id
  ) SELECT count(*) INTO _schedules FROM fixed;

  RETURN jsonb_build_object('runs', _runs, 'schedules', _schedules);
END;
$function$;

REVOKE ALL ON FUNCTION public.reclaim_stuck_automation_runs(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_stuck_automation_runs(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_due_automation_schedules(_limit integer DEFAULT 3)
RETURNS TABLE(id uuid, company_id uuid, slug text, options jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.reclaim_stuck_automation_runs(5);

  RETURN QUERY
  WITH due AS (
    SELECT s.id, s.company_id,
      EXISTS (
        SELECT 1 FROM public.automation_runs r
        WHERE r.company_id = s.company_id
          AND r.status = 'running'
          AND r.finished_at IS NULL
          AND r.updated_at > now() - interval '5 minutes'
      ) AS busy
    FROM public.automation_schedules s
    WHERE s.enabled AND s.next_run_at IS NOT NULL AND s.next_run_at <= now()
    ORDER BY s.next_run_at
    LIMIT GREATEST(COALESCE(_limit,3),1)
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.automation_schedules s
       SET last_run_at = CASE WHEN due.busy THEN s.last_run_at ELSE now() END,
           last_status = CASE WHEN due.busy THEN 'skipped_running' ELSE 'running' END,
           next_run_at = public.automation_next_run(
             s.frequency, s.hour, s.minute, s.weekday, s.day_of_month,
             s.interval_days, s.timezone, now())
      FROM due WHERE s.id = due.id
    RETURNING s.id, s.company_id, s.slug, s.options, due.busy
  )
  SELECT u.id, u.company_id, u.slug, u.options FROM upd u WHERE NOT u.busy;
END; $$;

REVOKE ALL ON FUNCTION public.claim_due_automation_schedules(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_automation_schedules(integer) TO service_role;
