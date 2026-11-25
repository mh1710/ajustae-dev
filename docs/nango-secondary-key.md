# Segunda credencial Nango

O Ajusta-Ê distribui novas conexões por credencial, mas mantém cada conexão na
mesma credencial durante todo o seu ciclo de vida. A chave nunca é gravada no
banco nem enviada ao navegador; somente o slot `1` ou `2` é persistido.

## Configuração

1. Crie ou selecione o segundo ambiente/projeto no Nango.
2. Nesse ambiente, configure a integração Gmail com permissão somente de
   leitura e anote o Integration ID.
3. Crie uma Secret Key restrita às operações usadas pelo Ajusta-Ê: sessões de
   conexão, listagem/remoção de conexões e proxy.
4. No `.env` local ou nos secrets do deploy, configure:

```dotenv
NANGO_API_KEY_SECONDARY=secret_key_do_segundo_ambiente
NANGO_SECONDARY_GMAIL_INTEGRATION_ID=google-mail
NANGO_SECONDARY_OUTLOOK_INTEGRATION_ID=
NANGO_CONNECTIONS_PER_KEY=10
```

5. Aplique a migration `20261124100000_nango_credential_pool.sql` antes de
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
