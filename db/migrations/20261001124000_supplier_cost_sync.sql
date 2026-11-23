-- 1) Novo tipo de envio: atualizar o preço de custo no vínculo do fornecedor no Bling.
ALTER TABLE public.bling_push_queue DROP CONSTRAINT bling_push_queue_tipo_check;
ALTER TABLE public.bling_push_queue ADD CONSTRAINT bling_push_queue_tipo_check CHECK (tipo = ANY (ARRAY[
  'preco','estoque','produto','criar','excluir','inativar','preco_loja','estoque_loja',
  'vincular_loja','desvincular_loja','codigo_loja','codigo_loja_planilha','fornecedor_vinculo','fornecedor_custo']));

-- 2) Vincular: só vincula quando houver preço de custo (catálogo do fornecedor ou produto);
--    grava o custo também no produto.
CREATE OR REPLACE FUNCTION public.enqueue_supplier_links(_company_id uuid, _mode text, _product_ids uuid[] DEFAULT NULL::uuid[], _bling_supplier_id text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _integ uuid; _n int := 0; _skipped int := 0; _no_cost int := 0;
BEGIN
  IF NOT app_private.is_company_member(_company_id, auth.uid()) THEN RAISE EXCEPTION 'not a member of company'; END IF;
  SELECT id INTO _integ FROM public.bling_integrations WHERE company_id = _company_id LIMIT 1;
  IF _integ IS NULL THEN RAISE EXCEPTION 'Empresa sem integração Bling'; END IF;
  IF _mode = 'manual' AND COALESCE(_bling_supplier_id, '') = '' THEN RAISE EXCEPTION 'Fornecedor não informado'; END IF;

  CREATE TEMP TABLE _cand ON COMMIT DROP AS
  WITH base AS (
    SELECT p.id, p.bling_product_id, p.preco_custo,
           NULLIF(btrim(substring(btrim(coalesce(p.codigo,'')) from '^[A-Za-z]+(.*)$')), '') AS cod_forn,
           CASE WHEN _mode = 'manual' THEN _bling_supplier_id
                ELSE (SELECT m.bling_supplier_id FROM public.bling_supplier_map m
                      WHERE m.company_id = _company_id AND m.supplier_codigo = public.map_sku_prefix(p.codigo)
                      ORDER BY m.bling_supplier_id LIMIT 1) END AS forn,
           CASE WHEN _mode = 'manual' THEN (SELECT m.supplier_codigo FROM public.bling_supplier_map m
                      WHERE m.company_id = _company_id AND m.bling_supplier_id = _bling_supplier_id)
                ELSE public.map_sku_prefix(p.codigo) END AS sup_cod
    FROM public.bling_products p
    WHERE p.company_id = _company_id
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
      AND NOT EXISTS (SELECT 1 FROM public.bling_product_suppliers s WHERE s.company_id = _company_id AND s.product_id = p.id)
  )
  SELECT b.*, COALESCE((
      SELECT COALESCE(NULLIF((fp.precos->>'PR')::numeric,0), NULLIF((fp.precos->>'base')::numeric,0),
                      NULLIF((fp.precos->>'dropshipping')::numeric,0), NULLIF((fp.precos->>'crossdocking')::numeric,0))
      FROM public.fornecedor_produtos fp JOIN public.fornecedores f ON f.id = fp.fornecedor_id
      WHERE f.codigo = b.sup_cod AND b.cod_forn IS NOT NULL AND ltrim(fp.codigo, '0') = ltrim(b.cod_forn, '0')
      LIMIT 1), NULLIF(b.preco_custo, 0)) AS custo
  FROM base b;

  SELECT count(*) FILTER (WHERE forn IS NULL OR COALESCE(bling_product_id, '') = ''),
         count(*) FILTER (WHERE forn IS NOT NULL AND COALESCE(bling_product_id, '') <> '' AND custo IS NULL)
    INTO _skipped, _no_cost FROM _cand;

  UPDATE public.bling_products bp SET preco_custo = c.custo, updated_at = now()
  FROM _cand c
  WHERE bp.id = c.id AND c.forn IS NOT NULL AND c.custo IS NOT NULL AND bp.preco_custo IS DISTINCT FROM c.custo;

  INSERT INTO public.bling_push_queue (company_id, integration_id, product_id, bling_product_id, tipo, valor_novo, payload)
  SELECT _company_id, _integ, c.id, c.bling_product_id, 'fornecedor_vinculo', c.custo,
         jsonb_build_object('bling_supplier_id', c.forn, 'codigo', COALESCE(c.cod_forn, ''), 'preco_custo', c.custo)
  FROM _cand c
  WHERE c.forn IS NOT NULL AND COALESCE(c.bling_product_id, '') <> '' AND c.custo IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('enqueued', _n, 'skipped', _skipped, 'no_cost', _no_cost);
END $function$;

-- 3) Sempre que o preço de custo do produto mudar (precificação, edição etc.),
--    enfileira a atualização do custo no vínculo do fornecedor no Bling.
CREATE OR REPLACE FUNCTION app_private.trg_enqueue_supplier_cost()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _link record;
BEGIN
  IF NEW.preco_custo IS NULL OR NEW.preco_custo <= 0 OR NEW.preco_custo IS NOT DISTINCT FROM OLD.preco_custo THEN
    RETURN NEW;
  END IF;
  SELECT s.bling_link_id, s.bling_supplier_id, s.codigo, s.preco_custo INTO _link
  FROM public.bling_product_suppliers s
  WHERE s.company_id = NEW.company_id AND s.product_id = NEW.id
  ORDER BY s.padrao DESC LIMIT 1;
  IF NOT FOUND OR _link.preco_custo IS NOT DISTINCT FROM NEW.preco_custo THEN RETURN NEW; END IF;
  INSERT INTO public.bling_push_queue (company_id, integration_id, product_id, bling_product_id, tipo, valor_novo, payload)
  SELECT NEW.company_id, i.id, NEW.id, NEW.bling_product_id, 'fornecedor_custo', NEW.preco_custo,
         jsonb_build_object('bling_link_id', _link.bling_link_id, 'bling_supplier_id', _link.bling_supplier_id,
                            'codigo', COALESCE(_link.codigo, ''), 'preco_custo', NEW.preco_custo)
  FROM public.bling_integrations i WHERE i.company_id = NEW.company_id AND COALESCE(NEW.bling_product_id, '') <> ''
  LIMIT 1
  ON CONFLICT (integration_id, product_id, tipo) WHERE status IN ('pendente','processando') AND bling_product_store_id IS NULL
  DO UPDATE SET payload = EXCLUDED.payload, valor_novo = EXCLUDED.valor_novo, updated_at = now();
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_bling_products_supplier_cost ON public.bling_products;
CREATE TRIGGER trg_bling_products_supplier_cost
  AFTER UPDATE OF preco_custo ON public.bling_products
  FOR EACH ROW EXECUTE FUNCTION app_private.trg_enqueue_supplier_cost();

NOTIFY pgrst, 'reload schema';
