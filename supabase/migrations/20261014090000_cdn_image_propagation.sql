CREATE TABLE IF NOT EXISTS public.cdn_image_propagations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.bling_products(id) ON DELETE CASCADE,
  image_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  image_urls text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'processando', 'concluido', 'erro', 'cancelado')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cdn_image_propagations_integration_product_key UNIQUE (integration_id, product_id)
);

CREATE INDEX IF NOT EXISTS cdn_image_propagations_status_idx ON public.cdn_image_propagations(status);
CREATE INDEX IF NOT EXISTS cdn_image_propagations_company_idx ON public.cdn_image_propagations(company_id);
CREATE INDEX IF NOT EXISTS cdn_image_propagations_integration_idx ON public.cdn_image_propagations(integration_id);
CREATE INDEX IF NOT EXISTS cdn_image_propagations_product_idx ON public.cdn_image_propagations(product_id);

CREATE OR REPLACE FUNCTION public.set_cdn_image_propagation_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cdn_image_propagations_updated_at ON public.cdn_image_propagations;
CREATE TRIGGER cdn_image_propagations_updated_at
BEFORE UPDATE ON public.cdn_image_propagations
FOR EACH ROW EXECUTE FUNCTION public.set_cdn_image_propagation_updated_at();

ALTER TABLE public.cdn_image_propagations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cdn_image_propagations_select_member ON public.cdn_image_propagations;
CREATE POLICY cdn_image_propagations_select_member
ON public.cdn_image_propagations FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = cdn_image_propagations.company_id
      AND cu.user_id = auth.uid()
      AND cu.ativo = true
  )
);

DROP POLICY IF EXISTS cdn_image_propagations_admin_insert ON public.cdn_image_propagations;
CREATE POLICY cdn_image_propagations_admin_insert
ON public.cdn_image_propagations FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = cdn_image_propagations.company_id
      AND cu.user_id = auth.uid()
      AND cu.ativo = true
      AND cu.role = 'admin'
  )
);

DROP POLICY IF EXISTS cdn_image_propagations_admin_update ON public.cdn_image_propagations;
CREATE POLICY cdn_image_propagations_admin_update
ON public.cdn_image_propagations FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = cdn_image_propagations.company_id
      AND cu.user_id = auth.uid()
      AND cu.ativo = true
      AND cu.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = cdn_image_propagations.company_id
      AND cu.user_id = auth.uid()
      AND cu.ativo = true
      AND cu.role = 'admin'
  )
);

GRANT SELECT ON public.cdn_image_propagations TO authenticated;
GRANT INSERT, UPDATE ON public.cdn_image_propagations TO authenticated;
