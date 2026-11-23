# Transformações de IA em segundo plano

## Implementação
- Criar uma fila persistente no banco para as transformações de IA, com uma execução por empresa, itens deduplicados e estados de progresso, erro, pausa e cancelamento.
- Trocar os quatro fluxos atuais de IA — encurtar títulos, remover garantia/Anatel, expandir descrições e buscar EAN — para apenas criar a tarefa e liberar a tela imediatamente.
- Criar um worker público protegido que processe lotes pequenos, renove a trava antes de cada lote, registre cada produto concluído e só agende a próxima rodada quando ainda houver trabalho.
- Interromper a fila inteira em falta de créditos ou bloqueio da IA; em limite temporário, respeitar o tempo indicado e retomar na rodada seguinte sem perder progresso.
- Reduzir o intervalo inicial entre chamadas de 700 ms para 350 ms e acelerar a recuperação após respostas bem-sucedidas, mantendo uma chamada simultânea por execução e aumentando a pausa automaticamente se a IA limitar.
- Substituir o modal que prende a página por um botão flutuante à direita, visível em todas as telas autenticadas, com animação enquanto trabalha, progresso, atualizados, erros, último SKU e ação de cancelar.
- Manter o andamento ao trocar de página, fechar a janela ou retornar depois, consultando o estado salvo no banco.

## Detalhes técnicos
- A fila terá limite fixo por rodada, lease de execução com expiração, chave única por tarefa/produto e atualização idempotente por item.
- O worker terá orçamento de tempo por chamada e reencadeamento com pequeno intervalo, evitando uma requisição longa e evitando execuções duplicadas.
- O cancelamento será persistente: novas rodadas param de ser agendadas e a rodada ativa verifica o estado entre produtos.

## Validação
- Testar criação, progresso, navegação entre telas, cancelamento e conclusão de uma transformação pequena.
- Confirmar que dois disparos não duplicam produtos e que uma execução interrompida retoma do último item pendente.
- Verificar a tela em computador e celular, os registros de execução e a compilação do projeto.
