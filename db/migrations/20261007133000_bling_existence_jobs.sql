-- Snapshot verification jobs; deletion evidence survives the deleted product.
CREATE TABLE public.bling_existence_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE, created_by uuid REFERENCES auth.users(id),
 status text NOT NULL DEFAULT 'executando' CHECK(status IN('executando','pausado','cancelado','concluido','erro')),
 total int NOT NULL DEFAULT 0, done_count int NOT NULL DEFAULT 0, existing_count int NOT NULL DEFAULT 0,
 deleted_count int NOT NULL DEFAULT 0, skipped_count int NOT NULL DEFAULT 0, error_count int NOT NULL DEFAULT 0,
 last_error text, lease_token uuid, lease_until timestamptz, heartbeat_at timestamptz NOT NULL DEFAULT now(),
 next_tick_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz
);
GRANT SELECT ON public.bling_existence_jobs TO authenticated;
GRANT ALL ON public.bling_existence_jobs TO service_role;
ALTER TABLE public.bling_existence_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read existence jobs" ON public.bling_existence_jobs FOR SELECT TO authenticated USING(app_private.is_company_member(company_id,auth.uid()));
CREATE UNIQUE INDEX bej_single_company ON public.bling_existence_jobs(company_id) WHERE status IN('executando','pausado','erro');
CREATE INDEX bej_company_time ON public.bling_existence_jobs(company_id,started_at DESC);

