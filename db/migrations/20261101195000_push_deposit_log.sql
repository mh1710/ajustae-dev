-- Registra cada chamada de estoque por depósito no item da fila, para os Logs
-- mostrarem qual estoque foi atualizado em cada requisição.
ALTER TABLE public.bling_push_queue ADD COLUMN IF NOT EXISTS depositos_log jsonb;

CREATE OR REPLACE FUNCTION public.log_bling_push_deposit(
  _item_id uuid, _deposit_id text, _descricao text, _anterior numeric, _valor numeric,
  _ok boolean, _status integer, _ms integer
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.bling_push_queue
     SET requisicoes = COALESCE(requisicoes, 0) + 1,
         depositos_log = COALESCE(depositos_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'deposito_id', _deposit_id, 'descricao', _descricao, 'anterior', _anterior, 'valor', _valor,
           'ok', _ok, 'status', _status, 'ms', _ms, 'at', now()))
   WHERE id = _item_id;
$$;
REVOKE ALL ON FUNCTION public.log_bling_push_deposit(uuid, text, text, numeric, numeric, boolean, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_bling_push_deposit(uuid, text, text, numeric, numeric, boolean, integer, integer) TO service_role;
