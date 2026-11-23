\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE c uuid; i uuid; pev uuid; pod uuid; v numeric; b boolean; n int; f uuid; dep text;
BEGIN
  SELECT bi.company_id, bi.id, bi.default_deposito_id INTO c, i, dep
    FROM public.bling_integrations bi WHERE bi.status = 'conectada' AND bi.default_deposito_id IS NOT NULL LIMIT 1;
  IF c IS NULL THEN RAISE EXCEPTION 'No connected integration fixture'; END IF;
  SELECT id INTO f FROM public.fornecedores WHERE codigo = 'evolusom' AND company_id IS NULL;

  -- Produto Evolusom (fornecedor tem 3, teto alto) com estoque calculado 4 via ML.
  INSERT INTO public.bling_products(company_id, codigo, bling_product_id, estoque, ultimo_estoque_sincronizado)
    VALUES (c, 'EV9999001', '9999991001', 4, 4) RETURNING id INTO pev;
  INSERT INTO public.fornecedor_produtos(fornecedor_id, codigo, qt_estoque)
    VALUES (f, '9999001', 3)
    ON CONFLICT DO NOTHING;
  INSERT INTO public.product_cost_overrides(company_id, product_id, stock_cap) VALUES (c, pev, 100)
    ON CONFLICT DO NOTHING;
  -- Produto Oderço com estoque 7.
  INSERT INTO public.bling_products(company_id, codigo, bling_product_id, estoque, ultimo_estoque_sincronizado)
    VALUES (c, 'O9999002', '9999991002', 7, 7) RETURNING id INTO pod;

  DELETE FROM public.bling_stock_deposits WHERE company_id = c;
  INSERT INTO public.bling_stock_deposits(company_id, bling_deposit_id, descricao, padrao, modo, zerar_fornecedores) VALUES
    (c, dep, 'Geral', true, 'completo', '{}'),
    (c, 'TEST-SEM-ML', 'Sem ML', false, 'sem_ml', '{}'),
    (c, 'TEST-ZERA-OD', 'Zera Oderço', false, 'completo', ARRAY['oderco']),
    (c, 'TEST-PARADO', 'Parado', false, 'nao_atualizar', '{}');

  PERFORM public.prepare_deposit_stock_targets(c, ARRAY[pev, pod], true);

  -- Completo: mantém o valor já calculado; depósito padrão herda o último envio (sem reenvio).
  SELECT estoque_alvo, pendente INTO v, b FROM public.bling_product_deposit_stock WHERE product_id = pev AND bling_deposit_id = dep;
  IF v <> 4 OR b THEN RAISE EXCEPTION 'Completo deve ser 4 e não pendente: % %', v, b; END IF;
  -- Sem ML: usa o estoque do fornecedor (3).
  SELECT estoque_alvo, pendente INTO v, b FROM public.bling_product_deposit_stock WHERE product_id = pev AND bling_deposit_id = 'TEST-SEM-ML';
  IF v <> 3 OR NOT b THEN RAISE EXCEPTION 'Sem ML deve ser 3 e pendente: % %', v, b; END IF;
  -- Zerar Oderço: produto Oderço vai a 0, o Evolusom segue a regra completa (4).
  SELECT estoque_alvo INTO v FROM public.bling_product_deposit_stock WHERE product_id = pod AND bling_deposit_id = 'TEST-ZERA-OD';
  IF v <> 0 THEN RAISE EXCEPTION 'Fornecedor zerado deve ser 0: %', v; END IF;
  SELECT estoque_alvo INTO v FROM public.bling_product_deposit_stock WHERE product_id = pev AND bling_deposit_id = 'TEST-ZERA-OD';
  IF v <> 4 THEN RAISE EXCEPTION 'Outro fornecedor segue a regra do depósito: %', v; END IF;
  -- Não atualizar: nenhuma linha.
  SELECT count(*) INTO n FROM public.bling_product_deposit_stock WHERE product_id IN (pev, pod) AND bling_deposit_id = 'TEST-PARADO';
  IF n <> 0 THEN RAISE EXCEPTION 'Depósito não atualizado não deve receber envio'; END IF;

  -- Após envio, só volta a ficar pendente se o valor mudar.
  PERFORM public.finish_deposit_stock_sent(pev, 'TEST-SEM-ML', 3);
  PERFORM public.prepare_deposit_stock_targets(c, ARRAY[pev], true);
  SELECT pendente INTO b FROM public.bling_product_deposit_stock WHERE product_id = pev AND bling_deposit_id = 'TEST-SEM-ML';
  IF b THEN RAISE EXCEPTION 'Sem mudança não deve reenviar'; END IF;
END $$;
ROLLBACK;
