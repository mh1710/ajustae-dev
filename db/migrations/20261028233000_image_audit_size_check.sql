-- Fotos conferidas sem download completo: guarda tamanho/host e expõe as
-- "assinaturas" das imagens padrão (tamanhos e hosts onde já apareceram).
ALTER TABLE public.image_audit_cache ADD COLUMN IF NOT EXISTS byte_size integer;
ALTER TABLE public.image_audit_cache ADD COLUMN IF NOT EXISTS host text;
CREATE INDEX IF NOT EXISTS image_audit_cache_placeholder_idx ON public.image_audit_cache (status) WHERE status = 'placeholder';

CREATE OR REPLACE FUNCTION public.audit_placeholder_signatures()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'sizes', COALESCE((SELECT jsonb_agg(DISTINCT byte_size) FROM public.image_audit_cache WHERE status = 'placeholder' AND byte_size IS NOT NULL), '[]'::jsonb),
    'hosts', COALESCE((SELECT jsonb_agg(DISTINCT h) FROM (
        SELECT host AS h FROM public.image_audit_cache WHERE status = 'placeholder' AND host IS NOT NULL
        UNION SELECT lower(split_part(regexp_replace(u, '^https?://', '', 'i'), '/', 1))
        FROM public.validation_rules vr, jsonb_array_elements_text(COALESCE(vr.config->'urls', '[]'::jsonb)) u
        WHERE vr.slug = 'imagem-placeholder') s WHERE h IS NOT NULL AND h <> ''), '[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.audit_placeholder_signatures() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_placeholder_signatures() TO service_role;
