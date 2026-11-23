# Matriz inicial de cobertura

| Área                | Cobertura unitária disponível                                      | Próximo contrato prioritário                             |
| ------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| CDN e imagens       | canonicalização, payload de mídia, placeholder, fingerprint, lotes | Worker e rotação completos com banco/Bling falsos        |
| Produtos Bling      | diff de payload, fornecedor, escopo de campos                      | confirmar escrita remota antes de marcar envio local     |
| Campos customizados | opções, módulos, papéis, valores automáticos, progresso            | retry de PATCH sem duplicar fila                         |
| Estoque             | histórico por depósito e regras auxiliares                         | falha parcial por depósito e reprocessamento idempotente |
| Fornecedores        | imagens, vínculo, importação e freshness                           | divergência entre contato local e contato do Bling       |
| Mercado Livre       | identidade, EAN, medidas, fotos, frete e aprovação                 | simular limites/erros encadeados sem rede                |
| Auditoria           | lotes e validações de imagem                                       | retomada após lease vencido sem pular produto            |
| Financeiro          | cálculo e período de repasse                                       | arredondamento, moeda e concorrência                     |
| Segurança           | acesso por empresa e bloqueio de rede/segredos                     | varredura de funções server por autorização obrigatória  |
| Filas e automações  | alguns cálculos de progresso                                       | estado persistido versus chamada externa confirmada      |

Esta matriz é incremental. Ela não significa que todas as integrações server-side
já têm mocks completos; identifica exatamente os contratos que ainda precisam ser
extraídos e testados.
