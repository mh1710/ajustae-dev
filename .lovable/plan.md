## Objetivo

1. Substituir o card "Atualizar preço e estoque via fornecedor" por uma transformação chamada **"Atualizar preço e estoque"** que, além de puxar do fornecedor, calcula o preço de venda pela Política de Precificação (usando as taxas do marketplace padrão de Multilojas) e permite escolher se as multilojas também recebem os novos valores.
2. Na sincronização com o Bling, incluir a escolha entre **"Somente Bling (produto pai)"** ou **"Bling + Multilojas vinculadas"**.

## Escopo funcional

### Transformação "Atualizar preço e estoque" (em Produtos → Transformações)

Toggle no próprio card:
- **Somente Bling** (padrão) — grava apenas nas colunas do produto pai (`bling_products`).
- **Bling + Multilojas** — grava também em cada linha de `bling_product_stores` vinculada ao produto.

Para cada produto no escopo:
- Busca o fornecedor pelo prefixo do SKU (regra já existente).
- Atualiza `preco_custo` e `preco_compra` (mesmo valor) com o preço de custo do fornecedor.
- Atualiza `estoque` com o estoque do fornecedor.
- Calcula `preco` (venda) via `pickPricingBand` usando:
  - `computeCostBreakdown` com as taxas do fornecedor + `pricing_settings` da empresa;
  - a comissão do marketplace marcado como **padrão** em Multilojas (`bling_stores.is_default = true`);
  - a `taxa_promocao` e `devolucao` do fornecedor.
- Se o marketplace padrão não estiver configurado, o card mostra alerta e não altera `preco`, mas ainda atualiza custo e estoque.
- Se "Bling + Multilojas" estiver marcado, para cada loja vinculada replica custo/estoque e recalcula o `preco` da loja com a comissão daquele marketplace específico.

Relatório final continua listando por SKU: custo antigo/novo, estoque antigo/novo, preço antigo/novo e, quando aplicável, uma linha por loja atualizada.

### Sincronização com o Bling (card `BlingPushCard`)

Adicionar um segundo seletor "Destino":
- **Somente Bling** — comportamento atual (envia produto pai via `/produtos`).
- **Bling + Multilojas** — após enfileirar o produto pai, enfileira também um item por loja vinculada para enviar preço/estoque específicos daquela loja usando o endpoint `PUT /produtos/{id}/lojas/{idLoja}` do Bling.

O escopo (preço / estoque / ambos / criar) permanece independente do destino.

## Detalhes técnicos

**Migração (Supabase):**
- Nova função SQL `transform_update_price_stock(_company_id, _product_ids, _include_stores boolean)` que faz o cálculo em lote lendo `fornecedores`, `pricing_settings`, `bling_stores` (marketplace padrão + vinculados) e `marketplaces`, retornando o mesmo shape do relatório atual acrescido de `preco_novo` e `stores_updated`. A regra de faixas é replicada em SQL para evitar loop de N produtos no Node.
- Ampliar `enqueue_bling_push(_company_id, _product_ids, _scope, _include_stores boolean default false)` para inserir itens extras em `bling_push_queue` marcados com `store_id` (nova coluna nullable) por loja vinculada.
- Adicionar coluna `store_id uuid` (nullable, FK `bling_stores.id`) em `bling_push_queue` + índice.

**Server functions (`src/lib/`):**
- `products-tools.functions.ts`: substituir `transformSyncSupplierStockPrice` por `transformUpdatePriceStock({ company_id, product_ids?, include_stores })`.
- `bling-push.functions.ts`: aceitar `include_stores: boolean` em `enqueueBlingPush` e repassar ao RPC.

**Worker (`src/lib/bling-push.server.ts`):**
- Quando o item da fila tem `store_id`, chamar `PUT /produtos/{id}/lojas/{idLoja}` com o corpo específico daquela loja (preço + estoque do depósito vinculado). Sem `store_id`, mantém o fluxo atual.

**Frontend:**
- `src/routes/_authenticated/produtos.tsx`: reescrever o card (novo título, descrição e `RadioGroup`/`Switch` Bling vs Bling+Multilojas). Ajustar o relatório para mostrar linhas por loja.
- `src/components/bling-push-card.tsx`: adicionar `RadioGroup` "Destino" (Somente Bling / Bling + Multilojas) e enviar `include_stores` ao enfileirar.

## Fora de escopo

- Não altera a lógica de auditoria, marketplaces, fornecedores nem a estrutura da Política de Precificação — apenas consome o que já existe.
- Não mexe em regras de validação.

Confirma que posso executar assim?
