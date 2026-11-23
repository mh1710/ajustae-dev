
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TABLE public.marketplaces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  taxa_percent NUMERIC(6,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplaces TO authenticated;
GRANT ALL ON public.marketplaces TO service_role;

ALTER TABLE public.marketplaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read marketplaces" ON public.marketplaces
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert marketplaces" ON public.marketplaces
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update marketplaces" ON public.marketplaces
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete marketplaces" ON public.marketplaces
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_marketplaces_updated_at
  BEFORE UPDATE ON public.marketplaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.marketplaces (nome, taxa_percent) VALUES
  ('Americanas', 18),
  ('Shopee', 20),
  ('Olist', 23),
  ('Mercado Livre', 16),
  ('Mercado Livre Premium', 18),
  ('Magalu', 18),
  ('Madeira Madeira', 18),
  ('Kabum', 18),
  ('Via Varejo', 18),
  ('Web Continental', 21),
  ('Nuvem Shop', 0)
ON CONFLICT (nome) DO NOTHING;
