\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE c uuid; u uuid; i uuid; p uuid; result jsonb; n int;
BEGIN
  SELECT cu.company_id, cu.user_id INTO c,u FROM public.company_users cu
    WHERE cu.ativo AND NOT EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=cu.user_id AND ur.role::text='company_viewer') LIMIT 1;
  IF c IS NULL THEN RAISE EXCEPTION 'No unrestricted member fixture'; END IF;
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  SELECT id INTO i FROM public.bling_integrations WHERE company_id=c LIMIT 1;
  INSERT INTO public.bling_products(company_id,codigo,bling_product_id)
    VALUES(c,'TEST-RETRY-DEDUP','9999990001') RETURNING id INTO p;
  -- Exercise only test failures; real company errors remain untouched even in rollback.
  UPDATE public.bling_push_queue SET status='cancelado' WHERE company_id=c AND status='erro';
  INSERT INTO public.bling_push_queue(company_id,integration_id,product_id,bling_product_id,tipo,valor_novo,status,bling_product_store_id)
    VALUES(c,i,p,'9999990001','preco',1,'pendente',NULL),
      (c,i,p,'9999990001','preco',2,'erro',NULL),
      (c,i,p,'9999990001','preco_loja',3,'processando','test-store-a'),
      (c,i,p,'9999990001','preco_loja',4,'erro','test-store-a'),
      (c,i,p,'9999990001','preco_loja',5,'erro','test-store-b'),
      (c,i,p,'9999990001','estoque',6,'erro',NULL),
      (c,i,p,'9999990001','estoque',7,'erro',NULL);
  result := public.retry_bling_push_errors(c);
  IF (result->>'reenfileirados')::int <> 2 THEN RAISE EXCEPTION 'Expected two distinct retries: %',result; END IF;
  SELECT count(*) INTO n FROM public.bling_push_queue WHERE product_id=p AND tipo='preco' AND status='pendente';
  IF n <> 1 THEN RAISE EXCEPTION 'Pending non-store work must not be duplicated'; END IF;
  SELECT count(*) INTO n FROM public.bling_push_queue WHERE product_id=p AND tipo='preco_loja' AND bling_product_store_id='test-store-a' AND status='processando';
  IF n <> 1 THEN RAISE EXCEPTION 'Processing store work must remain intact'; END IF;
  SELECT count(*) INTO n FROM public.bling_push_queue WHERE product_id=p AND tipo='preco_loja' AND bling_product_store_id='test-store-b' AND status='pendente';
  IF n <> 1 THEN RAISE EXCEPTION 'A different store must retry independently'; END IF;
  result := public.retry_bling_push_errors(c);
  IF (result->>'reenfileirados')::int <> 0 THEN RAISE EXCEPTION 'Repeat retry must be idempotent: %',result; END IF;
END $$;
ROLLBACK;