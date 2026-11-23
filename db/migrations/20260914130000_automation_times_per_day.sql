-- Automação "X vezes ao dia": vários horários fixos no mesmo dia.

ALTER TABLE public.automation_schedules
  ADD COLUMN IF NOT EXISTS times text[];

ALTER TABLE public.automation_schedules
  DROP CONSTRAINT IF EXISTS automation_schedules_frequency_chk;
ALTER TABLE public.automation_schedules
  ADD CONSTRAINT automation_schedules_frequency_chk
  CHECK (frequency = ANY (ARRAY['daily','weekly','monthly','interval','times_per_day']));

DROP FUNCTION IF EXISTS public.automation_next_run(text,integer,integer,integer,integer,integer,text,timestamptz);

CREATE OR REPLACE FUNCTION public.automation_next_run(
  _frequency text,
  _hour integer,
  _minute integer,
  _weekday integer,
  _day_of_month integer,
  _interval_days integer,
  _timezone text,
  _from timestamptz,
  _times text[] DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = public AS $function$
DECLARE
  tz text := COALESCE(NULLIF(_timezone,''), 'America/Sao_Paulo');
  base timestamp;
  cand timestamp;
  best timestamp;
  t text;
  parsed timestamp;
  dom int;
BEGIN
  base := (COALESCE(_from, now()) AT TIME ZONE tz);
  cand := date_trunc('day', base) + make_interval(hours => COALESCE(_hour,0), mins => COALESCE(_minute,0));

  IF _frequency = 'times_per_day' THEN
    IF _times IS NULL OR array_length(_times,1) IS NULL THEN
      IF cand <= base THEN cand := cand + interval '1 day'; END IF;
      RETURN cand AT TIME ZONE tz;
    END IF;

    best := NULL;
    FOREACH t IN ARRAY _times LOOP
      CONTINUE WHEN COALESCE(NULLIF(trim(t),''), '') = '';
      parsed := date_trunc('day', base) + (trim(t))::time;
      IF parsed <= base THEN parsed := parsed + interval '1 day'; END IF;
      IF best IS NULL OR parsed < best THEN best := parsed; END IF;
    END LOOP;

    IF best IS NULL THEN
      IF cand <= base THEN cand := cand + interval '1 day'; END IF;
      RETURN cand AT TIME ZONE tz;
    END IF;
    RETURN best AT TIME ZONE tz;

  ELSIF _frequency = 'daily' THEN
    IF cand <= base THEN cand := cand + interval '1 day'; END IF;

  ELSIF _frequency = 'weekly' THEN
    cand := cand + make_interval(days => ((COALESCE(_weekday,1) - EXTRACT(DOW FROM cand)::int) + 7) % 7);
    IF cand <= base THEN cand := cand + interval '7 days'; END IF;

  ELSIF _frequency = 'monthly' THEN
    dom := LEAST(GREATEST(COALESCE(_day_of_month,1),1),28);
    cand := date_trunc('month', base) + make_interval(days => dom - 1, hours => COALESCE(_hour,0), mins => COALESCE(_minute,0));
    IF cand <= base THEN
      cand := date_trunc('month', base) + interval '1 month'
              + make_interval(days => dom - 1, hours => COALESCE(_hour,0), mins => COALESCE(_minute,0));
    END IF;

  ELSE -- interval
    cand := cand + make_interval(days => GREATEST(COALESCE(_interval_days,1),1));
    IF cand <= base THEN cand := base + make_interval(days => GREATEST(COALESCE(_interval_days,1),1)); END IF;
  END IF;

  RETURN cand AT TIME ZONE tz;
END; $function$;

GRANT EXECUTE ON FUNCTION public.automation_next_run(text,integer,integer,integer,integer,integer,text,timestamptz,text[])
  TO authenticated, service_role;

-- O claim precisa considerar a lista de horários ao reprogramar a próxima execução.
CREATE OR REPLACE FUNCTION public.claim_due_automation_schedules(_limit integer DEFAULT 3)
RETURNS TABLE(id uuid, company_id uuid, slug text, options jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT s.id,
           s.company_id,
           EXISTS (
             SELECT 1 FROM public.automation_runs r
             WHERE r.company_id = s.company_id
               AND r.status = 'running'
               AND r.finished_at IS NULL
               AND r.started_at > now() - interval '2 hours'
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
             s.interval_days, s.timezone, now(), s.times)
      FROM due WHERE s.id = due.id
    RETURNING s.id, s.company_id, s.slug, s.options, due.busy
  )
  SELECT u.id, u.company_id, u.slug, u.options FROM upd u WHERE NOT u.busy;
END; $$;

REVOKE ALL ON FUNCTION public.claim_due_automation_schedules(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_automation_schedules(integer) TO service_role;
