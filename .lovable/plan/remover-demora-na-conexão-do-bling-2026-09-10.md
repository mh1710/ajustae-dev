# Remover demora na conexão do Bling

## Alteração
- Remover esperas e novas tentativas automáticas da troca de autorização por token.
- Fazer cada tentativa retornar imediatamente com o resultado recebido do Bling.
- Preservar a renovação automática periódica e os avisos de erro já existentes.

## Validação
- Confirmar que o projeto compila sem erros e que a conexão não mantém esperas internas.
