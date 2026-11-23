-- Procura o Código Anatel do produto no módulo Anatel, priorizando códigos reais:
-- 1) mesmo SKU; 2) mesmo EAN; 3) mesmo fornecedor (mapa de prefixos) + mesmo número.
-- Só devolve 'isento' quando nenhuma dessas buscas acha um código numérico.
CREATE INDEX IF NOT EXISTS idx_anatel_products_codigo_trim ON public.anatel_products (btrim(codigo));
CREATE INDEX IF NOT EXISTS idx_anatel_products_ean ON public.anatel_products (btrim(ean));
CREATE INDEX IF NOT EXISTS idx_anatel_products_num
  ON public.anatel_products ((ltrim(regexp_replace(btrim(codigo), '^[A-Za-z]+', ''), '0')));

CREATE OR REPLACE FUNCTION public.anatel_code_for(_codigo text, _gtin text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _c text := btrim(coalesce(_codigo, ''));
  _g text := btrim(coalesce(_gtin, ''));
  _num text;
  _forn text;
  _r text;
BEGIN
  IF _c <> '' THEN
    SELECT btrim(codigo_anatel) INTO _r FROM anatel_products
     WHERE btrim(codigo) = _c AND codigo_anatel ~ '\d{5}' LIMIT 1;
    IF _r IS NOT NULL THEN RETURN _r; END IF;
  END IF;

  IF _g ~ '^\d{8,14}$' THEN
    SELECT btrim(codigo_anatel) INTO _r FROM anatel_products
     WHERE btrim(ean) = _g AND codigo_anatel ~ '\d{5}' LIMIT 1;
    IF _r IS NOT NULL THEN RETURN _r; END IF;
  END IF;

  IF _c ~ '^[A-Za-z]+\d+$' THEN
    _num := ltrim(regexp_replace(_c, '^[A-Za-z]+', ''), '0');
    _forn := map_sku_prefix(_c);
    IF _forn IS NOT NULL AND _num <> '' THEN
      SELECT btrim(a.codigo_anatel) INTO _r FROM anatel_products a
       WHERE ltrim(regexp_replace(btrim(a.codigo), '^[A-Za-z]+', ''), '0') = _num
         AND a.codigo_anatel ~ '\d{5}'
         AND map_sku_prefix(btrim(a.codigo)) = _forn
       LIMIT 1;
      IF _r IS NOT NULL THEN RETURN _r; END IF;
    END IF;
  END IF;

  RETURN 'isento';
END;
$$;

GRANT EXECUTE ON FUNCTION public.anatel_code_for(text, text) TO authenticated, service_role;
