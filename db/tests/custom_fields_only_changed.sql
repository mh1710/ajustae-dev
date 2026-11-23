\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE c uuid; owner_id uuid; integ uuid; prod_a uuid; prod_b uuid; cf uuid; job uuid; n int;
BEGIN
  SELECT owner_user_id INTO owner_id FROM public.companies LIMIT 1;
  INSERT INTO public.companies(owner_user_id,nome) VALUES(owner_id,'Teste envio so o que mudou') RETURNING id INTO c;
  INSERT INTO public.bling_integrations(company_id) VALUES(c) RETURNING id INTO integ;
  INSERT INTO public.bling_products(company_id,codigo,bling_product_id) VALUES(c,'TEST-IGUAL','900001') RETURNING id INTO prod_a;
  INSERT INTO public.bling_products(company_id,codigo,bling_product_id) VALUES(c,'TEST-DIFERENTE','900002') RETURNING id INTO prod_b;
  INSERT INTO public.bling_custom_fields(company_id,integration_id,bling_id_campo,nome) VALUES(c,integ,'999003','Garantia') RETURNING id INTO cf;
  -- prod_a já tem no Bling exatamente o valor que será enviado; prod_b tem outro.
  INSERT INTO public.bling_product_custom_values(company_id,product_id,custom_field_id,valor) VALUES(c,prod_a,cf,'3');
  INSERT INTO public.bling_product_custom_values(company_id,product_id,custom_field_id,valor) VALUES(c,prod_b,cf,'12');

  INSERT INTO public.bling_custom_field_jobs(company_id,integration_id,kind,status,field_id,valor)
    VALUES(c,integ,'push','pausado',cf,'3') RETURNING id INTO job;
  n := public.fill_custom_field_push_items(job,c,NULL,NULL,NULL,NULL);
  IF n <> 1 THEN RAISE EXCEPTION 'Deveria enfileirar apenas 1 produto, enfileirou %', n; END IF;
  IF EXISTS(SELECT 1 FROM public.bling_custom_field_push_items WHERE job_id=job AND product_id=prod_a) THEN
    RAISE EXCEPTION 'Produto com valor igual não deveria entrar na fila';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.bling_custom_field_push_items WHERE job_id=job AND product_id=prod_b) THEN
    RAISE EXCEPTION 'Produto com valor diferente deveria entrar na fila';
  END IF;

  -- Produto sem valor conhecido entra na fila (precisa ser gravado no Bling).
  INSERT INTO public.bling_products(company_id,codigo,bling_product_id) VALUES(c,'TEST-SEM-VALOR','900003') RETURNING id INTO prod_a;
  INSERT INTO public.bling_custom_field_jobs(company_id,integration_id,kind,status,field_id,valor)
    VALUES(c,integ,'push','pausado',cf,'3') RETURNING id INTO job;
  n := public.fill_custom_field_push_items(job,c,ARRAY[prod_a],NULL,NULL,NULL);
  IF n <> 1 THEN RAISE EXCEPTION 'Produto sem valor conhecido deveria entrar na fila'; END IF;
END $$;
ROLLBACK;
