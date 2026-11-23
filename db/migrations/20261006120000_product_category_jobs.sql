-- Categorização em lote: tarefa com progresso + itens para revisão antes de salvar.
ALTER TABLE public.product_ml_categories DROP CONSTRAINT IF EXISTS product_ml_categories_match_by_check;
ALTER TABLE public.product_ml_categories ADD CONSTRAINT product_ml_categories_match_by_check
  CHECK (match_by IN ('ean', 'titulo', 'categoria', 'ia'));

CREATE TABLE IF NOT EXISTS public.product_category_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'executando' CHECK (status IN ('executando','pausado','cancelado','concluido','erro')),
  use_ai boolean NOT NULL DEFAULT true,
  total int NOT NULL DEFAULT 0,
  done_count int NOT NULL DEFAULT 0,
  found_count int NOT NULL DEFAULT 0,
  error_count int NOT NULL DEFAULT 0,
  last_error text,
  lease_until timestamptz,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS pcj_company_idx ON public.product_category_jobs (company_id, started_at DESC);
GRANT SELECT ON public.product_category_jobs TO authenticated;
GRANT ALL ON public.product_category_jobs TO service_role;
ALTER TABLE public.product_category_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read category jobs" ON public.product_category_jobs;
CREATE POLICY "Members read category jobs" ON public.product_category_jobs FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

CREATE TABLE IF NOT EXISTS public.product_category_job_items (
  job_id uuid NOT NULL REFERENCES public.product_category_jobs(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.bling_products(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','encontrado','sem','erro')),
  review text NOT NULL DEFAULT 'pendente' CHECK (review IN ('pendente','salvo','descartado')),
  nome_busca text, nome_origem text,
  category_id text, category_path text, ml_product_id text, ml_product_title text,
  match_by text, erro text,
  PRIMARY KEY (job_id, product_id)
);
CREATE INDEX IF NOT EXISTS pcji_pending_idx ON public.product_category_job_items (job_id, status, product_id);
GRANT SELECT ON public.product_category_job_items TO authenticated;
GRANT ALL ON public.product_category_job_items TO service_role;
ALTER TABLE public.product_category_job_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read category items" ON public.product_category_job_items;
CREATE POLICY "Members read category items" ON public.product_category_job_items FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));

-- Cria a tarefa com os produtos marcados ou com todos do filtro.
CREATE OR REPLACE FUNCTION public.start_product_category_job(
  _company_id uuid, _user_id uuid, _product_ids uuid[], _search text, _only_missing boolean, _use_ai boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET statement_timeout = '120s' AS $$
DECLARE _job uuid; _n int; _s text := nullif(btrim(coalesce(_search,'')), '');
BEGIN
  IF NOT app_private.is_company_member(_company_id, _user_id) THEN RAISE EXCEPTION 'Sem acesso'; END IF;
  IF EXISTS (SELECT 1 FROM product_category_jobs WHERE company_id = _company_id AND status IN ('executando','pausado')) THEN
    RAISE EXCEPTION 'Já existe uma categorização em andamento nesta empresa.';
  END IF;
  INSERT INTO product_category_jobs (company_id, created_by, use_ai) VALUES (_company_id, _user_id, _use_ai) RETURNING id INTO _job;
  INSERT INTO product_category_job_items (job_id, product_id, company_id)
  SELECT _job, p.id, _company_id FROM bling_products p
  WHERE p.company_id = _company_id
    AND (CASE WHEN _product_ids IS NOT NULL THEN p.id = ANY(_product_ids)
      ELSE (_s IS NULL OR p.codigo ILIKE '%'||_s||'%' OR p.nome ILIKE '%'||_s||'%') END)
    AND (NOT _only_missing OR NOT EXISTS (SELECT 1 FROM product_ml_categories c WHERE c.product_id = p.id));
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN DELETE FROM product_category_jobs WHERE id = _job; RAISE EXCEPTION 'Nenhum produto para categorizar.'; END IF;
  UPDATE product_category_jobs SET total = _n WHERE id = _job;
  RETURN _job;
END $$;
REVOKE ALL ON FUNCTION public.start_product_category_job(uuid, uuid, uuid[], text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_product_category_job(uuid, uuid, uuid[], text, boolean, boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
