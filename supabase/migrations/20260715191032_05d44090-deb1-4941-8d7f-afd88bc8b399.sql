CREATE OR REPLACE FUNCTION public.enqueue_bling_sync_tick(_url text, _secret text, _job_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
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
    body := jsonb_build_object('syncJobId', _job_id),
    timeout_milliseconds := 5000
  ) INTO request_id;

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_bling_sync_tick(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_bling_sync_tick(text, text, uuid) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bling-products-sync-safety-net') THEN
      PERFORM cron.unschedule('bling-products-sync-safety-net');
    END IF;

    PERFORM cron.schedule(
      'bling-products-sync-safety-net',
      '* * * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://meublingcorreto.lovable.app/api/public/bling/sync-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6InphdmFicGdldGdib3Zkb2d6YXR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMjI4NjgsImV4cCI6MjA5OTY5ODg2OH0.ce9_V33AvX87ZM7AI_zZg6bkKFejq06UEaYjwBmtF5A'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 5000
      ) as request_id;
      $cron$
    );
  END IF;
END $$;