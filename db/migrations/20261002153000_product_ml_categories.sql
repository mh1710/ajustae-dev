-- Categorias encontradas no Mercado Livre, separadas da categoria recebida do Bling.
CREATE TABLE public.product_ml_categories (
  product_id uuid PRIMARY KEY REFERENCES public.bling_products(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ml_category_id text NOT NULL,
  ml_category_path text NOT NULL,
  ml_product_id text NOT NULL,
  ml_product_title text NOT NULL,
  match_by text NOT NULL CHECK (match_by IN ('ean', 'titulo')),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_ml_categories TO authenticated;
GRANT ALL ON public.product_ml_categories TO service_role;
ALTER TABLE public.product_ml_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read ML categories" ON public.product_ml_categories FOR SELECT TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()));
CREATE POLICY "Members save ML categories" ON public.product_ml_categories FOR INSERT TO authenticated
  WITH CHECK (app_private.is_company_member(company_id, auth.uid()) AND updated_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.bling_products p WHERE p.id = product_id AND p.company_id = company_id));
CREATE POLICY "Members update ML categories" ON public.product_ml_categories FOR UPDATE TO authenticated
  USING (app_private.is_company_member(company_id, auth.uid()))
  WITH CHECK (app_private.is_company_member(company_id, auth.uid()) AND updated_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.bling_products p WHERE p.id = product_id AND p.company_id = company_id));
CREATE INDEX product_ml_categories_company_idx ON public.product_ml_categories(company_id, updated_at DESC);