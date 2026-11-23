DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bling-products-sync-safety-net') THEN
      PERFORM cron.unschedule('bling-products-sync-safety-net');
    END IF;

    PERFORM cron.schedule(
      'bling-products-sync-safety-net',
      '* * * * *',
      'SELECT net.http_post(
        url := ''https://meublingcorreto.lovable.app/api/public/bling/sync-tick'',
        headers := ''{""Content-Type"":""application/json"",""apikey"":""eyJhbGciOiJIUzI1NiIsInJlZiI6InphdmFicGdldGdib3Zkb2d6YXR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMjI4NjgsImV4cCI6MjA5OTY5ODg2OH0.ce9_V33AvX87ZM7AI_zZg6bkKFejq06UEaYjwBmtF5A""}''::jsonb,
        body := ''{}''::jsonb
      ) as request_id;'
    );
  END IF;
END $$;