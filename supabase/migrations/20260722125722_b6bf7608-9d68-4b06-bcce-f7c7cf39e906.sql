
CREATE TABLE public.pricing_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  embalagem_default numeric NOT NULL DEFAULT 0,
  transporte_default numeric NOT NULL DEFAULT 0,
  taxa_operacional_valor numeric NOT NULL DEFAULT 0,
  taxa_operacional_min_custo numeric NOT NULL DEFAULT 0,
  frete_medio_percent numeric NOT NULL DEFAULT 0,
  custo_fixo_percent numeric NOT NULL DEFAULT 0,
  devolucao_percent numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_settings TO authenticated;
GRANT ALL ON public.pricing_settings TO service_role;

ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read pricing_settings"
  ON public.pricing_settings FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = pricing_settings.company_id
      AND cu.user_id = auth.uid()
      AND cu.ativo = true
  ));

CREATE POLICY "members write pricing_settings"
  ON public.pricing_settings FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = pricing_settings.company_id
      AND cu.user_id = auth.uid()
      AND cu.ativo = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = pricing_settings.company_id
      AND cu.user_id = auth.uid()
      AND cu.ativo = true
  ));

CREATE TABLE public.product_cost_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.bling_products(id) ON DELETE CASCADE,
  embalagem numeric,
  transporte numeric,
  taxa_operacional numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, product_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_cost_overrides TO authenticated;
GRANT ALL ON public.product_cost_overrides TO service_role;

ALTER TABLE public.product_cost_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read product_cost_overrides"
  ON public.product_cost_overrides FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = product_cost_overrides.company_id
      AND cu.user_id = auth.uid()
      AND cu.ativo = true
  ));

CREATE POLICY "members write product_cost_overrides"
  ON public.product_cost_overrides FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = product_cost_overrides.company_id
      AND cu.user_id = auth.uid()
      AND cu.ativo = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = product_cost_overrides.company_id
      AND cu.user_id = auth.uid()
      AND cu.ativo = true
  ));

CREATE OR REPLACE FUNCTION public.tg_pricing_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER pricing_settings_updated_at
  BEFORE UPDATE ON public.pricing_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_pricing_updated_at();

CREATE TRIGGER product_cost_overrides_updated_at
  BEFORE UPDATE ON public.product_cost_overrides
  FOR EACH ROW EXECUTE FUNCTION public.tg_pricing_updated_at();
