
ALTER TABLE public.bling_stores
  ADD COLUMN IF NOT EXISTS marketplace_id uuid REFERENCES public.marketplaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS bling_stores_default_per_company
  ON public.bling_stores(company_id) WHERE is_default = true;

CREATE OR REPLACE FUNCTION public.set_bling_store_marketplace(
  _company_id uuid,
  _bling_store_id text,
  _marketplace_id uuid,
  _is_default boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.';
  END IF;

  IF _is_default THEN
    UPDATE public.bling_stores
       SET is_default = false, updated_at = now()
     WHERE company_id = _company_id AND is_default = true AND bling_store_id <> _bling_store_id;
  END IF;

  UPDATE public.bling_stores
     SET marketplace_id = _marketplace_id,
         is_default = COALESCE(_is_default, false),
         updated_at = now()
   WHERE company_id = _company_id AND bling_store_id = _bling_store_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_bling_store_marketplace(uuid, text, uuid, boolean) TO authenticated;
