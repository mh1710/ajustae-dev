# Atualização automática do ID na loja por marketplace

## Objetivo
Adicionar em **Produtos → Transformações** a opção **Atualizar ID na loja**, sem planilha, com escolha explícita entre:

- **Kabum:** usar o SKU do produto como ID na loja.
- **Web Continental:** usar o ID da própria loja como ID na loja em todos os produtos vinculados àquela loja.

## Fluxo na tela
1. Escolher **Atualizar ID na loja**.
2. Escolher **Kabum** ou **Web Continental**.
3. Respeitar o escopo já selecionado: todos os produtos, somente os selecionados ou somente os alterados.
4. Mostrar uma prévia com quantidade de vínculos que serão atualizados, já corretos e ignorados por falta de dados.
5. Pedir confirmação antes de iniciar.
6. Enfileirar as atualizações e mostrar o progresso e eventuais erros no painel de sincronização existente.

## Segurança dos dados
- Alterar somente o campo **ID na loja**; preço, estoque e demais dados permanecem iguais.
- Localizar as lojas pelo marketplace, sem depender de um único número de loja. Hoje o banco contém uma KABUM e quatro lojas Web Continental.
- Não tocar em nenhum outro marketplace.
- Usar o ID interno do vínculo apenas para localizar o anúncio no Bling.
- Após cada envio, reler o vínculo no Bling e só atualizar o Ajustta-Ê quando o valor confirmado for exatamente o esperado.
- Se houver divergência ou erro, manter o item na lista de erros para reprocessamento, sem registrar sucesso falso.

## Detalhes técnicos
- Criar uma operação específica para atualização por marketplace, separada da planilha e da antiga operação genérica bloqueada.
- Aceitar somente os valores `kabum` e `web_continental` no servidor e no banco.
- Para Kabum, calcular o código esperado pelo SKU do produto; para Web Continental, pelo `bling_store_id` de cada vínculo.
- Enfileirar apenas vínculos cujo valor atual seja diferente do esperado e que tenham os identificadores e preço necessários.
- Reutilizar o envio protegido e a confirmação pós-envio já validada no fluxo da planilha.

## Validação
- Testar uma amostra Kabum e confirmar que o ID na loja fica igual ao SKU.
- Testar uma amostra de cada loja Web Continental e confirmar que o ID na loja fica igual ao ID daquela loja.
- Confirmar que outro marketplace não recebe atualização.
- Validar prévia, confirmação, progresso, erros e reprocessamento.
- Aplicar a migração no Supabase externo e verificar compilação e funcionamento na tela.
