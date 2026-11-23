-- Atualização do "ID na loja" (código do anúncio na multiloja) via planilha.
-- Único caminho permitido para alterar esse campo: o usuário informa
-- SKU + ID da loja + novo ID na loja, confere a prévia e confirma.

ALTER TABLE public.bling_push_queue
  DROP CONSTRAINT IF EXISTS bling_push_queue_tipo_check;

ALTER TABLE public.bling_push_queue
  ADD CONSTRAINT bling_push_queue_tipo_check
  CHECK (tipo IN (
    'preco', 'estoque', 'produto', 'criar', 'excluir', 'inativar',
    'preco_loja', 'estoque_loja', 'vincular_loja', 'desvincular_loja',
    'codigo_loja', 'codigo_loja_planilha'
  ));

-- Normaliza as linhas da planilha e casa com produto + vínculo de loja.
CREATE OR REPLACE FUNCTION public.match_store_code_sheet(
  _company_id uuid,
  _rows jsonb
)
RETURNS TABLE (
  linha integer,
  sku text,
  bling_store_id text,
  codigo_novo text,
  product_id uuid,
  bling_product_id text,
  bling_product_store_id text,
  store_name text,
  codigo_atual text,
  preco numeric,
  preco_promocional numeric,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH src AS (
    SELECT
      (ord)::int AS linha,
      upper(btrim(coalesce(r->>'sku', ''))) AS sku,
      btrim(coalesce(r->>'bling_store_id', '')) AS bling_store_id,
      btrim(coalesce(r->>'codigo', '')) AS codigo_novo
    FROM jsonb_array_elements(coalesce(_rows, '[]'::jsonb)) WITH ORDINALITY AS t(r, ord)
  ), joined AS (
    SELECT
      s.*,
      p.id AS product_id,
      p.bling_product_id,
      bps.bling_product_store_id,
      bps.store_name,
      bps.store_product_code AS codigo_atual,
      coalesce(bps.current_price, p.preco) AS preco,
      bps.current_promotional_price AS preco_promocional
    FROM src s
    LEFT JOIN public.bling_products p
      ON p.company_id = _company_id
     AND upper(btrim(p.codigo)) = s.sku
    LEFT JOIN public.bling_product_stores bps
      ON bps.company_id = _company_id
     AND bps.internal_product_id = p.id
     AND bps.bling_store_id = s.bling_store_id
     AND bps.is_linked = true
  )
  SELECT
    linha, sku, bling_store_id, codigo_novo, product_id, bling_product_id,
    bling_product_store_id, store_name, codigo_atual, preco, preco_promocional,
    CASE
      WHEN sku = '' OR bling_store_id = '' OR codigo_novo = '' THEN 'dados_invalidos'
      WHEN product_id IS NULL THEN 'sku_nao_encontrado'
      WHEN bling_product_store_id IS NULL THEN 'loja_nao_vinculada'
      WHEN nullif(btrim(coalesce(bling_product_id, '')), '') IS NULL THEN 'sem_bling_id'
      WHEN preco IS NULL THEN 'sem_preco'
      WHEN coalesce(codigo_atual, '') = codigo_novo THEN 'ja_atualizado'
      ELSE 'ok'
    END AS status
  FROM joined;
$$;

REVOKE ALL ON FUNCTION public.match_store_code_sheet(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_store_code_sheet(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_store_code_sheet(uuid, jsonb) TO service_role;

-- Prévia: contagens + amostra para o usuário conferir antes de confirmar.
CREATE OR REPLACE FUNCTION public.preview_store_code_sheet(
  _company_id uuid,
  _rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  _res jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  WITH m AS (
    SELECT * FROM public.match_store_code_sheet(_company_id, _rows)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM m),
    'ok', (SELECT count(*) FROM m WHERE status = 'ok'),
    'ja_atualizado', (SELECT count(*) FROM m WHERE status = 'ja_atualizado'),
    'sku_nao_encontrado', (SELECT count(*) FROM m WHERE status = 'sku_nao_encontrado'),
    'loja_nao_vinculada', (SELECT count(*) FROM m WHERE status = 'loja_nao_vinculada'),
    'sem_bling_id', (SELECT count(*) FROM m WHERE status = 'sem_bling_id'),
    'sem_preco', (SELECT count(*) FROM m WHERE status = 'sem_preco'),
    'dados_invalidos', (SELECT count(*) FROM m WHERE status = 'dados_invalidos'),
    'amostra', (
      SELECT coalesce(jsonb_agg(x ORDER BY x->>'linha'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'linha', linha, 'sku', sku, 'bling_store_id', bling_store_id,
          'store_name', store_name, 'codigo_atual', codigo_atual,
          'codigo_novo', codigo_novo, 'status', status
        ) AS x
        FROM m ORDER BY (status <> 'ok'), linha LIMIT 300
      ) s
    )
  ) INTO _res;

  RETURN _res;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_store_code_sheet(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_store_code_sheet(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_store_code_sheet(uuid, jsonb) TO service_role;

-- Confirmação: grava no banco local e enfileira o envio ao Bling.
CREATE OR REPLACE FUNCTION public.apply_store_code_sheet(
  _company_id uuid,
  _rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '180s'
AS $$
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

  CREATE TEMP TABLE _sheet_work ON COMMIT DROP AS
  SELECT * FROM public.match_store_code_sheet(_company_id, _rows);

  SELECT count(*) INTO _skipped FROM _sheet_work WHERE status <> 'ok';

  -- remove itens antigos da mesma origem ainda pendentes
  DELETE FROM public.bling_push_queue q
  USING _sheet_work w
  WHERE q.integration_id = _integration_id
    AND q.tipo = 'codigo_loja_planilha'
    AND q.bling_product_store_id = w.bling_product_store_id
    AND q.status IN ('pendente', 'processando')
    AND w.status = 'ok';

  WITH inserted AS (
    INSERT INTO public.bling_push_queue (
      company_id, integration_id, product_id, bling_product_id,
      bling_product_store_id, tipo, valor_novo, payload,
      status, proxima_tentativa_em
    )
    SELECT
      _company_id, _integration_id, w.product_id, w.bling_product_id,
      w.bling_product_store_id, 'codigo_loja_planilha', w.preco,
      jsonb_build_object(
        'bling_store_id', w.bling_store_id,
        'codigo', w.codigo_novo,
        'preco', w.preco,
        'preco_promocional', w.preco_promocional,
        'origem', 'planilha'
      ),
      'pendente', now()
    FROM _sheet_work w
    WHERE w.status = 'ok'
    RETURNING 1
  )
  SELECT count(*) INTO _enqueued FROM inserted;

  -- reflete imediatamente no banco do Ajustta-Ê
  UPDATE public.bling_product_stores bps
  SET store_product_code = w.codigo_novo
  FROM _sheet_work w
  WHERE w.status = 'ok'
    AND bps.company_id = _company_id
    AND bps.bling_product_store_id = w.bling_product_store_id;

  RETURN jsonb_build_object(
    'integration_id', _integration_id,
    'enqueued', _enqueued,
    'skipped', _skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_store_code_sheet(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_store_code_sheet(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_store_code_sheet(uuid, jsonb) TO service_role;
