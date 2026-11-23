BEGIN;
CREATE TABLE public.dre_repasses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  data date NOT NULL,
  cliente text NOT NULL CHECK (length(trim(cliente)) BETWEEN 1 AND 200),
  referencia text,
  observacoes text,
  custo_produto numeric(14,2) NOT NULL DEFAULT 0 CHECK (custo_produto >= 0),
  custo_etiqueta numeric(14,2) NOT NULL DEFAULT 0 CHECK (custo_etiqueta >= 0),
  custo_boy numeric(14,2) NOT NULL DEFAULT 0 CHECK (custo_boy >= 0),
  custo_embalagem numeric(14,2) NOT NULL DEFAULT 0 CHECK (custo_embalagem >= 0),
  repasse numeric(14,2) NOT NULL DEFAULT 0,
  resultado numeric(14,2) GENERATED ALWAYS AS (repasse-custo_produto-custo_etiqueta-custo_boy-custo_embalagem) STORED,
  divisao numeric(14,2) GENERATED ALWAYS AS (round((repasse-custo_produto-custo_etiqueta-custo_boy-custo_embalagem)/2,2)) STORED,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.dre_repasses TO authenticated;
GRANT ALL ON public.dre_repasses TO service_role;
ALTER TABLE public.dre_repasses ENABLE ROW LEVEL SECURITY;
CREATE POLICY members_manage_repasses ON public.dre_repasses FOR ALL TO authenticated
USING (app_private.is_company_member(company_id,auth.uid()))
WITH CHECK (app_private.is_company_member(company_id,auth.uid()));
CREATE INDEX dre_repasses_company_date_idx ON public.dre_repasses(company_id,data DESC,id);
CREATE FUNCTION public.dre_repasse_totals(_company_id uuid,_from date,_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
SELECT jsonb_build_object('quantidade',count(*),'repasse',coalesce(sum(repasse),0),
 'custos',coalesce(sum(custo_produto+custo_etiqueta+custo_boy+custo_embalagem),0),
 'resultado',coalesce(sum(resultado),0),'divisao',coalesce(sum(divisao),0))
FROM public.dre_repasses WHERE company_id=_company_id AND data BETWEEN _from AND _to;
$$;
REVOKE ALL ON FUNCTION public.dre_repasse_totals(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dre_repasse_totals(uuid,date,date) TO authenticated,service_role;
COMMIT;