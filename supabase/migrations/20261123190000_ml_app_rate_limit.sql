-- Limite oficial do Mercado Livre: 18.000 requisições/hora por aplicação (Client ID),
-- compartilhado por todas as empresas, tarefas e Workers. Cada chamada reserva um horário.
CREATE TABLE IF NOT EXISTS public.ml_app_rate_limit (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  next_slot_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  blocked_until timestamptz,
  hour_started_at timestamptz NOT NULL DEFAULT date_trunc('hour', clock_timestamp()),
  hour_count integer NOT NULL DEFAULT 0,
  last_429_at timestamptz,
  count_429 integer NOT NULL DEFAULT 0
);
GRANT ALL ON public.ml_app_rate_limit TO service_role;
ALTER TABLE public.ml_app_rate_limit ENABLE ROW LEVEL SECURITY;
INSERT INTO public.ml_app_rate_limit(singleton) VALUES (true) ON CONFLICT DO NOTHING;

-- Retorna quantos ms esperar pelo horário reservado, ou -1 quando a espera passaria de _max_wait_ms
-- (nesse caso nada é reservado).
CREATE OR REPLACE FUNCTION public.take_ml_app_slot(_spacing_ms int, _max_wait_ms int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.ml_app_rate_limit; _now timestamptz := clock_timestamp(); _at timestamptz; _wait int;
BEGIN
  IF _spacing_ms IS NULL OR _spacing_ms < 50 THEN RAISE EXCEPTION 'invalid spacing'; END IF;
  INSERT INTO public.ml_app_rate_limit(singleton) VALUES (true) ON CONFLICT DO NOTHING;
  SELECT * INTO _row FROM public.ml_app_rate_limit WHERE singleton FOR UPDATE;
  _at := greatest(_now, _row.next_slot_at, coalesce(_row.blocked_until, _now));
  _wait := ceil(extract(epoch FROM (_at - _now)) * 1000)::int;
  IF _wait > greatest(coalesce(_max_wait_ms, 0), 0) THEN RETURN -1; END IF;
  UPDATE public.ml_app_rate_limit SET
    next_slot_at = _at + make_interval(secs => _spacing_ms / 1000.0),
    hour_count = CASE WHEN hour_started_at = date_trunc('hour', _at) THEN hour_count + 1 ELSE 1 END,
    hour_started_at = date_trunc('hour', _at)
  WHERE singleton;
  RETURN _wait;
END $$;

-- 429 recebido: pausa todas as consultas da aplicação até o fim da espera.
CREATE OR REPLACE FUNCTION public.pause_ml_app(_ms int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _until timestamptz := clock_timestamp() + make_interval(secs => least(greatest(coalesce(_ms, 0), 0), 600000) / 1000.0);
BEGIN
  INSERT INTO public.ml_app_rate_limit(singleton) VALUES (true) ON CONFLICT DO NOTHING;
  UPDATE public.ml_app_rate_limit SET
    blocked_until = greatest(coalesce(blocked_until, _until), _until),
    last_429_at = clock_timestamp(),
    count_429 = count_429 + 1
  WHERE singleton;
END $$;

REVOKE ALL ON FUNCTION public.take_ml_app_slot(int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pause_ml_app(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_ml_app_slot(int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.pause_ml_app(int) TO service_role;
NOTIFY pgrst, 'reload schema';
