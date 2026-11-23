BEGIN;
SET LOCAL statement_timeout = '60s';
DO $$
<<audit_unverifiable_images>>
DECLARE p public.bling_products%ROWTYPE; r uuid; run_id uuid; outcome text; reason_text text;
BEGIN
 SELECT * INTO p FROM public.bling_products WHERE codigo='O338274' LIMIT 1;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Missing image audit fixture product'; END IF;
 PERFORM set_config('request.jwt.claim.sub',(SELECT user_id::text FROM public.company_users WHERE company_id=p.company_id AND ativo=true LIMIT 1),true);
 SELECT id INTO r FROM public.validation_rules WHERE slug='imagem-placeholder' AND active=true LIMIT 1;
 UPDATE public.bling_products SET url_imagens_externas='https://images.example.com/unverifiable-test.jpg' WHERE id=p.id;
 INSERT INTO public.image_audit_cache(url_key,status,version,reason)
 VALUES('images.example.com/unverifiable-test.jpg','unknown',1,'Imagem indisponível (403).')
 ON CONFLICT(url_key) DO UPDATE SET status=excluded.status,version=excluded.version,reason=excluded.reason;
 INSERT INTO public.audit_runs(company_id,user_id,status,product_ids,rule_ids,total_products,only_active,started_at,image_scan_started,image_scan_done)
 VALUES(p.company_id,auth.uid(),'processando',ARRAY[p.id],ARRAY[r],1,false,now(),true,true) RETURNING id INTO run_id;
 PERFORM public.finish_image_audit_run(run_id);
 SELECT ar.status,ar.details->'failures'->0->>'reason' INTO outcome,reason_text FROM public.audit_results ar WHERE ar.run_id=audit_unverifiable_images.run_id AND ar.rule_slug='imagem-placeholder';
 IF outcome IS DISTINCT FROM 'error' OR reason_text IS DISTINCT FROM 'Imagem indisponível (403).' THEN RAISE EXCEPTION 'Inaccessible photo must fail with access reason'; END IF;
 IF (SELECT last_audit_errors FROM public.bling_products WHERE id=p.id) < 1 THEN RAISE EXCEPTION 'Product error total must include photo failure'; END IF;
 DROP TABLE IF EXISTS _xprods;
 UPDATE public.image_audit_cache SET reason='Formato não verificado: é necessário JPEG ou PNG.' WHERE url_key='images.example.com/unverifiable-test.jpg';
 PERFORM public.run_audit_extra_rules(run_id);
 SELECT ar.status,ar.details->'failures'->0->>'reason' INTO outcome,reason_text FROM public.audit_results ar WHERE ar.run_id=audit_unverifiable_images.run_id AND ar.rule_slug='imagem-placeholder';
 IF outcome IS DISTINCT FROM 'error' OR reason_text IS DISTINCT FROM 'Formato não verificado: é necessário JPEG ou PNG.' THEN RAISE EXCEPTION 'Unsupported format must fail with format reason'; END IF;
 DROP TABLE IF EXISTS _xprods;
 UPDATE public.image_audit_cache SET status='valid',reason=NULL WHERE url_key='images.example.com/unverifiable-test.jpg';
 PERFORM public.run_audit_extra_rules(run_id);
 IF EXISTS(SELECT 1 FROM public.audit_results ar WHERE ar.run_id=audit_unverifiable_images.run_id AND ar.rule_slug='imagem-placeholder') THEN RAISE EXCEPTION 'Valid photo must pass'; END IF;
 RAISE NOTICE 'Inaccessible and unsupported photos fail; valid photo passes; totals updated.';
END;
$$;
ROLLBACK;