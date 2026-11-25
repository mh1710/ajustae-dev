-- Empresas sem marketplace padrão usam Web Continental (escolha do usuário).
UPDATE public.pricing_settings ps
   SET default_marketplace_id = m.id
  FROM public.marketplaces m
 WHERE m.nome = 'Web Continental' AND ps.default_marketplace_id IS NULL;

CREATE OR REPLACE FUNCTION public.tg_pricing_default_marketplace()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.default_marketplace_id IS NULL THEN
    SELECT id INTO NEW.default_marketplace_id FROM public.marketplaces WHERE nome = 'Web Continental' LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pricing_default_marketplace ON public.pricing_settings;
CREATE TRIGGER pricing_default_marketplace BEFORE INSERT OR UPDATE OF default_marketplace_id ON public.pricing_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_pricing_default_marketplace();
