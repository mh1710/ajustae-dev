-- Conta as chamadas reais ao Bling na fila: estoque por depósito faz uma
-- chamada por depósito com diferença, então um item pode valer 0, 1, 2, 3...

ALTER TABLE public.bling_push_queue ADD COLUMN IF NOT EXISTS requisicoes integer;

-- Soma chamadas feitas por um item (inclusive tentativas parciais).
CREATE OR REPLACE FUNCTION public.add_bling_push_requests(_item_id uuid, _n integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.bling_push_queue
     SET requisicoes = COALESCE(requisicoes, 0) + GREATEST(COALESCE(_n, 0), 0)
   WHERE id = _item_id;
$$;
REVOKE ALL ON FUNCTION public.add_bling_push_requests(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_bling_push_requests(uuid, integer) TO service_role;

-- Preenche itens de estoque já concluídos desde que existem depósitos configurados.
UPDATE public.bling_push_queue q
   SET requisicoes = (
     SELECT count(*) FROM public.bling_product_deposit_stock s
      WHERE s.product_id = q.product_id
        AND s.sincronizado_em >= q.created_at
        AND s.sincronizado_em <= COALESCE(q.processed_at, q.updated_at) + interval '5 seconds')
 WHERE q.tipo = 'estoque'
   AND q.requisicoes IS NULL
   AND q.status IN ('concluido', 'erro', 'pendente', 'processando', 'pausado')
   AND EXISTS (SELECT 1 FROM public.bling_stock_deposits d WHERE d.company_id = q.company_id AND d.ativo)
   AND q.created_at >= (SELECT min(d.synced_at) FROM public.bling_stock_deposits d WHERE d.company_id = q.company_id);
-- Itens ainda abertos começam do zero (o restante vem dos depósitos pendentes).
UPDATE public.bling_push_queue q SET requisicoes = NULL
 WHERE q.status IN ('pendente', 'processando', 'pausado') AND q.requisicoes = 0;

CREATE OR REPLACE FUNCTION public.get_bling_push_progress(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _res jsonb; _has_deposits boolean;
BEGIN
  IF public.is_company_restricted() THEN RAISE EXCEPTION 'Acesso restrito por empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  _has_deposits := EXISTS (SELECT 1 FROM public.bling_stock_deposits WHERE company_id = _company_id AND ativo);

  WITH q AS (
    SELECT q.*,
      CASE
        WHEN q.status IN ('concluido', 'erro') THEN COALESCE(q.requisicoes, 1)
        ELSE COALESCE(q.requisicoes, 0)
      END AS req_done,
      CASE
        WHEN q.status NOT IN ('pendente', 'processando', 'pausado') THEN 0
        WHEN q.tipo = 'estoque' AND _has_deposits THEN COALESCE(dp.n, 0)
        ELSE 1
      END AS req_left
    FROM public.bling_push_queue q
    LEFT JOIN (
      SELECT s.product_id, count(*)::int AS n
        FROM public.bling_product_deposit_stock s
        JOIN public.bling_stock_deposits d
          ON d.company_id = s.company_id AND d.bling_deposit_id = s.bling_deposit_id AND d.ativo
       WHERE s.company_id = _company_id AND s.pendente AND _has_deposits
       GROUP BY s.product_id
    ) dp ON dp.product_id = q.product_id AND q.tipo = 'estoque'
    WHERE q.company_id = _company_id
  )
  SELECT jsonb_build_object(
    'total', count(*),
    'pendentes', count(*) FILTER (WHERE status IN ('pendente','processando')),
    'pausados', count(*) FILTER (WHERE status = 'pausado'),
    'concluidos', count(*) FILTER (WHERE status = 'concluido'),
    'erros', count(*) FILTER (WHERE status = 'erro'),
    'requests_total', COALESCE(sum(req_done + req_left), 0),
    'requests_done', COALESCE(sum(req_done), 0),
    'products_total', count(DISTINCT product_id),
    'products_done', count(DISTINCT product_id) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM public.bling_push_queue q2
        WHERE q2.company_id = _company_id
          AND q2.product_id = q.product_id
          AND q2.status IN ('pendente','processando','pausado')
      )
    ),
    'oldest_pending', min(created_at) FILTER (WHERE status IN ('pendente','processando')),
    'last_processed', max(updated_at) FILTER (WHERE status IN ('concluido','erro'))
  ) INTO _res FROM q;
  RETURN COALESCE(_res, '{}'::jsonb);
END; $function$;
