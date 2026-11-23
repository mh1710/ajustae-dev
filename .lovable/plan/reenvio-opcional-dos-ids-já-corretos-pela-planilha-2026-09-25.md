# Reenvio opcional dos IDs já corretos pela planilha

## Objetivo
Permitir que a importação por planilha também reenvie ao Bling linhas cujo ID na loja já aparece como correto no banco.

## Alterações
- Manter na prévia a separação entre IDs novos e IDs já corretos.
- Quando houver linhas já corretas, mostrar duas opções antes da confirmação: atualizar somente os novos ou atualizar todos.
- Enfileirar os itens já corretos somente quando “atualizar todos” for escolhido.
- Continuar ignorando linhas inválidas, sem produto, sem vínculo, sem ID do Bling ou sem preço.
- Manter a confirmação no Bling antes de considerar o envio concluído.

## Validação
- Conferir as quantidades e o texto do botão nas duas opções.
- Confirmar que “somente novos” preserva o comportamento atual.
- Confirmar que “todos” inclui também os classificados como já corretos.
- Verificar a compilação e o diálogo no navegador.
