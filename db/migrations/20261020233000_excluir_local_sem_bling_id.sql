-- Produtos sem ID do Bling não existem lá: em vez de apenas inativar na base
-- interna, EXCLUI o registro local imediatamente (e suas dependências sem
-- cascata: vínculos de loja, itens de pedido e linhas de importação).
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
  _local integer := 0;
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

  -- Sem ID do Bling: não existem no Bling, então exclui da base interna.
  CREATE TEMPORARY TABLE IF NOT EXISTS _tmp_sem_bling (id uuid PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE _tmp_sem_bling;
  INSERT INTO _tmp_sem_bling (id)
  SELECT p.id
  FROM public.bling_products p
  WHERE p.company_id = _company_id
    AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
    AND (p.bling_product_id IS NULL OR p.bling_product_id = '');

  DELETE FROM public.bling_product_stores s
  USING _tmp_sem_bling t WHERE s.internal_product_id = t.id;
  DELETE FROM public.bling_order_items o
  USING _tmp_sem_bling t WHERE o.product_id = t.id;
  DELETE FROM public.supplier_import_rows r
  USING _tmp_sem_bling t WHERE r.match_product_id = t.id;

  WITH del AS (
    DELETE FROM public.bling_products p
    USING _tmp_sem_bling t WHERE p.id = t.id
    RETURNING p.id
  )
  SELECT count(*) INTO _local FROM del;

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

  RETURN jsonb_build_object(
    'enqueued', _enqueued,
    'skipped', _skipped,
    'excluidos_local', _local,
    'integration_id', _integration_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_bling_inativar(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_bling_inativar(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_bling_inativar(uuid, uuid[]) TO service_role;

-- Remove os produtos que ficaram só inativados na base interna sem existir no Bling.
DELETE FROM public.bling_product_stores s
USING public.bling_products p
WHERE s.internal_product_id = p.id
  AND (p.bling_product_id IS NULL OR p.bling_product_id = '');
DELETE FROM public.bling_order_items o
USING public.bling_products p
WHERE o.product_id = p.id
  AND (p.bling_product_id IS NULL OR p.bling_product_id = '');
DELETE FROM public.supplier_import_rows r
USING public.bling_products p
WHERE r.match_product_id = p.id
  AND (p.bling_product_id IS NULL OR p.bling_product_id = '');
DELETE FROM public.bling_products p
WHERE p.bling_product_id IS NULL OR p.bling_product_id = '';
