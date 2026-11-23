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
          'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphdmFicGdldGdib3Zkb2d6YXR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMjI4NjgsImV4cCI6MjA5OTY5ODg2OH0.ce9_V33AvX87ZM7AI_zZg6bkKFejq06UEaYjwBmtF5A'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 5000
      ) as request_id;
      $cron$
    );
  END IF;
END $$;