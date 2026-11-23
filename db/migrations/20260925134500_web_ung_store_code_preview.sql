-- A Web Continental da UNG aparece no Bling como "Web ung".
-- Incluímos esse nome no reconhecimento específico da transformação.
CREATE OR REPLACE FUNCTION public.match_marketplace_store_code(
  _company_id uuid,
  _marketplace text,
  _product_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  product_id uuid,
  bling_product_id text,
  bling_product_store_id text,
  bling_store_id text,
  store_name text,
  codigo_atual text,
  codigo_novo text,
  preco numeric,
  preco_promocional numeric,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    bps.internal_product_id,
    p.bling_product_id,
    bps.bling_product_store_id,
    bps.bling_store_id,
    bps.store_name,
    bps.store_product_code,
    CASE _marketplace
      WHEN 'kabum' THEN nullif(btrim(p.codigo), '')
      WHEN 'web_continental' THEN nullif(btrim(bps.bling_store_id), '')
    END,
    bps.current_price,
    bps.current_promotional_price,
    CASE
      WHEN _marketplace NOT IN ('kabum', 'web_continental') THEN 'marketplace_invalido'
      WHEN nullif(btrim(p.bling_product_id), '') IS NULL
        OR nullif(btrim(bps.bling_product_store_id), '') IS NULL
        OR nullif(btrim(bps.bling_store_id), '') IS NULL
        OR bps.current_price IS NULL THEN 'sem_dados'
      WHEN (_marketplace = 'kabum' AND nullif(btrim(p.codigo), '') IS NULL) THEN 'sem_dados'
      WHEN btrim(coalesce(bps.store_product_code, '')) = btrim(CASE _marketplace
        WHEN 'kabum' THEN coalesce(p.codigo, '')
        WHEN 'web_continental' THEN coalesce(bps.bling_store_id, '')
      END) THEN 'ja_correto'
      ELSE 'atualizar'
    END
  FROM public.bling_product_stores bps
  JOIN public.bling_products p
    ON p.id = bps.internal_product_id
   AND p.company_id = bps.company_id
  WHERE bps.company_id = _company_id
    AND bps.is_linked = true
    AND (_product_ids IS NULL OR bps.internal_product_id = ANY(_product_ids))
    AND (
      (_marketplace = 'kabum' AND (
        lower(coalesce(bps.store_type, '')) = 'kabum'
        OR lower(coalesce(bps.store_name, '')) LIKE '%kabum%'
      ))
      OR
      (_marketplace = 'web_continental' AND (
        lower(coalesce(bps.store_name, '')) LIKE '%webco%'
        OR lower(coalesce(bps.store_name, '')) LIKE '%continental%'
        OR lower(coalesce(bps.store_name, '')) LIKE '%web ung%'
      ))
    );
$$;

REVOKE ALL ON FUNCTION public.match_marketplace_store_code(uuid, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_marketplace_store_code(uuid, text, uuid[]) TO service_role;