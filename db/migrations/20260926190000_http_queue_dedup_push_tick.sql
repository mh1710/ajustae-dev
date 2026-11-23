-- Evita congestionar a fila pg_net com dezenas de push-ticks idênticos.
CREATE OR REPLACE FUNCTION public.enqueue_http_job(_url text, _secret text, _body jsonb)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _req_id bigint; _b jsonb := COALESCE(_body, '{}'::jsonb);
BEGIN
  IF _url ~ '/api/public/bling/(push-tick|push-dispatch)$' THEN
    SELECT q.id INTO _req_id FROM net.http_request_queue q
     WHERE q.url = _url AND convert_from(q.body,'utf8')::jsonb = _b LIMIT 1;
    IF _req_id IS NOT NULL THEN RETURN _req_id; END IF;
  END IF;
  SELECT net.http_post(url := _url,
    headers := jsonb_build_object('Content-Type','application/json','x-worker-secret',_secret),
    body := _b, timeout_milliseconds := 60000) INTO _req_id;
  RETURN _req_id;
END; $function$;

-- Limpeza: mantém só 1 tick idêntico na fila.
DELETE FROM net.http_request_queue q USING net.http_request_queue k
 WHERE q.url ~ '/api/public/bling/(push-tick|push-dispatch)$'
   AND k.url = q.url AND k.body = q.body AND k.id < q.id;
