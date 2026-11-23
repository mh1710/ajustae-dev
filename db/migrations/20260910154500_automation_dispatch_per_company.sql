-- Dispara cada empresa da automação em uma requisição própria (pg_net),
-- para que nenhuma execução divida o tempo limite do servidor com as outras.

CREATE OR REPLACE FUNCTION public.enqueue_automation_run(_url text, _secret text, _schedule_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $$
DECLARE
  request_id bigint;
BEGIN
  SELECT net.http_post(
    url := _url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', _secret
    ),
    body := jsonb_build_object('schedule_id', _schedule_id),
    timeout_milliseconds := 300000
  ) INTO request_id;

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_automation_run(text, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_automation_run(text, text, uuid) TO service_role;
