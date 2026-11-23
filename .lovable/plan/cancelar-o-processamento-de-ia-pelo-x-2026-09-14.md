# Cancelar o processamento de IA pelo X

## Implementação
- Fazer o X do balão cancelar o processamento, em vez de apenas bloquear o fechamento.
- Interromper a requisição de IA que estiver em andamento e impedir o início dos próximos lotes.
- Aplicar o mesmo comportamento às correções de descrição curta, título, garantia e EAN.
- Manter as alterações dos produtos já concluídos antes do cancelamento.
- Mostrar uma confirmação breve de que o processamento foi interrompido e permitir iniciar outro normalmente.

## Validação
- Confirmar que o projeto compila sem erros.
- Verificar na tela que o X fecha o balão e que nenhum lote adicional é iniciado.
