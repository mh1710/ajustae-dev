\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE c uuid; other_c uuid; owner_id uuid; integ uuid; prod uuid; cf uuid; other_cf uuid; job uuid; result jsonb; wait_ms int;
BEGIN
  SELECT owner_user_id INTO owner_id FROM public.companies LIMIT 1;
  INSERT INTO public.companies(owner_user_id,nome) VALUES(owner_id,'Teste limpeza local') RETURNING id INTO c;
  INSERT INTO public.companies(owner_user_id,nome) VALUES(owner_id,'Teste outra empresa') RETURNING id INTO other_c;
  INSERT INTO public.bling_integrations(company_id) VALUES(c) RETURNING id INTO integ;
  INSERT INTO public.bling_products(company_id,codigo) VALUES(c,'TEST-CUSTOM') RETURNING id INTO prod;
  INSERT INTO public.bling_custom_fields(company_id,integration_id,bling_id_campo,nome) VALUES(c,integ,'999001','Teste') RETURNING id INTO cf;
  INSERT INTO public.bling_custom_field_roles(company_id,role,custom_field_id) VALUES(c,'modelo',cf);
  INSERT INTO public.bling_product_custom_values(company_id,product_id,custom_field_id,valor) VALUES(c,prod,cf,'Antigo');
  -- Snapshot vazio elimina valores obsoletos, sem alterar o produto.
  PERFORM public.save_custom_field_snapshots(c,jsonb_build_array(jsonb_build_object('product_id',prod,'values','[]'::jsonb)));
  IF EXISTS(SELECT 1 FROM public.bling_product_custom_values WHERE product_id=prod) THEN RAISE EXCEPTION 'Snapshot vazio não limpou valor'; END IF;
  INSERT INTO public.bling_product_custom_values(company_id,product_id,custom_field_id,valor) VALUES(c,prod,cf,'Novo');
  result := public.clear_local_custom_fields(c,false);
  IF (result->>'values_deleted')::int <> 1 OR (result->>'fields_deleted')::int <> 0 THEN RAISE EXCEPTION 'Contagem incorreta'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.bling_custom_field_roles WHERE company_id=c) THEN RAISE EXCEPTION 'Apontamento foi apagado'; END IF;
  INSERT INTO public.bling_custom_field_jobs(company_id,integration_id,kind,status) VALUES(c,integ,'sync','pausado') RETURNING id INTO job;
  BEGIN
    PERFORM public.clear_local_custom_fields(c,true);
    RAISE EXCEPTION 'Limpeza permitida com tarefa pausada';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Aguarde a tarefa terminar ou cancele antes de limpar os campos.' THEN RAISE; END IF;
  END;
  UPDATE public.bling_custom_field_jobs SET status='cancelado',lease_until=now()+interval '1 minute' WHERE id=job;
  BEGIN
    PERFORM public.clear_local_custom_fields(c,true);
    RAISE EXCEPTION 'Limpeza permitida com worker ativo';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Aguarde a tarefa terminar ou cancele antes de limpar os campos.' THEN RAISE; END IF;
  END;
  UPDATE public.bling_custom_field_jobs SET lease_until=NULL WHERE id=job;
  INSERT INTO public.bling_custom_fields(company_id,integration_id,bling_id_campo,nome) VALUES(other_c,integ,'999002','Outra') RETURNING id INTO other_cf;
  result := public.clear_local_custom_fields(c,true);
  IF (result->>'fields_deleted')::int <> 1 THEN RAISE EXCEPTION 'Campo não removido'; END IF;
  IF EXISTS(SELECT 1 FROM public.bling_custom_field_roles WHERE company_id=c) THEN RAISE EXCEPTION 'Apontamento não removido'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.bling_custom_fields WHERE id=other_cf) THEN RAISE EXCEPTION 'Outra empresa afetada'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.bling_products WHERE id=prod AND codigo='TEST-CUSTOM') THEN RAISE EXCEPTION 'Produto alterado'; END IF;
  IF has_function_privilege('authenticated','public.clear_local_custom_fields(uuid,boolean)','EXECUTE') THEN RAISE EXCEPTION 'Limpeza pública'; END IF;
  -- Duas chamadas não podem ser liberadas juntas na mesma empresa.
  IF public.take_bling_company_slot(c) <> 0 THEN RAISE EXCEPTION 'Primeira chamada bloqueada'; END IF;
  wait_ms := public.take_bling_company_slot(c);
  IF wait_ms <= 0 OR wait_ms > 550 THEN RAISE EXCEPTION 'Limite compartilhado inválido: %',wait_ms; END IF;
  IF public.take_bling_company_slot(other_c) <> 0 THEN RAISE EXCEPTION 'Empresas não independentes'; END IF;
  PERFORM pg_sleep(0.56);
  IF public.take_bling_company_slot(c) <> 0 THEN RAISE EXCEPTION 'Slot não liberado após intervalo'; END IF;
END $$;
ROLLBACK;