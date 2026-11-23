-- Otimizações de carga do banco (CPU e disco):
-- 1) limpeza das respostas do pg_net (tabela chegou a 1,7 GB de espaço inchado);
-- 2) retenção mais curta de logs operacionais;
-- 3) índices de apoio para a fila de envio ao Bling.

CREATE OR REPLACE FUNCTION public.prune_old_operational_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
BEGIN
  DELETE FROM public.product_sheet_rows r
  USING public.import_batches b
  WHERE r.batch_id = b.id AND b.created_at < now() - interval '2 days';

  DELETE FROM public.audit_results a
  WHERE a.run_id IN (SELECT id FROM public.audit_runs WHERE created_at < now() - interval '3 days');

  DELETE FROM public.bling_api_calls WHERE created_at < now() - interval '3 days';

  DELETE FROM public.bling_push_queue
  WHERE status IN ('concluido','cancelado')
    AND COALESCE(processed_at, updated_at, created_at) < now() - interval '2 days';

  DELETE FROM public.bling_api_usage_daily WHERE dia < (now() AT TIME ZONE 'America/Sao_Paulo')::date - 60;

  -- respostas do pg_net: só interessam por alguns minutos
  BEGIN
    DELETE FROM net._http_response WHERE created < now() - interval '10 minutes';
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    NULL;
  END;
END;
$$;

-- Fila de envio: claim por integração + pendentes
CREATE INDEX IF NOT EXISTS bling_push_queue_claim_idx
  ON public.bling_push_queue (integration_id, proxima_tentativa_em, created_at)
  WHERE status = 'pendente';

-- Limpeza das respostas do pg_net a cada 10 minutos (mantém o disco estável)
SELECT cron.schedule(
  'prune-pgnet-responses',
  '*/10 * * * *',
  $$DELETE FROM net._http_response WHERE created < now() - interval '10 minutes'$$
)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-pgnet-responses');
