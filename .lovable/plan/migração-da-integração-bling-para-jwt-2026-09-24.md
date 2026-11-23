# Migração da integração Bling para JWT

## Objetivo
Adaptar a autenticação das 11 empresas ao novo formato JWT do Bling sem interromper sincronizações nem provocar excesso de renovações.

## Alterações
- Usar os endereços oficiais atuais do Bling para autorização e emissão de tokens.
- Enviar `enable-jwt: 1` ao conectar uma empresa, renovar tokens e validar credenciais.
- Manter o cabeçalho também nas chamadas normais à API, conforme recomendação oficial.
- Preservar o fluxo atual de renovação preventiva: cada empresa receberá JWT na próxima renovação, evitando renovar todas simultaneamente e causar bloqueio por excesso de chamadas.
- Confirmar que erros 401 continuam acionando uma única renovação e que reconexões continuam funcionando.

## Validação
- Verificar compilação e estado do projeto.
- Conferir que todas as rotas de token e todas as chamadas à API usam o novo cabeçalho.
- Validar que nenhum token ou credencial aparece em registros ou respostas.

## Impacto esperado
Nenhuma mudança na tela ou no uso diário. As conexões atuais continuam válidas e migram automaticamente para JWT em até aproximadamente cinco horas, conforme seus ciclos de renovação.
