-- Lista oficial de produtos homologados da Anatel (dados abertos), só homologações emitidas.
CREATE TABLE IF NOT EXISTS public.anatel_homologacoes (
  numero text PRIMARY KEY,
  data_homologacao date,
  solicitante text,
  fabricante text,
  modelo text,
  nome_comercial text,
  tipo text,
  situacao text,
  imported_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.anatel_homologacoes TO authenticated;
GRANT ALL ON public.anatel_homologacoes TO service_role;
ALTER TABLE public.anatel_homologacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read homologacoes" ON public.anatel_homologacoes;
CREATE POLICY "Authenticated read homologacoes" ON public.anatel_homologacoes FOR SELECT TO authenticated USING (true);

-- Cada homologação pode listar vários modelos; um token normalizado por modelo.
CREATE TABLE IF NOT EXISTS public.anatel_homologacao_modelos (
  numero text NOT NULL REFERENCES public.anatel_homologacoes(numero) ON DELETE CASCADE,
  modelo_norm text NOT NULL,
  PRIMARY KEY (numero, modelo_norm)
);
CREATE INDEX IF NOT EXISTS idx_anatel_hom_modelos_norm ON public.anatel_homologacao_modelos (modelo_norm);
GRANT SELECT ON public.anatel_homologacao_modelos TO authenticated;
GRANT ALL ON public.anatel_homologacao_modelos TO service_role;
ALTER TABLE public.anatel_homologacao_modelos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read hom modelos" ON public.anatel_homologacao_modelos;
CREATE POLICY "Authenticated read hom modelos" ON public.anatel_homologacao_modelos FOR SELECT TO authenticated USING (true);

-- Sugestões: casa tokens do título (letras+números, >=4) com modelos homologados.
CREATE OR REPLACE FUNCTION public.anatel_official_suggestions(_company_id uuid, _limit int DEFAULT 3000)
RETURNS TABLE (
  product_id uuid, codigo text, nome text, marca text, gtin text,
  codigo_atual text, numero text, fabricante text, modelo text,
  nome_comercial text, tipo text, marca_confere boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '300s'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM company_users cu WHERE cu.company_id = _company_id AND cu.user_id = auth.uid() AND cu.ativo)
     AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  RETURN QUERY
  WITH prods AS (
    SELECT p.id, p.codigo, COALESCE(sn.nome, p.nome) AS nome, p.marca, p.gtin,
      upper(regexp_replace(split_part(replace(btrim(coalesce(p.marca,'')),'-',''),' ',1), '[^A-Za-z0-9]', '', 'g')) AS bkey
    FROM bling_products p
    LEFT JOIN LATERAL public.supplier_product_names(ARRAY[p.codigo]) sn ON true
    WHERE p.company_id = _company_id AND coalesce(p.situacao,'Ativo') IN ('A','Ativo')
  ),
  toks AS (
    SELECT DISTINCT pr.id, upper(regexp_replace(t, '[^A-Za-z0-9]', '', 'g')) AS tok
    FROM prods pr, regexp_split_to_table(coalesce(pr.nome,''), '\s+') t
  ),
  hits AS (
    SELECT tk.id, h.numero, h.fabricante, h.modelo, h.nome_comercial, h.tipo, h.solicitante, h.data_homologacao, length(tk.tok) AS l,
      upper(regexp_replace(coalesce(h.fabricante,'') || coalesce(h.solicitante,'') || coalesce(h.nome_comercial,''), '[^A-Za-z0-9]', '', 'g')) AS fkey
    FROM toks tk
    JOIN anatel_homologacao_modelos m ON m.modelo_norm = tk.tok
    JOIN anatel_homologacoes h ON h.numero = m.numero
    WHERE length(tk.tok) >= 4 AND tk.tok ~ '[A-Z]' AND tk.tok ~ '[0-9]'
  ),
  ranked AS (
    SELECT pr.id, pr.codigo, pr.nome, pr.marca, pr.gtin, hi.numero, hi.fabricante, hi.modelo, hi.nome_comercial, hi.tipo,
      (length(pr.bkey) >= 2 AND hi.fkey LIKE '%' || pr.bkey || '%') AS marca_ok,
      row_number() OVER (PARTITION BY pr.id ORDER BY
         (length(pr.bkey) >= 2 AND hi.fkey LIKE '%' || pr.bkey || '%') DESC,
         hi.l DESC, hi.data_homologacao DESC NULLS LAST) AS rn
    FROM hits hi JOIN prods pr ON pr.id = hi.id
  )
  SELECT r.id, r.codigo, r.nome, r.marca, r.gtin,
    nullif(anatel_code_for(r.codigo, r.gtin), 'isento') AS codigo_atual,
    r.numero, r.fabricante, r.modelo, r.nome_comercial, r.tipo, r.marca_ok
  FROM ranked r
  WHERE r.rn = 1 AND r.marca_ok
  ORDER BY r.codigo
  LIMIT _limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.anatel_official_suggestions(uuid, int) TO authenticated;
