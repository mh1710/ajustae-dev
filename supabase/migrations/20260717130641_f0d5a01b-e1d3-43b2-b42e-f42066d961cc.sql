
CREATE TABLE public.anatel_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  titulo text,
  descricao_comercial text,
  marca text,
  ean text,
  ncm text,
  codigo_anatel text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, codigo)
);

CREATE INDEX anatel_products_company_idx ON public.anatel_products (company_id);
CREATE INDEX anatel_products_ean_idx ON public.anatel_products (ean);
CREATE INDEX anatel_products_codigo_anatel_idx ON public.anatel_products (codigo_anatel);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.anatel_products TO authenticated;
GRANT ALL ON public.anatel_products TO service_role;

ALTER TABLE public.anatel_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view anatel products of their companies"
  ON public.anatel_products FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = anatel_products.company_id AND cu.user_id = auth.uid() AND cu.ativo = true));

CREATE POLICY "Members can insert anatel products"
  ON public.anatel_products FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = anatel_products.company_id AND cu.user_id = auth.uid() AND cu.ativo = true));

CREATE POLICY "Members can update anatel products"
  ON public.anatel_products FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = anatel_products.company_id AND cu.user_id = auth.uid() AND cu.ativo = true));

CREATE POLICY "Members can delete anatel products"
  ON public.anatel_products FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.company_id = anatel_products.company_id AND cu.user_id = auth.uid() AND cu.ativo = true));

CREATE TRIGGER anatel_products_set_updated_at
  BEFORE UPDATE ON public.anatel_products
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
