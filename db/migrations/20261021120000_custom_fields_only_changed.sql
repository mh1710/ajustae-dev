-- Envio de campos customizados passa a pular produtos cujo valor gravado no
-- Bling já é igual ao valor novo (mesma ideia do "só o que mudou" de preço/estoque).
-- Nenhum armazenamento novo: reutiliza bling_product_custom_values, que já guarda
-- o último valor conhecido de cada campo por produto.
CREATE OR REPLACE FUNCTION public.fill_custom_field_push_items(
  _job_id uuid, _company_id uuid, _product_ids uuid[], _search text, _field_id uuid, _field_mode text
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET statement_timeout = '120s' AS $$
DECLARE _n int; _target_field uuid; _target_valor text;
BEGIN
  -- Campo e valor alvo da tarefa (edição em massa); tarefas "auto" não têm campo único.
  SELECT j.field_id, j.valor INTO _target_field, _target_valor
  FROM public.bling_custom_field_jobs j WHERE j.id = _job_id;

  INSERT INTO bling_custom_field_push_items (job_id, product_id)
  SELECT _job_id, p.id FROM bling_products p
  WHERE p.company_id = _company_id AND p.bling_product_id IS NOT NULL
    AND (_product_ids IS NOT NULL AND p.id = ANY(_product_ids)
      OR _product_ids IS NULL
        AND (_search IS NULL OR _search = '' OR p.codigo ILIKE '%'||_search||'%' OR p.nome ILIKE '%'||_search||'%')
        AND (_field_id IS NULL OR _field_mode IS NULL OR
          CASE _field_mode
            WHEN 'vazio' THEN NOT EXISTS (SELECT 1 FROM bling_product_custom_values v
              WHERE v.product_id = p.id AND v.custom_field_id = _field_id AND coalesce(btrim(v.valor),'') <> '')
            WHEN 'preenchido' THEN EXISTS (SELECT 1 FROM bling_product_custom_values v
              WHERE v.product_id = p.id AND v.custom_field_id = _field_id AND coalesce(btrim(v.valor),'') <> '')
            ELSE true END))
    -- Não reenvia quem já tem exatamente este valor neste campo.
    AND (_target_field IS NULL OR _target_valor IS NULL OR NOT EXISTS (
      SELECT 1 FROM bling_product_custom_values v
      WHERE v.product_id = p.id AND v.custom_field_id = _target_field
        AND COALESCE(v.valor, '') = COALESCE(_target_valor, '')
    ))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE bling_custom_field_jobs SET total = _n WHERE id = _job_id;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.fill_custom_field_push_items(uuid, uuid, uuid[], text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fill_custom_field_push_items(uuid, uuid, uuid[], text, uuid, text) TO service_role;
NOTIFY pgrst, 'reload schema';
