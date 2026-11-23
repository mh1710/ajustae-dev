-- Fence worker ownership and keep progress atomically with each item.
ALTER TABLE public.product_category_jobs ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE public.product_category_jobs ADD COLUMN IF NOT EXISTS next_tick_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.product_category_jobs ADD COLUMN IF NOT EXISTS blocked_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS pcj_single_active_company ON public.product_category_jobs(company_id) WHERE status IN ('executando','pausado');
CREATE TABLE IF NOT EXISTS public.category_ai_access (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), blocked_reason text, message text, updated_at timestamptz DEFAULT now()
);
GRANT ALL ON public.category_ai_access TO service_role;
ALTER TABLE public.category_ai_access ENABLE ROW LEVEL SECURITY;
INSERT INTO public.category_ai_access(id) VALUES(true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.complete_category_item(_job_id uuid, _token uuid, _product_id uuid, _result jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n int;
BEGIN
 PERFORM 1 FROM product_category_jobs WHERE id=_job_id AND lease_token=_token AND status='executando' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE product_category_job_items SET status=_result->>'status',nome_busca=_result->>'nome_busca',nome_origem=_result->>'nome_origem',
 category_id=_result->>'category_id',category_path=_result->>'category_path',ml_product_id=_result->>'ml_product_id',
 ml_product_title=_result->>'ml_product_title',match_by=_result->>'match_by',erro=_result->>'erro'
 WHERE job_id=_job_id AND product_id=_product_id AND status='pendente';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n=0 THEN RETURN false; END IF;
 UPDATE product_category_jobs SET done_count=done_count+1,found_count=found_count+CASE WHEN _result->>'status'='encontrado' THEN 1 ELSE 0 END,
 error_count=error_count+CASE WHEN _result->>'status'='erro' THEN 1 ELSE 0 END,heartbeat_at=now() WHERE id=_job_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.complete_category_item(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_category_item(uuid,uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.review_category_items(_company_id uuid,_user_id uuid,_job_id uuid,_ids uuid[],_action text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='120s' AS $$
DECLARE n int;
BEGIN
 IF NOT app_private.is_company_member(_company_id,_user_id) OR NOT EXISTS(SELECT 1 FROM product_category_jobs WHERE id=_job_id AND company_id=_company_id) THEN RAISE EXCEPTION 'Sem acesso'; END IF;
 IF _action NOT IN ('save','discard') OR _ids IS NULL OR cardinality(_ids)=0 THEN RAISE EXCEPTION 'Selecione os produtos revisados'; END IF;
 PERFORM 1 FROM product_category_job_items WHERE job_id=_job_id AND product_id=ANY(_ids) FOR UPDATE;
 IF _action='save' THEN
 INSERT INTO product_ml_categories(product_id,company_id,ml_category_id,ml_category_path,ml_product_id,ml_product_title,match_by,updated_by,updated_at)
 SELECT i.product_id,_company_id,i.category_id,i.category_path,i.ml_product_id,i.ml_product_title,i.match_by,_user_id,now()
 FROM product_category_job_items i JOIN bling_products p ON p.id=i.product_id AND p.company_id=_company_id
 WHERE i.job_id=_job_id AND i.product_id=ANY(_ids) AND i.company_id=_company_id AND i.status='encontrado' AND i.review='pendente'
 ON CONFLICT(product_id) DO UPDATE SET ml_category_id=excluded.ml_category_id,ml_category_path=excluded.ml_category_path,
 ml_product_id=excluded.ml_product_id,ml_product_title=excluded.ml_product_title,match_by=excluded.match_by,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 END IF;
 UPDATE product_category_job_items SET review=CASE WHEN _action='save' THEN 'salvo' ELSE 'descartado' END
 WHERE job_id=_job_id AND company_id=_company_id AND product_id=ANY(_ids) AND status='encontrado' AND review='pendente';
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.review_category_items(uuid,uuid,uuid,uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_category_items(uuid,uuid,uuid,uuid[],text) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_category_tick(_url text,_secret text,_body jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE n bigint;
BEGIN
 IF _url !~ '/api/public/categories/tick$' THEN RAISE EXCEPTION 'Invalid endpoint'; END IF;
 SELECT id INTO n FROM net.http_request_queue WHERE url=_url AND convert_from(body,'utf8')::jsonb=_body LIMIT 1;
 IF n IS NOT NULL THEN RETURN n; END IF;
 SELECT net.http_post(url:=_url,headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',_secret),body:=_body,timeout_milliseconds:=600000) INTO n;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_category_tick(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_category_tick(text,text,jsonb) TO service_role;

-- Reuse the installed scheduler's secret server-side; no secrets embedded in migration source.
DO $$
DECLARE cmd text;
BEGIN
 SELECT command INTO cmd FROM cron.job WHERE jobname='app-tick';
 IF cmd IS NOT NULL THEN
 cmd:=replace(replace(cmd,'/api/public/automations/tick','/api/public/categories/tick'),'timeout_milliseconds := 8000','timeout_milliseconds := 600000');
 cmd:='DO $tick$ BEGIN IF EXISTS (SELECT 1 FROM public.product_category_jobs WHERE status=''executando'' AND next_tick_at<=now() AND (lease_until IS NULL OR lease_until<now())) THEN '||cmd||'; END IF; END $tick$;';
 -- SELECT in a DO block must be PERFORM.
 cmd:=replace(cmd,'SELECT net.http_post','PERFORM net.http_post');
 PERFORM cron.schedule('category-tick','10 seconds',cmd);
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
CREATE OR REPLACE FUNCTION public.recount_category_job(_job_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE product_category_jobs j SET done_count=x.done,found_count=x.found,error_count=x.errors FROM
 (SELECT count(*) FILTER(WHERE status<>'pendente')::int done,count(*) FILTER(WHERE status='encontrado')::int found,count(*) FILTER(WHERE status='erro')::int errors FROM product_category_job_items WHERE job_id=_job_id) x WHERE j.id=_job_id;
$$;
REVOKE ALL ON FUNCTION public.recount_category_job(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recount_category_job(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
ALTER TABLE public.product_category_jobs ADD COLUMN IF NOT EXISTS retry_count int NOT NULL DEFAULT 0;
-- Do not hide unreviewed results by starting a new job for the same company.
CREATE OR REPLACE FUNCTION public.guard_category_job_start() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,0));
 IF EXISTS(SELECT 1 FROM product_category_job_items WHERE company_id=NEW.company_id AND status='encontrado' AND review='pendente') THEN RAISE EXCEPTION 'Revise as categorias pendentes antes de iniciar outra busca.'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_category_start ON public.product_category_jobs;
CREATE TRIGGER guard_category_start BEFORE INSERT ON public.product_category_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_category_job_start();
NOTIFY pgrst,'reload schema';
