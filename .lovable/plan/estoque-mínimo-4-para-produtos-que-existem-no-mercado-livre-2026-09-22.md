# Estoque mínimo 4 para produtos que existem no Mercado Livre

## Regra

Quando o estoque calculado a partir do fornecedor for menor que 4 e o mesmo SKU tiver oferta Full com estoque no Mercado Livre, o estoque do produto passa a ser 4.

Detalhes acordados:
- Vale apenas para SKUs marcados como qualificados no mapeamento do ML (Full, com estoque e entrega para Maringá).
- Produtos sem correspondência na base do fornecedor continuam sem alteração.
- O piso é fixo em 4 (não configurável por empresa).
- O piso nunca reduz estoque: se o fornecedor tiver 10, continua 10.

Onde passa a valer:
- Automação de estoque (execuções programadas 00:00 / 06:00 / 12:00 / 18:00).
- Botões de atualização de estoque na tela de Produtos e no painel de preço/estoque.

## Como fica na prática

Exemplos com um SKU presente no ML:

```text
fornecedor 0  -> estoque 4
fornecedor 2  -> estoque 4
fornecedor 7  -> estoque 7
sem código no fornecedor -> inalterado
```

O valor 4 é enviado ao Bling normalmente, como qualquer outra alteração de estoque, e aparece no relatório da execução como alteração de estoque.

## Detalhes técnicos

- Nova migração (aplicada via psql) recriando duas funções do banco:
  - `automation_update_stock_only(_company_id, _run_id)`
  - `transform_update_price_stock(_company_id, _product_ids, _include_stores, _run_id, _only_stock, _only_price)` — somente no ramo de estoque.
- Em ambas, após calcular `estoque_novo` a partir de `fornecedor_produtos` (incluindo o teto `stock_cap`), aplicar:
  `estoque_novo = GREATEST(estoque_novo, 4)` quando existir em `ml_product_matches` um registro com o mesmo `sku` (comparação por SKU, cobrindo toda a conta) e `qualifies = true`.
- O piso é aplicado depois do `stock_cap`, para não ser anulado por ele.
- Linhas com `fornecedor_id IS NULL` ou `estoque_novo IS NULL` permanecem intocadas, mantendo a contagem `sem_fornecedor` como hoje.
- O join usa `EXISTS` sobre `ml_product_matches` com índice em `sku`; criar o índice caso não exista, para não pesar nas empresas grandes.
- As contagens retornadas (`estoque_atualizado`) já refletem o novo valor, sem mudanças de assinatura — nenhuma alteração necessária em `automations.server.ts` nem na interface.
