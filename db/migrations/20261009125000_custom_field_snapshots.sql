CREATE OR REPLACE FUNCTION public.save_custom_field_snapshots(_company_id uuid, _snapshots jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_snapshots) s
    LEFT JOIN public.bling_products p ON p.id = (s->>'product_id')::uuid AND p.company_id = _company_id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Produto inválido para esta empresa';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_snapshots) s CROSS JOIN LATERAL jsonb_array_elements(s->'values') v
    LEFT JOIN public.bling_custom_fields f ON f.id = (v->>'custom_field_id')::uuid AND f.company_id = _company_id WHERE f.id IS NULL) THEN
    RAISE EXCEPTION 'Campo inválido para esta empresa';
  END IF;
  DELETE FROM public.bling_product_custom_values WHERE company_id = _company_id
    AND product_id IN (SELECT (s->>'product_id')::uuid FROM jsonb_array_elements(_snapshots) s);
  INSERT INTO public.bling_product_custom_values(company_id,product_id,custom_field_id,id_vinculo,valor,dirty)
  SELECT _company_id,(s->>'product_id')::uuid,(v->>'custom_field_id')::uuid,v->>'id_vinculo',v->>'valor',false
  FROM jsonb_array_elements(_snapshots) s CROSS JOIN LATERAL jsonb_array_elements(s->'values') v;
END $$;
REVOKE ALL ON FUNCTION public.save_custom_field_snapshots(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_custom_field_snapshots(uuid,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';