-- Limite compartilhado por todas as tarefas da mesma empresa, também entre Workers.
CREATE TABLE public.bling_company_rate_limits (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  last_call_at timestamptz NOT NULL
);
GRANT ALL ON public.bling_company_rate_limits TO service_role;
ALTER TABLE public.bling_company_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.take_bling_company_slot(_company_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _last timestamptz; _now timestamptz; _wait int;
BEGIN
  INSERT INTO public.bling_company_rate_limits(company_id, last_call_at)
  VALUES (_company_id, clock_timestamp() - interval '1 second') ON CONFLICT DO NOTHING;
  SELECT last_call_at INTO _last FROM public.bling_company_rate_limits WHERE company_id = _company_id FOR UPDATE;
  _now := clock_timestamp();
  _wait := ceil(extract(epoch FROM (_last + interval '550 milliseconds' - _now)) * 1000)::int;
  IF _wait > 0 THEN RETURN _wait; END IF;
  UPDATE public.bling_company_rate_limits SET last_call_at = _now WHERE company_id = _company_id;
  RETURN 0;
END $$;
REVOKE ALL ON FUNCTION public.take_bling_company_slot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_bling_company_slot(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_http_job(_url text, _secret text, _body jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE _req_id bigint; _b jsonb := coalesce(_body, '{}'::jsonb);
BEGIN
  IF _url ~ '/api/public/bling/(push-tick|push-dispatch|custom-fields-tick)$' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_url || _b::text, 0));
    SELECT q.id INTO _req_id FROM net.http_request_queue q
    WHERE q.url = _url AND convert_from(q.body,'utf8')::jsonb = _b LIMIT 1;
    IF _req_id IS NOT NULL THEN RETURN _req_id; END IF;
  END IF;
  SELECT net.http_post(url := _url,
    headers := jsonb_build_object('Content-Type','application/json','x-worker-secret',_secret),
    body := _b, timeout_milliseconds := 60000) INTO _req_id;
  RETURN _req_id;
END $$;
NOTIFY pgrst, 'reload schema';