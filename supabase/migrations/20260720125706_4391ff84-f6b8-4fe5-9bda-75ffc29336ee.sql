REVOKE ALL ON FUNCTION public.upsert_bling_product_stores_batch(uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_bling_product_stores_batch(uuid, uuid, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_bling_product_stores_batch(uuid, uuid, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_bling_product_stores_batch(uuid, uuid, uuid, jsonb) TO service_role;