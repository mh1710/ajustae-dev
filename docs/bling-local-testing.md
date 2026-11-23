# Ambiente local de teste do Bling

Este modo permite criar e alterar produtos nas contas Bling autorizadas sem usar
o banco, os tokens ou as filas do portal de produção. As chamadas ao Bling são
reais; portanto, use contas e apps OAuth destinados a testes.

## 1. Prepare um Supabase exclusivo para testes

Crie um projeto Supabase vazio e aplique nele o mesmo esquema/migrations do
portal. Não clone os dados de produção: isso também copiaria tokens e trabalhos
pendentes. Crie no Auth desse projeto um usuário administrador para o teste.

O projeto de teste precisa conter, no mínimo, todas as tabelas, funções e RPCs
usadas pelo portal atual. O fluxo local não modifica nem migra o projeto de
produção.

## 2. Configure o arquivo local

Execute:

```powershell
npm run test:env:setup
```

Preencha `.env.test.local` com:

- `SUPABASE_*` e `VITE_SUPABASE_*`: chaves e identificação do projeto de teste.
- `APP_PUBLIC_URL`: URL HTTPS de um túnel apontando para o servidor local.
- `APP_RETURN_URL`: normalmente `http://localhost:3000`.
- `BLING_REDIRECT_BASE_URL`: a mesma URL HTTPS do túnel.
- `BLING_WORKER_SECRET`: um segredo exclusivo para os workers deste teste.

O callback que deve ser cadastrado nos apps OAuth do Bling é:

```text
https://SEU-TUNEL-HTTPS/api/public/bling/callback
```

As credenciais `Client ID` e `Client Secret` não ficam nesse arquivo. Elas são
cadastradas por empresa na página **Integrações** e armazenadas somente no
Supabase de teste. O modo local ignora o catálogo histórico de apps OAuth e exige
o preenchimento manual dessas credenciais para cada empresa.

O comando de setup e o launcher acrescentam automaticamente ao
`.env.test.local` qualquer chave nova do modelo, sem substituir valores ou
segredos já preenchidos. O arquivo é ignorado pelo Git.

## 3. Copie apenas a lista de empresas

Esta etapa é opcional. Para ter no teste as mesmas empresas cadastradas no
portal, preencha também:

- `SOURCE_SUPABASE_URL`
- `SOURCE_SUPABASE_SERVICE_ROLE_KEY`
- `TEST_ADMIN_EMAIL`

Depois execute:

```powershell
npm run test:companies:sync
```

O comando preserva os IDs e copia somente nome, nome fantasia, CNPJ e status das
empresas. Ele promove o usuário informado a administrador no projeto de teste,
vincula todas as empresas a ele e cria integrações desconectadas. Credenciais,
tokens, produtos, imagens e filas não são copiados.

## 4. Valide e inicie

```powershell
npm run test:env:check
npm run dev:test
```

O launcher interrompe a inicialização se o projeto de teste for igual ao projeto
do `.env` normal, se as chaves do navegador e do servidor divergirem ou se o
túnel não usar HTTPS. O Vite também deixa de carregar o `.env` normal nesse modo.

Entre com o usuário criado no Supabase de teste. Em **Integrações**, selecione
cada empresa, informe o app OAuth correspondente, salve e conecte ao Bling.

## Tokens e escritas

O callback salva `access_token`, `refresh_token` e validade em
`bling_integrations` do projeto de teste. Antes de cada operação, a mesma rotina
usada em produção verifica a validade. Quando necessário, ela renova o token sob
uma trava por empresa e salva imediatamente o access token e o refresh token
rotacionados no banco de teste.

As filas de criação e alteração de produtos, auditorias e workers usam esse mesmo
banco e a URL do túnel. O modo de teste tem escrita habilitada: as alterações
atingem de fato as contas Bling conectadas.

Para voltar ao ambiente normal, encerre o servidor e use `npm run dev`. O arquivo
`.env.test.local` não é carregado por esse comando.