CREATE TABLE public.bling_existence_items (
 job_id uuid NOT NULL REFERENCES public.bling_existence_jobs(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 product_id uuid NOT NULL, bling_product_id text, codigo text, nome text,
 status text NOT NULL DEFAULT 'pendente' CHECK(status IN('pendente','existe','excluido','ignorado','erro')),
 http_status int, evidence jsonb, erro text, checked_at timestamptz,
 PRIMARY KEY(job_id,product_id)
);
GRANT SELECT ON public.bling_existence_items TO authenticated;
GRANT ALL ON public.bling_existence_items TO service_role;
ALTER TABLE public.bling_existence_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read existence items" ON public.bling_existence_items FOR SELECT TO authenticated USING(app_private.is_company_member(company_id,auth.uid()));
CREATE INDEX bei_pending ON public.bling_existence_items(job_id,status,product_id);

CREATE FUNCTION public.start_bling_existence_job(_company_id uuid,_user_id uuid,_ids uuid[] DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='120s' AS $$
DECLARE j uuid; integ uuid; n int;
BEGIN
 IF NOT app_private.is_company_member(_company_id,_user_id) THEN RAISE EXCEPTION 'Sem acesso à empresa.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('bling-existence:'||_company_id::text,0));
 IF EXISTS(SELECT 1 FROM bling_existence_jobs WHERE company_id=_company_id AND status IN('executando','pausado','erro')) THEN RAISE EXCEPTION 'Retome ou cancele a verificação anterior.'; END IF;
 SELECT id INTO integ FROM bling_integrations WHERE company_id=_company_id;
 IF integ IS NULL THEN RAISE EXCEPTION 'Empresa sem integração com o Bling.'; END IF;
 IF _ids IS NOT NULL AND cardinality(_ids)=0 THEN RAISE EXCEPTION 'Nenhum produto selecionado.'; END IF;
 IF _ids IS NOT NULL AND EXISTS(SELECT 1 FROM unnest(_ids) s(id) WHERE NOT EXISTS(SELECT 1 FROM bling_products p WHERE p.id=s.id AND p.company_id=_company_id)) THEN RAISE EXCEPTION 'Produto fora da empresa selecionada.'; END IF;
 INSERT INTO bling_existence_jobs(company_id,integration_id,created_by) VALUES(_company_id,integ,_user_id) RETURNING id INTO j;
 INSERT INTO bling_existence_items(job_id,company_id,product_id,bling_product_id,codigo,nome)
 SELECT j,_company_id,p.id,p.bling_product_id::text,p.codigo,p.nome FROM bling_products p WHERE p.company_id=_company_id AND (_ids IS NULL OR p.id=ANY(_ids));
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n=0 THEN RAISE EXCEPTION 'Nenhum produto para verificar.'; END IF;
 UPDATE bling_existence_jobs SET total=n WHERE id=j;
 RETURN j;
END $$;
REVOKE ALL ON FUNCTION public.start_bling_existence_job(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_bling_existence_job(uuid,uuid,uuid[]) TO service_role;

-- Only trusted worker can commit; fenced lease and unchanged snapshot guard destructive writes.
CREATE OR REPLACE FUNCTION public.finish_bling_existence_item(_job_id uuid,_token uuid,_product_id uuid,_status text,_http int,_evidence jsonb,_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j bling_existence_jobs; i bling_existence_items; p bling_products; outcome text:=_status; removed int;
BEGIN
 SELECT * INTO j FROM bling_existence_jobs WHERE id=_job_id AND lease_token=_token AND status='executando' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO i FROM bling_existence_items WHERE job_id=_job_id AND product_id=_product_id AND status='pendente' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF outcome NOT IN('existe','excluido','ignorado','erro') THEN RAISE EXCEPTION 'Invalid outcome'; END IF;
 IF outcome='excluido' THEN
   IF _http IS DISTINCT FROM 404 OR coalesce((_evidence->>'confirmed_twice')::boolean,false) IS NOT TRUE OR coalesce((_evidence->>'health_ok')::boolean,false) IS NOT TRUE
     OR _evidence->>'bling_product_id' IS DISTINCT FROM i.bling_product_id THEN RAISE EXCEPTION 'Missing absence evidence'; END IF;
   SELECT * INTO p FROM bling_products WHERE id=i.product_id AND company_id=j.company_id FOR UPDATE;
   IF NOT FOUND OR p.bling_product_id::text IS DISTINCT FROM i.bling_product_id OR p.codigo IS DISTINCT FROM i.codigo THEN
     outcome:='ignorado'; _error:='Produto removido ou modificado durante a verificação; nenhuma exclusão realizada.';
   ELSE
     -- Store links must not become orphaned. Order/history references use SET NULL and are retained.
     DELETE FROM bling_product_stores WHERE internal_product_id=i.product_id AND company_id=j.company_id;
     DELETE FROM bling_products WHERE id=i.product_id AND company_id=j.company_id AND bling_product_id::text=i.bling_product_id;
     GET DIAGNOSTICS removed=ROW_COUNT;
     IF removed<>1 THEN RAISE EXCEPTION 'Product deletion not confirmed'; END IF;
   END IF;
 END IF;
 UPDATE bling_existence_items SET status=outcome,http_status=_http,evidence=_evidence,erro=_error,checked_at=now() WHERE job_id=_job_id AND product_id=_product_id;
 UPDATE bling_existence_jobs SET done_count=done_count+1,
 existing_count=existing_count+CASE WHEN outcome='existe' THEN 1 ELSE 0 END,
 deleted_count=deleted_count+CASE WHEN outcome='excluido' THEN 1 ELSE 0 END,
 skipped_count=skipped_count+CASE WHEN outcome='ignorado' THEN 1 ELSE 0 END,
 error_count=error_count+CASE WHEN outcome='erro' THEN 1 ELSE 0 END,heartbeat_at=now() WHERE id=_job_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_bling_existence_item(uuid,uuid,uuid,text,int,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_bling_existence_item(uuid,uuid,uuid,text,int,jsonb,text) TO service_role;

-- Reuse configured private scheduler credentials without embedding them in source.
DO $$ DECLARE cmd text;
BEGIN
 SELECT command INTO cmd FROM cron.job WHERE jobname='app-tick';
 IF cmd IS NOT NULL THEN
 cmd:=replace(replace(cmd,'/api/public/automations/tick','/api/public/bling/existence-tick'),'timeout_milliseconds := 8000','timeout_milliseconds := 600000');
 cmd:='DO $tick$ BEGIN IF EXISTS(SELECT 1 FROM public.bling_existence_jobs WHERE status=''executando'' AND next_tick_at<=now() AND (lease_until IS NULL OR lease_until<now())) THEN '||replace(cmd,'SELECT net.http_post','PERFORM net.http_post')||'; END IF; END $tick$;';
 PERFORM cron.schedule('bling-existence-tick','10 seconds',cmd);
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
