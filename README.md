# Ajusta-Ê

Crie um sistema SaaS chamado “Meu Bling Correto”.

Use o backend interno do Lovable, incluindo banco de dados PostgreSQL,

autenticação, funções de backend e armazenamento seguro de secrets.

Neste primeiro momento, implemente somente a fundação do sistema.

Não implemente ainda auditoria de produtos, fornecedores, precificação

ou sincronização completa.

O sistema deve ter:

1. Autenticação

- Cadastro com nome, e-mail e senha.

- Login.

- Recuperação de senha.

- Logout.

- Rotas privadas para usuários autenticados.

2. Estrutura multiempresa

Cada usuário poderá criar uma ou mais empresas.

Criar as entidades:

profiles:

- id relacionado ao usuário autenticado

- nome

- email

- telefone

- created_at

- updated_at

companies:

- id

- owner_user_id

- nome

- nome_fantasia

- cnpj

- status

- created_at

- updated_at

company_users:

- id

- company_id

- user_id

- role

- ativo

- created_at

Ao criar uma empresa, o usuário deve ser automaticamente vinculado

como administrador em company_users.

3. Integração com o Bling

Criar uma página chamada “Integrações”.

Nela deve existir um card “Bling” com:

- status da conexão;

- empresa selecionada;

- botão “Conectar ao Bling”;

- botão “Testar conexão”;

- botão “Desconectar”;

- data da última sincronização;

- mensagem do último erro, quando houver.

Criar a entidade bling_integrations:

- id

- company_id

- status

- nome_conexao

- access_token

- refresh_token

- token_expires_at

- scopes

- bling_account_id

- last_sync_at

- last_error

- created_at

- updated_at

Os campos access_token e refresh_token nunca podem ser retornados

diretamente ao frontend nem exibidos na interface.

4. Segurança

Ativar políticas de acesso para garantir que um usuário somente consiga

acessar empresas às quais esteja vinculado em company_users.

As funções responsáveis pela comunicação com o Bling devem executar

no backend.

Nunca colocar Client Secret, access token, refresh token ou chaves

administrativas no frontend, localStorage, console ou código público.

5. Funções de backend

Criar inicialmente estas funções:

bling-auth-start:

- recebe company_id;

- valida o usuário autenticado;

- confirma que ele possui acesso à empresa;

- cria um state aleatório e seguro;

- salva esse state temporariamente associado à empresa e ao usuário;

- monta a URL OAuth do Bling;

- retorna a URL ao frontend.

bling-auth-callback:

- recebe code e state enviados pelo Bling;

- valida o state;

- troca o authorization code pelos tokens do Bling;

- salva access_token, refresh_token e validade;

- marca a integração como conectada;

- redireciona o usuário de volta para a página de integrações.

bling-test-connection:

- obtém os tokens no backend;

- renova o token quando estiver próximo de expirar;

- faz uma requisição GET para:

  https://api.bling.com.br/Api/v3/produtos?pagina=1&limite=1

- atualiza o status e o último erro;

- retorna ao frontend apenas sucesso ou uma mensagem segura de erro.

bling-disconnect:

- valida o usuário e a empresa;

- remove os tokens salvos;

- altera o status para desconectada.

6. Interface

Criar as páginas:

- Login

- Cadastro

- Recuperar senha

- Dashboard

- Empresas

- Integrações

- Configurações

O Dashboard inicial pode mostrar:

- quantidade de empresas;

- status da integração Bling;

- última sincronização;

- um aviso de que os módulos de produtos e auditoria serão adicionados depois.

Use uma interface moderna, limpa e profissional para um SaaS empresarial.

Não crie dados simulados permanentes.

Não exponha nenhum secret.

Não implemente produtos ainda.

Ao final, informe:

- quais tabelas foram criadas;

- quais funções foram criadas;

- quais secrets preciso cadastrar;

- qual é a URL exata de callback que devo cadastrar no Bling.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://blingauditor.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/54b7aaba-9679-4c79-bddc-65d5f5617b5a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## CDN de imagens R2

Antes de iniciar o portal, configure no `.env` do servidor:

```env
CDN_BASE_URL=https://cdn.seudominio.com
R2_BUCKET_NAME=ajustae
CLOUDFLARE_WORKER_ADMIN_TOKEN=use-o-mesmo-segredo-configurado-no-worker
APP_PUBLIC_URL=https://portal.seudominio.com
BLING_WORKER_SECRET=segredo-interno-dos-workers-do-portal
```

O portal lista objetos e controla assinaturas pela API administrativa do próprio Worker, usando diretamente os bindings do R2 e do KV. Configure o segredo no Cloudflare:

```powershell
cd cloudflare
npx wrangler secret put ADMIN_API_TOKEN
```

Use exatamente o mesmo valor em `CLOUDFLARE_WORKER_ADMIN_TOKEN` no ambiente do portal. Não grave esse segredo no `wrangler.toml`.

Para publicar o Worker:

```powershell
cd cloudflare
npx wrangler deploy --config .\wrangler.toml
```

O domínio `CDN_BASE_URL` deve estar configurado como Custom Domain do Worker. O bucket R2 deve conter os arquivos com o mesmo nome usado nas URLs, por exemplo `CAS145145_1.jpg`.

Ao importar produtos por planilha, o portal converte as URLs das imagens para:

```text
https://cdn.seudominio.com/{assinatura}/ajustae/{arquivo}
```

A propagação v2 primeiro inventaria todas as chaves do R2 e depois cria uma fila persistente por produto. A assinatura é escolhida pela `integration_id` do produto. O portal mostra o progresso e o motivo individual de cada resultado: atualizado, sem imagem, já no CDN, sem integração ou erro.

e então envia os produtos para a fila do Bling. A assinatura anterior é revogada quando uma nova assinatura é gerada.

Teste local da montagem da URL:

```powershell
npm run test:cdn-url
```
