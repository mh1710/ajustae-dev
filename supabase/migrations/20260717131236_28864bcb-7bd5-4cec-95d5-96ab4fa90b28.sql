
CREATE OR REPLACE FUNCTION public.transform_strip_html(_company_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
  strip_expr text;
BEGIN
  IF NOT public.is_company_member(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH updated AS (
    UPDATE public.bling_products p SET
      descricao_curta = public.strip_html_text(p.descricao_curta),
      descricao_complementar = public.strip_html_text(p.descricao_complementar),
      observacoes = public.strip_html_text(p.observacoes),
      informacoes_adicionais = public.strip_html_text(p.informacoes_adicionais),
      descricao_fornecedor = public.strip_html_text(p.descricao_fornecedor),
      dirty = true,
      updated_at = now()
    WHERE p.company_id = _company_id
      AND (
        COALESCE(p.descricao_curta,'') ~ '<[^>]+>|&[A-Za-z#0-9]+;'
        OR COALESCE(p.descricao_complementar,'') ~ '<[^>]+>|&[A-Za-z#0-9]+;'
        OR COALESCE(p.observacoes,'') ~ '<[^>]+>|&[A-Za-z#0-9]+;'
        OR COALESCE(p.informacoes_adicionais,'') ~ '<[^>]+>|&[A-Za-z#0-9]+;'
        OR COALESCE(p.descricao_fornecedor,'') ~ '<[^>]+>|&[A-Za-z#0-9]+;'
      )
    RETURNING 1
  )
  SELECT count(*)::int INTO affected FROM updated;

  RETURN COALESCE(affected, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.strip_html_text(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN s IS NULL THEN NULL ELSE
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(s, '<br\s*/?>', E'\n', 'gi'),
                  '</(p|div|li|h[1-6])>', E'\n', 'gi'),
                '<[^>]+>', '', 'g'),
              '&nbsp;', ' ', 'gi'),
            '&amp;', '&', 'gi'),
          '&(lt|gt|quot|#39);',
          CASE
            WHEN true THEN ''  -- placeholder, real handling below
          END,
          'gi'),
        E'\n{3,}', E'\n\n', 'g')
    )
  END;
$$;

-- Redefine cleanly with proper entity handling
CREATE OR REPLACE FUNCTION public.strip_html_text(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN s IS NULL THEN NULL ELSE
    btrim(
      regexp_replace(
        replace(replace(replace(replace(replace(replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(s, '<br\s*/?>', E'\n', 'gi'),
              '</(p|div|li|h[1-6])>', E'\n', 'gi'),
            '<[^>]+>', '', 'g'),
          '&nbsp;', ' '),
          '&amp;', '&'),
          '&lt;', '<'),
          '&gt;', '>'),
          '&quot;', '"'),
          '&#39;', ''''),
        E'\n{3,}', E'\n\n', 'g')
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.transform_fill_desc_complementar(_company_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  IF NOT public.is_company_member(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH updated AS (
    UPDATE public.bling_products p SET
      descricao_complementar = btrim(p.nome),
      dirty = true,
      updated_at = now()
    WHERE p.company_id = _company_id
      AND btrim(COALESCE(p.nome,'')) <> ''
      AND btrim(COALESCE(p.nome,'')) IS DISTINCT FROM btrim(COALESCE(p.descricao_complementar,''))
    RETURNING 1
  )
  SELECT count(*)::int INTO affected FROM updated;

  RETURN COALESCE(affected, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.strip_html_text(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transform_strip_html(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transform_fill_desc_complementar(uuid) TO authenticated, service_role;
