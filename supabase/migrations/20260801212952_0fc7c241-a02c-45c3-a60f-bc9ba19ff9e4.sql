DO $$
DECLARE r record; d text; nd text;
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('enqueue_bling_push','enqueue_bling_inactivate','start_bling_stores_sync','enqueue_bling_link_store','enqueue_bling_delete')
  LOOP
    d := pg_get_functiondef(r.oid);
    nd := regexp_replace(
      d,
      'IF\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.company_users',
      'IF auth.uid() IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM public.company_users',
      'gi'
    );
    IF nd <> d THEN
      EXECUTE nd;
    END IF;
  END LOOP;
END $$;

UPDATE public.bling_orders_sync_jobs
   SET status = 'cancelada',
       cancel_requested = true,
       finished_at = now(),
       last_error = COALESCE(last_error, 'Cancelada automaticamente (worker interrompido).')
 WHERE status IN ('pendente','executando');