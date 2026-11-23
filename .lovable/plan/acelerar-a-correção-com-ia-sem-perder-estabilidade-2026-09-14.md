# Acelerar a correção com IA sem perder estabilidade

## Implementação
- Trocar a espera fixa de 1,25 segundo por um controlador adaptativo centralizado em cada instância do servidor.
- Começar em 700 ms entre chamadas, mantendo apenas uma chamada simultânea para evitar rajadas.
- Ao receber limite 429, respeitar o tempo informado pela IA, aumentar temporariamente o intervalo e continuar o item automaticamente.
- Reduzir o intervalo aos poucos após respostas bem-sucedidas, recuperando velocidade sem ultrapassar o limite.
- Garantir que uma segunda tentativa de texto curto também passe pelo mesmo controle de velocidade.

## Validação
- Executar os testes relacionados e confirmar que o projeto continua compilando sem erros.
- Verificar que a tela mantém progresso e mensagens de falha existentes.
