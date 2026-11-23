
CREATE TABLE public.fornecedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  nome text NOT NULL,
  source_type text NOT NULL DEFAULT 'xml_url',
  source_url text,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  product_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, codigo)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fornecedores TO authenticated;
GRANT ALL ON public.fornecedores TO service_role;

ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view suppliers" ON public.fornecedores
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = fornecedores.company_id AND cu.user_id = auth.uid() AND cu.ativo));

CREATE POLICY "Members can insert suppliers" ON public.fornecedores
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = fornecedores.company_id AND cu.user_id = auth.uid() AND cu.ativo));

CREATE POLICY "Members can update suppliers" ON public.fornecedores
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = fornecedores.company_id AND cu.user_id = auth.uid() AND cu.ativo))
  WITH CHECK (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = fornecedores.company_id AND cu.user_id = auth.uid() AND cu.ativo));

CREATE POLICY "Members can delete suppliers" ON public.fornecedores
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = fornecedores.company_id AND cu.user_id = auth.uid() AND cu.ativo));

CREATE TRIGGER trg_fornecedores_updated_at
  BEFORE UPDATE ON public.fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


CREATE TABLE public.fornecedor_produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  marca text,
  categoria text,
  titulo text,
  nome_nota text,
  unidade text,
  multiplo numeric,
  ipi numeric,
  descricao_tecnica text,
  estoque text,
  qt_estoque numeric,
  peso numeric,
  altura numeric,
  largura numeric,
  comprimento numeric,
  ncm text,
  codigobarras text,
  origem text,
  faturamento text,
  ppb text,
  mpdobem text,
  foto text,
  tempo_garantia text,
  precos jsonb,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fornecedor_id, codigo)
);

CREATE INDEX idx_fornecedor_produtos_fornecedor ON public.fornecedor_produtos(fornecedor_id);
CREATE INDEX idx_fornecedor_produtos_codigobarras ON public.fornecedor_produtos(codigobarras);
CREATE INDEX idx_fornecedor_produtos_codigo ON public.fornecedor_produtos(codigo);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fornecedor_produtos TO authenticated;
GRANT ALL ON public.fornecedor_produtos TO service_role;

ALTER TABLE public.fornecedor_produtos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view supplier products" ON public.fornecedor_produtos
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.fornecedores f
    JOIN public.company_users cu ON cu.company_id = f.company_id
    WHERE f.id = fornecedor_produtos.fornecedor_id AND cu.user_id = auth.uid() AND cu.ativo
  ));

CREATE POLICY "Members can insert supplier products" ON public.fornecedor_produtos
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.fornecedores f
    JOIN public.company_users cu ON cu.company_id = f.company_id
    WHERE f.id = fornecedor_produtos.fornecedor_id AND cu.user_id = auth.uid() AND cu.ativo
  ));

CREATE POLICY "Members can update supplier products" ON public.fornecedor_produtos
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.fornecedores f
    JOIN public.company_users cu ON cu.company_id = f.company_id
    WHERE f.id = fornecedor_produtos.fornecedor_id AND cu.user_id = auth.uid() AND cu.ativo
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.fornecedores f
    JOIN public.company_users cu ON cu.company_id = f.company_id
    WHERE f.id = fornecedor_produtos.fornecedor_id AND cu.user_id = auth.uid() AND cu.ativo
  ));

CREATE POLICY "Members can delete supplier products" ON public.fornecedor_produtos
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.fornecedores f
    JOIN public.company_users cu ON cu.company_id = f.company_id
    WHERE f.id = fornecedor_produtos.fornecedor_id AND cu.user_id = auth.uid() AND cu.ativo
  ));

CREATE TRIGGER trg_fornecedor_produtos_updated_at
  BEFORE UPDATE ON public.fornecedor_produtos
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
