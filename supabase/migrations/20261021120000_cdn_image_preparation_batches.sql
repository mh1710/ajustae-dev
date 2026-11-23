-- Prepara jobs globais de imagens em lotes para não ultrapassar o
-- statement_timeout ao materializar os produtos de várias empresas.
ALTER TABLE public.cdn_image_jobs_v2
  ADD COLUMN IF NOT EXISTS preparation_cursor uuid;

CREATE OR REPLACE FUNCTION public.prepare_cdn_image_job_v2(_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
DECLARE
  _companies uuid[];
  _selected uuid[];
  _cursor uuid;
  _started_at timestamptz;
  _product_ids uuid[];
  _candidate_count integer := 0;
  _count integer := 0;
  _batch_size constant integer := 1000;
BEGIN
  SELECT company_ids, selected_product_ids, preparation_cursor, started_at
  INTO _companies, _selected, _cursor, _started_at
  FROM public.cdn_image_jobs_v2
  WHERE id = _job_id
  FOR UPDATE;

  IF _companies IS NULL THEN
    RAISE EXCEPTION 'Job não encontrado';
  END IF;

  -- O cursor fixa uma ordem determinística e limita cada transação. O filtro
  -- por started_at mantém o conjunto como um retrato do início do job: produtos
  -- criados durante uma propagação entram na execução seguinte.
  SELECT coalesce(array_agg(candidate.id ORDER BY candidate.id), '{}'::uuid[])
  INTO _product_ids
  FROM (
    SELECT p.id
    FROM public.bling_products p
    WHERE p.company_id = ANY(_companies)
      AND (cardinality(_selected) = 0 OR p.id = ANY(_selected))
      AND p.created_at <= _started_at
      AND (_cursor IS NULL OR p.id > _cursor)
    ORDER BY p.id
    LIMIT _batch_size
  ) candidate;

  _candidate_count := cardinality(_product_ids);

  IF _candidate_count > 0 THEN
    INSERT INTO public.cdn_image_job_items_v2 (
      job_id,
      company_id,
      product_id,
      integration_id,
      codigo,
      cod_fornecedor,
      fornecedor,
      descricao_fornecedor
    )
    SELECT
      _job_id,
      p.company_id,
      p.id,
      p.integration_id,
      p.codigo,
      p.cod_fornecedor,
      p.fornecedor,
      p.descricao_fornecedor
    FROM public.bling_products p
    WHERE p.id = ANY(_product_ids)
      AND p.company_id = ANY(_companies)
    ON CONFLICT (job_id, product_id) DO NOTHING;

    _cursor := _product_ids[_candidate_count];
  END IF;

  SELECT count(*)
  INTO _count
  FROM public.cdn_image_job_items_v2
  WHERE job_id = _job_id;

  UPDATE public.cdn_image_jobs_v2
  SET preparation_cursor = _cursor,
      total_products = _count,
      status = CASE
        WHEN _candidate_count < _batch_size AND _count = 0 THEN 'concluido'
        WHEN _candidate_count < _batch_size THEN 'processando'
        ELSE 'preparando'
      END,
      finished_at = CASE
        WHEN _candidate_count < _batch_size AND _count = 0 THEN coalesce(finished_at, now())
        ELSE NULL
      END,
      updated_at = now()
  WHERE id = _job_id;

  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_cdn_image_job_v2(uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_cdn_image_job_v2(uuid) TO service_role;
