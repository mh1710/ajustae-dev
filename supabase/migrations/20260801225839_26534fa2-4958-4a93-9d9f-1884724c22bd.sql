CREATE OR REPLACE FUNCTION public.enqueue_http_job(_url text, _secret text, _body jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _req_id bigint;
BEGIN
  SELECT net.http_post(
    url := _url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', _secret),
    body := COALESCE(_body, '{}'::jsonb),
    timeout_milliseconds := 60000
  ) INTO _req_id;
  RETURN _req_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_http_job(text, text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_http_job(text, text, jsonb) TO service_role;