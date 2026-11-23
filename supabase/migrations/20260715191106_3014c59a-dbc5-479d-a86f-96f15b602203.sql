REVOKE ALL ON FUNCTION public.enqueue_bling_sync_tick(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_bling_sync_tick(text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_bling_sync_tick(text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_bling_sync_tick(text, text, uuid) TO service_role;