# Conector de e-mail (Nylas)

O Ajusta-Ê usa a Nylas apenas como camada unificada de conexão com Gmail,
Outlook e provedores IMAP. A senha da caixa postal nunca passa pelo sistema.

## Variáveis do servidor

```env
NYLAS_CLIENT_ID=
NYLAS_API_KEY=
NYLAS_API_URI=https://api.us.nylas.com
NYLAS_REDIRECT_URI=https://dev-ajustae.agenciasimplifya.com.br/api/public/email/callback
NYLAS_WEBHOOK_SECRET=
EMAIL_CODE_ENCRYPTION_KEY=
EMAIL_WORKER_SECRET=
WEBCONTINENTAL_ALLOWED_SENDERS=webcontinental.com.br
EMAIL_CODE_TTL_MINUTES=15
APP_RETURN_URL=https://dev-ajustae.agenciasimplifya.com.br
APP_PUBLIC_URL=https://dev-ajustae.agenciasimplifya.com.br
```

`EMAIL_CODE_ENCRYPTION_KEY` deve ser uma chave aleatória de 32 bytes codificada
em Base64. Gere uma vez e guarde somente no cofre de secrets do ambiente:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

`EMAIL_WORKER_SECRET` também deve ser aleatório. Se não for definido, o backend
reutiliza `BLING_WORKER_SECRET`, mas um segredo separado é recomendado.

## Configuração na Nylas

1. Crie uma aplicação no painel da Nylas.
2. Cadastre exatamente a URL de `NYLAS_REDIRECT_URI` em Hosted Authentication.
3. Crie um webhook apontando para `https://dev-ajustae.agenciasimplifya.com.br/api/public/email/webhook`.
4. Selecione os eventos `message.created`, `grant.expired` e `grant.deleted`.
5. Copie o webhook secret gerado para `NYLAS_WEBHOOK_SECRET`.
6. Configure os conectores Google e Microsoft no painel da Nylas.

Mantenha a entrega comprimida do webhook desativada. O endpoint valida a
assinatura sobre o corpo JSON bruto e não habilita descompressão gzip.

## Ambiente de desenvolvimento

O ambiente recomendado para os testes integrados é:

```text
https://dev-ajustae.agenciasimplifya.com.br
```

Ele já oferece HTTPS público e pode receber o callback OAuth, os webhooks da
Nylas e as chamadas da fila do banco sem túnel. Use estas URLs no painel da
Nylas:

```text
Callback: https://dev-ajustae.agenciasimplifya.com.br/api/public/email/callback
Webhook:  https://dev-ajustae.agenciasimplifya.com.br/api/public/email/webhook
```

## Teste somente local

O servidor de desenvolvimento deste projeto usa `http://localhost:3000`. Para
testar somente a conexão OAuth e a sincronização manual, use:

```env
NYLAS_REDIRECT_URI=http://localhost:3000/api/public/email/callback
APP_RETURN_URL=http://localhost:3000
APP_PUBLIC_URL=http://localhost:3000
```

Cadastre a mesma URL de callback no painel da Nylas, em **Hosted
Authentication > Callback URIs**. A URL deve coincidir exatamente, incluindo
`http`, porta `3000` e caminho.

Para testar também o recebimento automático de mensagens sem usar o ambiente de
desenvolvimento, exponha a porta 3000 com um túnel HTTPS temporário. Nesse modo,
mantenha o callback e o retorno locais, mas use o túnel em `APP_PUBLIC_URL`:

```env
NYLAS_REDIRECT_URI=http://localhost:3000/api/public/email/callback
APP_RETURN_URL=http://localhost:3000
APP_PUBLIC_URL=https://SEU_TUNEL_TEMPORARIO
```

O webhook cadastrado na Nylas deve ser:

```text
https://SEU_TUNEL_TEMPORARIO/api/public/email/webhook
```

`localhost` não pode ser usado como webhook, pois a Nylas e a fila do banco
precisam iniciar requisições para o servidor. Se a URL temporária do túnel
mudar, atualize tanto `APP_PUBLIC_URL` quanto o webhook cadastrado na Nylas.

## Segurança e dados

- O banco persiste somente o grant da Nylas e metadados da conexão; não armazena
  senha do e-mail.
- O corpo da mensagem nunca é persistido.
- Apenas mensagens de remetentes presentes em `WEBCONTINENTAL_ALLOWED_SENDERS`
  são processadas.
- O código é criptografado com AES-256-GCM, mascarado por padrão e apagado do
  cofre após ser marcado como utilizado.
- O titular vê somente os próprios códigos. O papel global `admin` vê todos e
  cada revelação fica registrada em `email_code_access_audit`.
- O webhook valida `X-Nylas-Signature` com HMAC-SHA256 antes de aceitar eventos.

## Tabelas

- `email_connections`
- `email_oauth_states`
- `email_verification_codes`
- `email_code_access_audit`
- `email_webhook_events`
