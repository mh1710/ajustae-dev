BEGIN;
DO $$
DECLARE destination record; resolved jsonb; checked integer := 0;
BEGIN
 FOR destination IN SELECT company_id,bling_supplier_id FROM public.bling_supplier_map
 WHERE supplier_codigo=public.map_sku_prefix('HA73145')
 AND bling_supplier_id ~ '^[0-9]+$' ORDER BY company_id,bling_supplier_id LOOP
   -- The resolver uses the deterministic first supplier for this company.
   resolved := public.resolve_import_product_supplier(destination.company_id,'HA73145',75.6,'Produto');
   IF resolved IS NULL OR resolved->>'supplier_codigo'<>'hayamax' THEN RAISE EXCEPTION 'Missing mapped Hayamax supplier'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.bling_supplier_map m WHERE m.company_id=destination.company_id
    AND m.bling_supplier_id=resolved->>'bling_supplier_id' AND m.supplier_codigo='hayamax') THEN
    RAISE EXCEPTION 'Supplier belongs to another company';
   END IF;
   IF ltrim(resolved->>'codigo','0')<>'73145' OR (resolved->>'preco_custo')::numeric<=0 THEN RAISE EXCEPTION 'Invalid supplier SKU/cost'; END IF;
   checked := checked + 1;
 END LOOP;
 IF checked < 2 THEN RAISE EXCEPTION 'Need at least two destination companies for isolation check'; END IF;
 IF public.resolve_import_product_supplier('00000000-0000-0000-0000-000000000000','HA73145',75.6,'Produto') IS NOT NULL THEN RAISE EXCEPTION 'Unmapped destination allowed'; END IF;
 IF public.resolve_import_product_supplier('00000000-0000-0000-0000-000000000000','UNKNOWN73145',75.6,'Produto') IS NOT NULL THEN RAISE EXCEPTION 'Unknown prefix allowed'; END IF;
 IF has_function_privilege('authenticated','public.resolve_import_product_supplier(uuid,text,numeric,text)','EXECUTE') THEN RAISE EXCEPTION 'Privileged resolution exposed'; END IF;
END $$;
ROLLBACK;