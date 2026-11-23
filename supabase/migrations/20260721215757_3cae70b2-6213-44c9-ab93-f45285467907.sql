
-- Allow 'pausado' status
ALTER TABLE public.bling_push_queue DROP CONSTRAINT IF EXISTS bling_push_queue_status_check;
ALTER TABLE public.bling_push_queue ADD CONSTRAINT bling_push_queue_status_check
  CHECK (status = ANY (ARRAY['pendente','processando','concluido','erro','cancelado','pausado']));

-- Progress: include pausados
CREATE OR REPLACE FUNCTION public.get_bling_push_progress(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _res jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  SELECT jsonb_build_object(
    'total', count(*),
    'pendentes', count(*) FILTER (WHERE status IN ('pendente','processando')),
    'pausados', count(*) FILTER (WHERE status = 'pausado'),
    'concluidos', count(*) FILTER (WHERE status = 'concluido'),
    'erros', count(*) FILTER (WHERE status = 'erro'),
    'oldest_pending', min(created_at) FILTER (WHERE status IN ('pendente','processando')),
    'last_processed', max(updated_at) FILTER (WHERE status IN ('concluido','erro'))
  ) INTO _res FROM public.bling_push_queue WHERE company_id = _company_id;
  RETURN COALESCE(_res, '{}'::jsonb);
END; $function$;

-- Pause: pending -> pausado
CREATE OR REPLACE FUNCTION public.pause_bling_push(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  UPDATE public.bling_push_queue
     SET status = 'pausado', updated_at = now()
   WHERE company_id = _company_id AND status = 'pendente';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('pausados', _n);
END; $$;

-- Resume: pausado -> pendente (reset schedule)
CREATE OR REPLACE FUNCTION public.resume_bling_push(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  UPDATE public.bling_push_queue
     SET status = 'pendente', proxima_tentativa_em = now(), updated_at = now()
   WHERE company_id = _company_id AND status = 'pausado';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('retomados', _n);
END; $$;

-- Cancel: pending + paused -> cancelado
CREATE OR REPLACE FUNCTION public.cancel_bling_push(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  DELETE FROM public.bling_push_queue
   WHERE company_id = _company_id AND status IN ('pendente','pausado');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('cancelados', _n);
END; $$;

-- Delete error items
CREATE OR REPLACE FUNCTION public.delete_bling_push_errors(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;
  DELETE FROM public.bling_push_queue
   WHERE company_id = _company_id AND status = 'erro';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('excluidos', _n);
END; $$;

GRANT EXECUTE ON FUNCTION public.pause_bling_push(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_bling_push(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_bling_push(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_bling_push_errors(uuid) TO authenticated;
