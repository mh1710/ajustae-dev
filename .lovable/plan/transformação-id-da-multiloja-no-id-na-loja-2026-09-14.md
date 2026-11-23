# Transformação “ID da multiloja no ID na loja”

## Objetivo
Adicionar uma transformação em massa que, para cada produto escolhido, copie o ID de cada multiloja vinculada para o campo **ID na loja** do anúncio correspondente.

## Comportamento
- Disponibilizar a nova opção na área **Produtos → Transformações**.
- Respeitar os escopos atuais: todos os produtos, selecionados ou alterados.
- Aplicar a mudança em **todas as multilojas vinculadas** de cada produto.
- Ignorar vínculos incompletos ou sem o identificador necessário e informar quantos foram enviados e ignorados.
- Enfileirar os ajustes para o Bling, preservando a trava contra sincronizações simultâneas, as tentativas automáticas, os logs e o progresso já existentes.
- Após confirmação do Bling, atualizar a cópia local do campo para manter a tela de Multilojas consistente.

## Detalhes técnicos
- Criar uma função segura no banco externo que localize os vínculos pelo produto/empresa e monte uma entrada de fila por vínculo, com o código desejado igual ao `bling_store_id`.
- Adicionar um tipo específico à fila para atualizar o anúncio existente por `bling_product_store_id`, sem recriar ou desvincular a multiloja.
- Enviar ao Bling um `PUT /produtos/lojas/{id}` mantendo produto, loja e preços atuais, alterando somente o campo `codigo` (“ID na loja”).
- Expor a operação por uma função autenticada, validando acesso à empresa e bloqueando execução concorrente.
- Conectar a nova operação ao seletor de transformações e apresentar a quantidade de vínculos enfileirados.

## Validação
- Aplicar a alteração estrutural no Supabase externo já conectado, sem ativar Lovable Cloud.
- Validar compilação e tipos.
- Testar que produtos com múltiplas lojas geram um envio independente para cada vínculo e que o código local é atualizado somente após sucesso.
