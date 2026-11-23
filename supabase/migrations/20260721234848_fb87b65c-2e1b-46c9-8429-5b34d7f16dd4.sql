-- Clear generic "Api"/"Manual" tipo values so next sync re-resolves via CNPJ lookup.
UPDATE public.bling_stores
SET tipo = NULL
WHERE tipo IS NOT NULL AND lower(trim(tipo)) IN ('api','manual','outros','outro','');

UPDATE public.bling_product_stores
SET store_type = NULL
WHERE store_type IS NOT NULL AND lower(trim(store_type)) IN ('api','manual','outros','outro','');