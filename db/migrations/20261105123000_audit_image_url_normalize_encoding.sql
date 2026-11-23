-- A conferência das fotos grava o resultado com o link normalizado pelo
-- navegador/servidor (new URL): host em minúsculas e caracteres como espaço e
-- acentos codificados (%20, %C3%A7...). A auditoria em lote normalizava sem
-- codificar, então fotos com espaço/acento no link nunca encontravam o
-- resultado e o erro sumia na auditoria de todos os produtos.
CREATE OR REPLACE FUNCTION public.normalize_audit_image_url(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  WITH s AS (
    SELECT regexp_replace(regexp_replace(btrim(coalesce(value, '')), '^https?://', '', 'i'), '[?#].*$', '') AS v,
           btrim(coalesce(value, '')) ~* '^https?://' AS is_url
  ), parts AS (
    SELECT is_url, v,
           CASE WHEN position('/' IN v) > 0 THEN substr(v, 1, position('/' IN v) - 1) ELSE v END AS host,
           CASE WHEN position('/' IN v) > 0 THEN substr(v, position('/' IN v)) ELSE '/' END AS path
    FROM s
  )
  SELECT CASE WHEN NOT is_url THEN v ELSE
    lower(host) || coalesce((
      SELECT string_agg(
        CASE
          WHEN ascii(c) BETWEEN 33 AND 126 AND c NOT IN ('"', '<', '>', '`', '{', '}') THEN c
          ELSE (SELECT string_agg('%' || upper(lpad(to_hex(get_byte(b, i)), 2, '0')), '' ORDER BY i)
                FROM (SELECT convert_to(c, 'UTF8') AS b) x, generate_series(0, length(convert_to(c, 'UTF8')) - 1) i)
        END, '' ORDER BY ord)
      FROM regexp_split_to_table(path, '') WITH ORDINALITY AS t(c, ord)
    ), '')
  END
  FROM parts;
$function$;
