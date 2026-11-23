BEGIN;
DO $$
DECLARE p record; supplier_id uuid; r jsonb; v record;
BEGIN
  SELECT bp.id,bp.company_id,cu.user_id INTO STRICT p
  FROM public.bling_products bp JOIN public.company_users cu ON cu.company_id=bp.company_id AND cu.ativo=true
  WHERE bp.codigo='387289' AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=cu.user_id AND ur.role::text='company_viewer') LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub',p.user_id::text,true);
  SELECT fp.id INTO STRICT supplier_id FROM public.fornecedor_produtos fp JOIN public.fornecedores f ON f.id=fp.fornecedor_id
    WHERE f.codigo='evolusom' AND fp.codigo='387289';
  UPDATE public.fornecedor_produtos SET peso=0.212,altura=5.5,largura=15.5,comprimento=14.5,ativo=true WHERE id=supplier_id;
  UPDATE public.bling_products SET peso_liquido=0,peso_bruto=0,altura=0,largura=0,profundidade=0 WHERE id=p.id;
  r:=public.transform_fill_dimensions_from_supplier(p.company_id,ARRAY[p.id]);
  SELECT * INTO v FROM public.bling_products WHERE id=p.id;
  IF r->>'updated'<>'1' OR r->>'resolved'<>'1' OR v.peso_liquido<>0.212 OR v.altura<>5.5 OR v.largura<>15.5 OR v.profundidade<>14.5 THEN
    RAISE EXCEPTION 'Exact prefixless SKU must fill actual supplier attributes: %',r;
  END IF;
  UPDATE public.fornecedor_produtos SET codigo='987654321091' WHERE id=supplier_id;
  UPDATE public.bling_products SET codigo=(SELECT prefix FROM public.supplier_prefix_map WHERE supplier_codigo='evolusom' ORDER BY length(prefix) DESC LIMIT 1)||'987654321091',peso_liquido=-1,altura=99,largura=-1,profundidade=0 WHERE id=p.id;
  r:=public.transform_fill_dimensions_from_supplier(p.company_id,ARRAY[p.id]);
  SELECT * INTO v FROM public.bling_products WHERE id=p.id;
  IF v.peso_liquido<>0.212 OR v.altura<>99 OR v.largura<>15.5 OR v.profundidade<>14.5 THEN RAISE EXCEPTION 'Preserve positive fields and fix negative fields'; END IF;
  UPDATE public.fornecedor_produtos SET comprimento=0 WHERE id=supplier_id;
  UPDATE public.bling_products SET profundidade=0 WHERE id=p.id;
  r:=public.transform_fill_dimensions_from_supplier(p.company_id,ARRAY[p.id]);
  IF r->>'supplier_incomplete'<>'1' OR r->>'resolved'<>'0' OR r->>'updated'<>'0' THEN RAISE EXCEPTION 'Missing supplier data must remain unresolved: %',r; END IF;
  UPDATE public.bling_products SET codigo='UNKNOWN387289' WHERE id=p.id;
  r:=public.transform_fill_dimensions_from_supplier(p.company_id,ARRAY[p.id]);
  IF r->>'not_found'<>'1' OR r->>'updated'<>'0' THEN RAISE EXCEPTION 'Unknown prefix broadened matching'; END IF;
  r:=public.transform_fill_dimensions_from_supplier(p.company_id,ARRAY[]::uuid[]);
  IF r->>'candidates'<>'0' OR r->>'updated'<>'0' THEN RAISE EXCEPTION 'Empty selection widened scope'; END IF;
END $$;
ROLLBACK;