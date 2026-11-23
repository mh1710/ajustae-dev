
-- 1) FK: não apagar regras ao excluir empresa
ALTER TABLE public.validation_rules DROP CONSTRAINT IF EXISTS validation_rules_company_id_fkey;
ALTER TABLE public.validation_rules
  ADD CONSTRAINT validation_rules_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

-- 2) Regras agora são globais: policies permitem CRUD para autenticados em regras globais
DROP POLICY IF EXISTS "rules_insert" ON public.validation_rules;
DROP POLICY IF EXISTS "rules_update" ON public.validation_rules;
DROP POLICY IF EXISTS "rules_delete" ON public.validation_rules;

CREATE POLICY "rules_insert_global" ON public.validation_rules
  FOR INSERT TO authenticated
  WITH CHECK (company_id IS NULL);
CREATE POLICY "rules_update_global" ON public.validation_rules
  FOR UPDATE TO authenticated
  USING (company_id IS NULL) WITH CHECK (company_id IS NULL);
CREATE POLICY "rules_delete_global" ON public.validation_rules
  FOR DELETE TO authenticated
  USING (company_id IS NULL);

-- 3) delete_company não deve mais tocar em validation_rules
CREATE OR REPLACE FUNCTION public.delete_company(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  _is_member boolean;
  _deleted_products int := 0;
  _deleted_audit_results int := 0;
  _deleted_push int := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND ativo = true
  ) INTO _is_member;
  IF NOT _is_member THEN
    RAISE EXCEPTION 'not a member of company';
  END IF;

  DELETE FROM public.audit_results WHERE company_id = _company_id;
  GET DIAGNOSTICS _deleted_audit_results = ROW_COUNT;
  DELETE FROM public.bling_push_queue WHERE company_id = _company_id;
  GET DIAGNOSTICS _deleted_push = ROW_COUNT;
  DELETE FROM public.bling_product_stores WHERE company_id = _company_id;
  DELETE FROM public.bling_sync_job_errors WHERE company_id = _company_id;
  DELETE FROM public.bling_sync_jobs WHERE company_id = _company_id;
  DELETE FROM public.bling_store_sync_jobs WHERE company_id = _company_id;
  DELETE FROM public.bling_stores WHERE company_id = _company_id;
  DELETE FROM public.product_sheet_rows WHERE company_id = _company_id;
  DELETE FROM public.import_batches WHERE company_id = _company_id;
  DELETE FROM public.audit_runs WHERE company_id = _company_id;
  DELETE FROM public.bling_products WHERE company_id = _company_id;
  GET DIAGNOSTICS _deleted_products = ROW_COUNT;
  DELETE FROM public.bling_integrations WHERE company_id = _company_id;
  DELETE FROM public.bling_oauth_states WHERE company_id = _company_id;
  DELETE FROM public.company_users WHERE company_id = _company_id;
  DELETE FROM public.companies WHERE id = _company_id;

  RETURN jsonb_build_object(
    'ok', true,
    'produtos_removidos', _deleted_products,
    'audit_results_removidos', _deleted_audit_results,
    'push_queue_removidos', _deleted_push
  );
END;
$function$;

-- 4) Recriar as regras globais
INSERT INTO public.validation_rules (company_id, slug, name, description, category, severity, active, config) VALUES
(NULL, 'titulo-maximo', 'Título máximo (60 caracteres)', 'O nome/descrição do produto não pode ter mais que 60 caracteres.', 'conteudo', 'error', true, '{"max":60}'::jsonb),
(NULL, 'descricao-curta-minima', 'Descrição curta mínima (150 caracteres)', 'A descrição curta deve ter no mínimo 150 caracteres.', 'conteudo', 'error', true, '{"min":150}'::jsonb),
(NULL, 'descricao-complementar-igual-nome', 'Descrição complementar igual ao nome', 'A descrição complementar deve ser idêntica ao nome/descrição do produto. Auto-corrigível.', 'conteudo', 'error', true, '{"autofix":true}'::jsonb),
(NULL, 'ean-obrigatorio', 'EAN obrigatório', 'O campo GTIN/EAN não pode estar vazio.', 'conteudo', 'warning', true, '{}'::jsonb),
(NULL, 'garantia-anatel-desc-complementar', 'Garantia e Código Anatel na descrição curta', 'A descrição curta deve conter as palavras "Garantia" e "Anatel".', 'conteudo', 'error', true, '{}'::jsonb),
(NULL, 'garantia-duplicada-desc-curta', 'Descrição curta não pode ter "Garantia" duplicado', 'A descrição curta não pode conter a palavra "Garantia" mais de uma vez (case-insensitive).', 'conteudo', 'error', true, '{}'::jsonb),
(NULL, 'produto-em-fornecedor', 'Produto presente na base do fornecedor', 'O prefixo do SKU identifica o fornecedor (O/ODS=Oderço, HX/HA=Hayamax, EV/E=Evolusom). O código numérico após o prefixo precisa existir na base atualizada do respectivo fornecedor.', 'conteudo', 'error', true, '{}'::jsonb)
ON CONFLICT (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), slug) DO NOTHING;
