-- Papel de cada campo customizado (Mapa, Anvisa, Anatel, Garantia, Modelo) por empresa
-- e job "auto" que calcula e grava os valores padrão.
CREATE TABLE IF NOT EXISTS public.bling_custom_field_roles (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('mapa','anvisa','anatel_homologacao','anatel','garantia','modelo')),
  custom_field_id uuid NOT NULL REFERENCES public.bling_custom_fields(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, role)
);
GRANT SELECT ON public.bling_custom_field_roles TO authenticated;
GRANT ALL ON public.bling_custom_field_roles TO service_role;
ALTER TABLE public.bling_custom_field_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read custom field roles" ON public.bling_custom_field_roles;
CREATE POLICY "Members read custom field roles" ON public.bling_custom_field_roles
  FOR SELECT TO authenticated USING (app_private.is_company_member(company_id, auth.uid()));

ALTER TABLE public.bling_custom_field_jobs DROP CONSTRAINT IF EXISTS bling_custom_field_jobs_kind_check;
ALTER TABLE public.bling_custom_field_jobs ADD CONSTRAINT bling_custom_field_jobs_kind_check CHECK (kind IN ('sync','push','auto'));

-- Base para a atualização automática: código Anatel e modelo achado no catálogo do fornecedor.
CREATE OR REPLACE FUNCTION public.custom_field_auto_base(_product_ids uuid[])
RETURNS TABLE (product_id uuid, bling_product_id text, codigo text, gtin text, nome text, nome_fornecedor text, anatel text, modelo_fornecedor text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.id, p.bling_product_id, p.codigo, p.gtin, p.nome, x.nome,
    coalesce(public.anatel_code_for(p.codigo, p.gtin), 'Isento'),
    x.modelo
  FROM bling_products p
  LEFT JOIN LATERAL (
    SELECT NULLIF(btrim(COALESCE(fp.titulo, fp.nome_nota)), '') AS nome,
      (SELECT m[1] FROM regexp_matches(coalesce(fp.descricao_tecnica,''), 'modelo\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\-\./]{1,30})', 'i') m
        WHERE m[1] ~ '\d' AND m[1] !~* '\.(png|jpe?g|gif|webp)$' LIMIT 1) AS modelo
    FROM fornecedores f JOIN fornecedor_produtos fp ON fp.fornecedor_id = f.id
    WHERE f.codigo = public.map_sku_prefix(p.codigo)
      AND ltrim(fp.codigo, '0') = ltrim(regexp_replace(btrim(p.codigo), '^[A-Za-z]+', ''), '0')
    LIMIT 1
  ) x ON true
  WHERE p.id = ANY(_product_ids)
$$;
REVOKE ALL ON FUNCTION public.custom_field_auto_base(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_field_auto_base(uuid[]) TO service_role;
NOTIFY pgrst, 'reload schema';
