-- Correção automática da regra "Produtos ativos presentes na base do fornecedor":
-- inativa no Bling os produtos ativos que não existem mais na base do fornecedor.
CREATE OR REPLACE FUNCTION public.enqueue_bling_inativar(
  _company_id uuid,
  _product_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  _integration_id uuid;
  _enqueued integer := 0;
  _skipped integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  SELECT id INTO _integration_id
  FROM public.bling_integrations
  WHERE company_id = _company_id AND status = 'conectada'
  LIMIT 1;

  IF _integration_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma integração Bling conectada.';
  END IF;

  SELECT count(*) INTO _skipped
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
    AND (p.bling_product_id IS NULL OR p.bling_product_id = '');

  WITH alvo AS (
    SELECT p.id, p.bling_product_id
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
      AND p.bling_product_id IS NOT NULL
      AND p.bling_product_id <> ''
      AND upper(COALESCE(p.situacao, 'A')) IN ('A', 'ATIVO')
  ), ins AS (
    INSERT INTO public.bling_push_queue
      (company_id, integration_id, product_id, bling_product_id, tipo, valor_novo, status)
    SELECT _company_id, _integration_id, a.id, a.bling_product_id, 'inativar', 0, 'pendente'
    FROM alvo a
    ON CONFLICT DO NOTHING
    RETURNING product_id
  )
  SELECT count(*) INTO _enqueued FROM ins;

  UPDATE public.bling_products p
  SET situacao = 'Inativo', updated_at = now()
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
    AND p.bling_product_id IS NOT NULL
    AND p.bling_product_id <> ''
    AND upper(COALESCE(p.situacao, 'A')) IN ('A', 'ATIVO');

  RETURN jsonb_build_object('enqueued', _enqueued, 'skipped', _skipped, 'integration_id', _integration_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_bling_inativar(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_bling_inativar(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_bling_inativar(uuid, uuid[]) TO service_role;

-- Nome da regra passa a deixar claro que só considera produtos ativos.
UPDATE public.validation_rules
SET name = 'Produtos ativos presentes na base do fornecedor'
WHERE slug = 'produto-em-fornecedor';
