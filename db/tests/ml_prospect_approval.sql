BEGIN;
DO $$ DECLARE c uuid; i uuid; blocked boolean:=false;
BEGIN
 SELECT id INTO c FROM public.companies LIMIT 1;
 SELECT id INTO i FROM public.ml_prospect_items LIMIT 1;
 IF c IS NULL OR i IS NULL THEN RAISE EXCEPTION 'Real staging fixtures required'; END IF;
 BEGIN
  PERFORM public.import_ml_prospect_items(c,ARRAY[i]);
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%sem aprovação completa%' THEN blocked:=true; ELSE RAISE; END IF;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'Unreviewed candidate was imported'; END IF;
 IF has_table_privilege('authenticated','public.ml_prospect_approvals','INSERT') THEN
  RAISE EXCEPTION 'Users can forge audit approvals';
 END IF;
END $$;
DO $$ DECLARE c uuid; i record; r jsonb; p uuid; result jsonb;
BEGIN
 SELECT bi.company_id INTO c FROM public.bling_integrations bi JOIN public.automation_schedules s ON s.company_id=bi.company_id WHERE bi.status='conectada' AND s.enabled AND coalesce((s.options->>'consider_ml_stock')::boolean,true) LIMIT 1;
 SELECT * INTO i FROM public.ml_prospect_items LIMIT 1;
 -- Transaction-only approval fixture; nothing is sent to the external Bling API.
 UPDATE public.ml_prospect_items SET raw=raw || jsonb_build_object('review',jsonb_build_object('titulo','Produto de teste', 'descricao_curta','Descrição conferida', 'anatel','Não se aplica')) WHERE id=i.id;
 SELECT * INTO i FROM public.ml_prospect_items WHERE id=i.id;
 INSERT INTO public.ml_prospect_approvals(company_id,item_id,item_snapshot,sale_price,expires_at)
 VALUES(c,i.id,to_jsonb(i),1000,now()+interval '2 minutes');
 r:=public.import_ml_prospect_items(c,ARRAY[i.id]);
 p:=(r->'product_ids'->>0)::uuid;
 IF p IS NULL THEN RAISE EXCEPTION 'Fixture not imported'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.bling_push_queue WHERE product_id=p AND tipo='criar' AND status='pendente') THEN RAISE EXCEPTION 'Creation not queued atomically'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ml_product_matches WHERE product_id=p AND catalog_product_id=i.catalog_product_id) THEN RAISE EXCEPTION 'Daily refresh identity missing'; END IF;
 UPDATE public.ml_product_matches SET qualifies=true,has_stock=true,available_quantity=50,best_price=100,best_total_price=100,error=null WHERE product_id=p;
 result:=public.sync_ml_prospect_catalog_stock(p);
 IF (result->>'stock')::numeric<>10 THEN RAISE EXCEPTION 'Stock cap failed: %',result; END IF;
 UPDATE public.ml_product_matches SET qualifies=false,has_stock=false WHERE product_id=p;
 result:=public.sync_ml_prospect_catalog_stock(p);
 IF (result->>'stock')::numeric<>0 THEN RAISE EXCEPTION 'Unavailable stock not cleared'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ml_product_matches WHERE product_id=p) THEN RAISE EXCEPTION 'Lost catalog identity prevents recovery'; END IF;
END $$;
ROLLBACK;