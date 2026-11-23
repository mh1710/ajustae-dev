UPDATE public.bling_products
SET estoque = COALESCE(NULLIF((dados_resumidos_json->'estoque'->>'saldoVirtualTotal'),'')::numeric, 0)
WHERE company_id = '5141ff1f-5803-4bd2-8eee-69f4783d413e';