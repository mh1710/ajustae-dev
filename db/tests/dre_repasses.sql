BEGIN;
CREATE TEMP TABLE repasse_accounts AS SELECT cu.user_id,cu.company_id FROM public.company_users cu JOIN public.user_roles ur USING(user_id) WHERE cu.ativo AND ur.role='company_viewer';
GRANT SELECT ON repasse_accounts TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE account record; entry public.dre_repasses; other uuid; totals jsonb;
BEGIN
 FOR account IN SELECT * FROM repasse_accounts LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',account.user_id,'role','authenticated')::text,true);
   INSERT INTO public.dre_repasses(company_id,data,cliente,custo_produto,quantidade,custo_etiqueta,custo_boy,custo_embalagem,repasse)
   VALUES(account.company_id,'2026-10-10','Teste de repasse',75.6,2,44.95,5,3,206.89) RETURNING * INTO entry;
   IF entry.resultado<>2.74 OR entry.divisao<>1.37 THEN RAISE EXCEPTION 'Incorrect calculation'; END IF;
  IF EXISTS(SELECT 1 FROM public.dre_repasses WHERE company_id<>account.company_id) THEN RAISE EXCEPTION 'Cross-company read'; END IF;
  SELECT company_id INTO other FROM repasse_accounts WHERE company_id<>account.company_id LIMIT 1;
  BEGIN
   UPDATE public.dre_repasses SET company_id=other WHERE id=entry.id;
   RAISE EXCEPTION 'Cross-company update allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.dre_repasses SET repasse=-55,custo_produto=0,custo_etiqueta=0,custo_boy=0,custo_embalagem=0 WHERE id=entry.id RETURNING * INTO entry;
  IF entry.resultado<>-55 OR entry.divisao<>-27.5 THEN RAISE EXCEPTION 'Negative adjustment incorrect'; END IF;
  DELETE FROM public.dre_repasses WHERE id=entry.id;
 END LOOP;
END $$;
ROLLBACK;