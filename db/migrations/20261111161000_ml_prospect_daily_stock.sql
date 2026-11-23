BEGIN;
CREATE OR REPLACE FUNCTION public.sync_ml_prospect_catalog_stock(_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p record; m record; f uuid; target numeric; previous numeric; enabled_ml boolean;
BEGIN
 SELECT * INTO p FROM public.bling_products WHERE id=_product_id AND source='garimpo_ml' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('changed',false); END IF;
 SELECT * INTO m FROM public.ml_product_matches WHERE product_id=p.id;
 IF NOT FOUND OR m.error IS NOT NULL THEN RETURN jsonb_build_object('changed',false); END IF;
 SELECT id INTO f FROM public.fornecedores WHERE codigo='mercadolivre';
 target:=CASE WHEN m.qualifies AND m.has_stock AND p.preco >= coalesce(m.best_total_price,m.best_price)*1.4 THEN least(10,greatest(0,coalesce(m.available_quantity,0))) ELSE 0 END;
 UPDATE public.fornecedor_produtos SET qt_estoque=target,estoque=target::text,
   precos=CASE WHEN m.best_price>0 THEN jsonb_build_object('base',m.best_price) ELSE precos END,
   updated_at=now() WHERE fornecedor_id=f AND codigo=regexp_replace(m.catalog_product_id,'^MLB','','i');
 SELECT coalesce((options->>'consider_ml_stock')::boolean,true) INTO enabled_ml
 FROM public.automation_schedules WHERE company_id=p.company_id AND enabled ORDER BY updated_at DESC LIMIT 1;
 IF enabled_ml=false THEN target:=0; END IF;
 previous:=p.estoque;
 UPDATE public.bling_products SET estoque=target,dirty=true,updated_at=now()
 WHERE id=p.id AND estoque IS DISTINCT FROM target;
 RETURN jsonb_build_object('changed',previous IS DISTINCT FROM target,'stock',target);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_ml_prospect_catalog_stock(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_ml_prospect_catalog_stock(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_ml_prospect_stock(_company_id uuid,_product_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE integ record; n integer;
BEGIN
 SELECT id,default_deposito_id INTO integ FROM public.bling_integrations
 WHERE company_id=_company_id AND status='conectada' LIMIT 1;
 IF NOT FOUND THEN RETURN 0; END IF;
 PERFORM public.prepare_deposit_stock_targets(_company_id,_product_ids,true);
 INSERT INTO public.bling_push_queue(company_id,integration_id,product_id,bling_product_id,bling_deposit_id,tipo,valor_anterior,valor_novo)
 SELECT p.company_id,integ.id,p.id,p.bling_product_id,integ.default_deposito_id,'estoque',p.ultimo_estoque_sincronizado,p.estoque
 FROM public.bling_products p
 WHERE p.company_id=_company_id AND p.id=ANY(_product_ids) AND p.source='garimpo_ml'
 AND p.bling_product_id IS NOT NULL AND p.situacao IN ('A','Ativo','ativo','ATIVO')
 AND (EXISTS(SELECT 1 FROM public.bling_product_deposit_stock s WHERE s.product_id=p.id AND s.pendente)
 OR (NOT EXISTS(SELECT 1 FROM public.bling_stock_deposits d WHERE d.company_id=_company_id AND d.ativo)
 AND integ.default_deposito_id IS NOT NULL AND p.ultimo_estoque_sincronizado IS DISTINCT FROM p.estoque))
 ON CONFLICT (integration_id,product_id,tipo) WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
 DO UPDATE SET valor_novo=excluded.valor_novo,updated_at=now();
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_ml_prospect_stock(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_ml_prospect_stock(uuid,uuid[]) TO service_role;

-- Treat ML as an ML source even though it has a supplier catalog row: sem_ml is zero.
DO $$ DECLARE body text;
BEGIN
 SELECT pg_get_functiondef('public.prepare_deposit_stock_targets(uuid,uuid[],boolean)'::regprocedure) INTO body;
 body:=replace(body, 'WHEN d.modo = ''sem_ml'' AND b.estoque_fornecedor IS NOT NULL',
 'WHEN d.modo = ''sem_ml'' AND b.sup_codigo = ''mercadolivre'' THEN 0
      WHEN d.modo = ''sem_ml'' AND b.estoque_fornecedor IS NOT NULL');
 EXECUTE body;
END $$;
DO $$ DECLARE body text;
BEGIN
 SELECT pg_get_functiondef('public.automation_update_stock_only(uuid,uuid,boolean)'::regprocedure) INTO body;
 body:=replace(body,'WHEN fp.qt_estoque IS NULL THEN NULL',
 'WHEN m.sup_codigo=''mercadolivre'' THEN CASE WHEN coalesce(_consider_ml_stock,true) THEN coalesce((SELECT least(10,greatest(0,mm.available_quantity)) FROM public.ml_product_matches mm JOIN public.bling_products bp ON bp.id=mm.product_id WHERE mm.product_id=m.id AND mm.qualifies AND mm.has_stock AND mm.error IS NULL AND bp.preco>=coalesce(mm.best_total_price,mm.best_price)*1.4),0) ELSE 0 END
      WHEN fp.qt_estoque IS NULL THEN NULL');
 EXECUTE body;
END $$;
COMMIT;