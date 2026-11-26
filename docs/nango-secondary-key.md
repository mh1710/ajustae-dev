# Segunda credencial Nango

O Ajusta-Ê distribui novas conexões por credencial, mas mantém cada conexão na
mesma credencial durante todo o seu ciclo de vida. A chave nunca é gravada no
banco nem enviada ao navegador; somente o slot `1` ou `2` é persistido.

## Configuração

1. Crie ou selecione o segundo ambiente/projeto no Nango.
2. Crie uma Secret Key restrita às operações usadas pelo Ajusta-Ê: sessões de
   conexão, listagem/remoção de conexões e proxy.
   Para o preparo automatizado, ela também precisa temporariamente dos escopos
   `environment:integrations:list` e `environment:integrations:create`.
3. No `.env.local` local ou nos secrets do deploy, configure:

```dotenv
NANGO_API_KEY_SECONDARY=secret_key_do_segundo_ambiente
NANGO_SECONDARY_GMAIL_INTEGRATION_ID=google-mail
NANGO_SECONDARY_OUTLOOK_INTEGRATION_ID=
NANGO_CONNECTIONS_PER_KEY=10
```

4. Prepare e valide a integração Gmail com o aplicativo OAuth gerenciado pelo
   Nango:

```bash
npm run nango:secondary:prepare -- --create
```

O comando é idempotente: se a integração já existir, apenas a valida. Ele não
exibe a Secret Key. Depois da criação, o escopo
`environment:integrations:create` pode ser removido da chave.

5. Aplique a migration `20261125094233_nango_credential_pool.sql` antes de
   habilitar a segunda chave.
6. Reinicie o servidor e abra **Códigos de e-mail**. Enquanto o slot 1 tiver
   menos conexões ativas que o limite, ele será usado; depois, novas conexões
   serão criadas no slot 2.

## Verificação segura

- Conecte contas fictícias ou de teste até atingir o limite configurado.
- Confirme no banco que `provider_credential_slot` muda de `1` para `2`.
- Execute a sincronização manual de uma conexão de cada slot.
- Revogue uma conexão de cada slot e confirme no painel correspondente do
  Nango.

Não troque o slot de uma conexão existente manualmente. O token OAuth está no
ambiente Nango que originou a conexão.

O Ajusta-Ê solicita o escopo Gmail somente leitura
`https://www.googleapis.com/auth/gmail.readonly` no momento em que cria a
sessão de conexão. A conta Google ainda precisa ser conectada pelo próprio
usuário na tela do portal; senha e consentimento OAuth não são automatizados.
