-- Guarda quando cada base de fornecedor foi baixada com sucesso pela última vez.
-- Uma falha de download (site do fornecedor fora do ar / lento) não apaga a base
-- anterior, então a automação pode seguir com a última base completa recente
-- em vez de parar todas as empresas.
ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS last_ok_sync_at timestamptz;

CREATE OR REPLACE FUNCTION public.fornecedores_track_last_ok()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.last_sync_status = 'ok' THEN
    NEW.last_ok_sync_at := COALESCE(NEW.last_sync_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fornecedores_last_ok ON public.fornecedores;
CREATE TRIGGER trg_fornecedores_last_ok
  BEFORE INSERT OR UPDATE ON public.fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.fornecedores_track_last_ok();

-- Preenche: base ok usa o último sync; demais usam a última gravação real de produtos.
UPDATE public.fornecedores f
   SET last_ok_sync_at = CASE
     WHEN f.last_sync_status = 'ok' THEN f.last_sync_at
     ELSE (SELECT max(p.updated_at) FROM public.fornecedor_produtos p WHERE p.fornecedor_id = f.id)
   END
 WHERE f.last_ok_sync_at IS NULL;
