# Reenvio opcional na atualização de ID por marketplace

## Objetivo
Aplicar à transformação “Atualizar ID na loja” a mesma escolha já disponível na importação por planilha.

## Alterações
- Manter na prévia a separação entre vínculos que precisam mudar e vínculos já corretos.
- Quando existirem vínculos já corretos, permitir escolher entre atualizar somente os divergentes ou reenviar todos.
- Fazer a confirmação e a quantidade do botão acompanharem a opção selecionada.
- Enfileirar vínculos já corretos apenas quando “reenviar todos” estiver selecionado.
- Preservar as validações atuais, o bloqueio durante sincronizações e a confirmação posterior no Bling.

## Validação
- Conferir a prévia e o texto do botão nos dois modos.
- Confirmar que “somente divergentes” mantém o comportamento atual.
- Confirmar que “reenviar todos” inclui os já corretos sem incluir vínculos ignorados.
- Verificar compilação e diálogo no navegador.
