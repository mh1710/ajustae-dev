-- Campos customizados de produtos do Bling: definições, valores por produto,
-- jobs de leitura (sync) e de edição em massa (push).

-- Reaproveita as tabelas existentes bling_custom_fields e bling_product_custom_values.
GRANT ALL ON public.bling_custom_fields TO service_role;
GRANT ALL ON public.bling_product_custom_values TO service_role;
GRANT SELECT ON public.bling_custom_fields, public.bling_product_custom_values TO authenticated;
ALTER TABLE public.bling_custom_fields ADD COLUMN IF NOT EXISTS situacao int;
CREATE INDEX IF NOT EXISTS bpcv_company_field_idx ON public.bling_product_custom_values (company_id, custom_field_id);

CREATE TABLE IF NOT EXISTS public.bling_custom_field_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.bling_integrations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('sync','push')),
  status text NOT NULL DEFAULT 'executando'
    CHECK (status IN ('executando','pausado','cancelado','concluido','erro')),
  cursor_id uuid,
  done_count int NOT NULL DEFAULT 0,
  total int NOT NULL DEFAULT 0,
  error_count int NOT NULL DEFAULT 0,
  field_id text,
  valor text,
  last_error text,
  lease_until timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS bcfj_company_idx ON public.bling_custom_field_jobs (company_id, started_at DESC);
GRANT SELECT ON public.bling_custom_field_jobs TO authenticated;
GRANT ALL ON public.bling_custom_field_jobs TO service_role;
ALTER TABLE public.bling_custom_field_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read custom field jobs" ON public.bling_custom_field_jobs;
CREATE POLICY "Members read custom field jobs" ON public.bling_custom_field_jobs
  FOR SELECT TO authenticated USING (app_private.is_company_member(company_id, auth.uid()));

CREATE TABLE IF NOT EXISTS public.bling_custom_field_push_items (
  job_id uuid NOT NULL REFERENCES public.bling_custom_field_jobs(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.bling_products(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','ok','erro')),
  erro text,
  PRIMARY KEY (job_id, product_id)
);
CREATE INDEX IF NOT EXISTS bcfpi_pending_idx ON public.bling_custom_field_push_items (job_id, status, product_id);
GRANT ALL ON public.bling_custom_field_push_items TO service_role;
ALTER TABLE public.bling_custom_field_push_items ENABLE ROW LEVEL SECURITY;

-- Listagem paginada: uma linha por produto com os valores de cada campo.
CREATE OR REPLACE FUNCTION public.list_product_custom_fields(
  _company_id uuid, _search text DEFAULT NULL, _field_id uuid DEFAULT NULL,
  _field_mode text DEFAULT NULL, _limit int DEFAULT 50, _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _total int; _rows jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT app_private.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem acesso';
  END IF;
  WITH base AS (
    SELECT p.id, p.codigo, p.nome, p.situacao FROM bling_products p
    WHERE p.company_id = _company_id
      AND (_search IS NULL OR _search = '' OR p.codigo ILIKE '%'||_search||'%' OR p.nome ILIKE '%'||_search||'%')
      AND (_field_id IS NULL OR _field_mode IS NULL OR
        CASE _field_mode
          WHEN 'vazio' THEN NOT EXISTS (SELECT 1 FROM bling_product_custom_values v
            WHERE v.product_id = p.id AND v.custom_field_id = _field_id AND coalesce(btrim(v.valor),'') <> '')
          WHEN 'preenchido' THEN EXISTS (SELECT 1 FROM bling_product_custom_values v
            WHERE v.product_id = p.id AND v.custom_field_id = _field_id AND coalesce(btrim(v.valor),'') <> '')
          ELSE true END)
  )
  SELECT count(*) INTO _total FROM base;
  SELECT coalesce(jsonb_agg(r ORDER BY r->>'codigo'), '[]'::jsonb) INTO _rows FROM (
    SELECT jsonb_build_object('id', b.id, 'codigo', b.codigo, 'nome', b.nome, 'situacao', b.situacao,
      'valores', coalesce((SELECT jsonb_object_agg(v.custom_field_id, v.valor) FROM bling_product_custom_values v WHERE v.product_id = b.id), '{}'::jsonb)) r
    FROM (
      SELECT p.id, p.codigo, p.nome, p.situacao FROM bling_products p
      WHERE p.company_id = _company_id
        AND (_search IS NULL OR _search = '' OR p.codigo ILIKE '%'||_search||'%' OR p.nome ILIKE '%'||_search||'%')
        AND (_field_id IS NULL OR _field_mode IS NULL OR
          CASE _field_mode
            WHEN 'vazio' THEN NOT EXISTS (SELECT 1 FROM bling_product_custom_values v
              WHERE v.product_id = p.id AND v.custom_field_id = _field_id AND coalesce(btrim(v.valor),'') <> '')
            WHEN 'preenchido' THEN EXISTS (SELECT 1 FROM bling_product_custom_values v
              WHERE v.product_id = p.id AND v.custom_field_id = _field_id AND coalesce(btrim(v.valor),'') <> '')
            ELSE true END)
      ORDER BY p.codigo LIMIT _limit OFFSET _offset
    ) b
  ) s;
  RETURN jsonb_build_object('total', _total, 'rows', _rows);
END $$;
GRANT EXECUTE ON FUNCTION public.list_product_custom_fields(uuid, text, uuid, text, int, int) TO authenticated, service_role;

-- Cria os itens de uma edição em massa (por ids ou por filtro). Só service_role.
CREATE OR REPLACE FUNCTION public.fill_custom_field_push_items(
  _job_id uuid, _company_id uuid, _product_ids uuid[], _search text, _field_id uuid, _field_mode text
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET statement_timeout = '120s' AS $$
DECLARE _n int;
BEGIN
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
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE bling_custom_field_jobs SET total = _n WHERE id = _job_id;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.fill_custom_field_push_items(uuid, uuid, uuid[], text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fill_custom_field_push_items(uuid, uuid, uuid[], text, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
