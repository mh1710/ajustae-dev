-- Limpeza exclusivamente local, sem qualquer chamada ao Bling.
CREATE OR REPLACE FUNCTION public.clear_local_custom_fields(_company_id uuid, _reset_definitions boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET statement_timeout = '120s' AS $$
DECLARE _values int; _fields int := 0;
BEGIN
  -- Serializa a limpeza com a criação/controle de tarefas.
  LOCK TABLE public.bling_custom_field_jobs IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.bling_custom_field_jobs WHERE company_id = _company_id
    AND (status IN ('executando', 'pausado') OR lease_until > now())) THEN
    RAISE EXCEPTION 'Aguarde a tarefa terminar ou cancele antes de limpar os campos.';
  END IF;
  DELETE FROM public.bling_product_custom_values WHERE company_id = _company_id;
  GET DIAGNOSTICS _values = ROW_COUNT;
  -- Itens/tarefas antigos não podem restaurar valores após uma limpeza.
  DELETE FROM public.bling_custom_field_jobs WHERE company_id = _company_id;
  IF _reset_definitions THEN
    DELETE FROM public.bling_custom_field_roles WHERE company_id = _company_id;
    DELETE FROM public.bling_custom_fields WHERE company_id = _company_id;
    GET DIAGNOSTICS _fields = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('values_deleted', _values, 'fields_deleted', _fields);
END $$;
REVOKE ALL ON FUNCTION public.clear_local_custom_fields(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_local_custom_fields(uuid, boolean) TO service_role;
NOTIFY pgrst, 'reload schema';