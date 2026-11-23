# Relatório de avaliação do merge Ajusta-Ê

Data: 2026-11-16

## Fontes comparadas

- Projeto antigo com trabalho local: `C:\Users\Matheus\Documents\blingauditor-039d62d5`
- Base antiga: commit `6e3fcb3`
- Projeto novo remoto: `origin/main`, commit `9357a93`
- Diferença da base antiga até a nova: 488 commits
- Pasta limpa da versão nova: `ajustae-novo`
- Pasta candidata ao merge: `ajustae-merge-avaliacao`
- Branch local da avaliação: `merge/avaliacao-antigo-novo`

Foi executado `fetch` e foram criados clones limpos. Nenhum commit foi criado e
nenhum código foi enviado ao GitHub.

## Mudanças incorporadas na candidata

### 1. Conector de códigos por e-mail/Nylas

Incluído com OAuth, webhook assinado, fila de processamento, allowlist de
remetentes, criptografia AES-GCM, validade curta dos códigos, tela de consulta e
auditoria de revelações. A implementação foi conferida com a documentação atual
da Nylas para Hosted Authentication e HMAC-SHA256 do corpo bruto.

Antes de produção ainda é necessário:

- aplicar a migration `20261112090000_email_connector_nylas.sql`;
- configurar os secrets listados em `docs/email-connector-nylas.md`;
- cadastrar callback e webhook no painel Nylas;
- manter a entrega comprimida do webhook desativada;
- fazer um teste integrado com uma caixa real e um evento `message.created`.

### 2. Ambiente local isolado de testes do Bling

Incluído o launcher `dev:test`, validações contra reutilização do Supabase de
produção, arquivo-modelo sem segredos, sincronização opcional somente dos
cadastros de empresas e aviso visual na tela de integrações.

### 3. Importação de planilhas de fornecedores

Incorporadas somente as partes ainda válidas:

- seleção obrigatória do prefixo de SKU;
- persistência do prefixo no lote;
- validação de consistência entre as partes do lote;
- espera pela conclusão real da propagação de imagens;
- envio à fila de criação somente dos produtos novos.

A seleção manual do ID do fornecedor no Bling não foi portada. A versão nova já
resolve e confirma o fornecedor de destino automaticamente pelo prefixo real e
pelos contatos da empresa, solução mais segura que reutilizar IDs selecionados
manualmente.

### 4. CDN/imagens

Incluída a preparação paginada dos itens do job para evitar timeout ao montar
grandes execuções. Também foi mantida a verificação de que uma integração
encontrada por ID pertence à mesma empresa do item antes de usar ou criar sua
assinatura CDN.

### 5. Lockfile

O `package-lock.json` da versão nova já não correspondia ao `package.json` e
impedia `npm ci`. Ele foi sincronizado por `npm install`. Essa é uma correção de
consistência da base nova, não uma função trazida do projeto antigo.

## Mudanças antigas deliberadamente não incorporadas

### Vínculo manual de fornecedor após criação

As RPCs `enqueue_supplier_import_bling_push`,
`enqueue_supplier_link_after_create` e `preflight_supplier_links` foram
excluídas. A versão nova possui `resolve_import_product_supplier`, seleção por
contato/prefixo, confirmação após gravação e retry idempotente.

### Auditoria síncrona da importação

Não foi portada. Ela chamava `run_audit_sql` e regras extras diretamente na
requisição da interface. A versão nova passou a finalizar auditorias por workers
e cron, com leases e limites próprios. Reintroduzir a versão antiga criaria risco
de timeout e concorrência.

Ponto ainda aberto: caso seja requisito bloquear toda criação no Bling até uma
auditoria completa, deve ser criado um fluxo novo, assíncrono, que aguarde o run
moderno e ignore apenas a regra de vínculo que depende do ID devolvido pelo
Bling.

### Normalização de situação para “Ativo/Inativo”

Não foi portada. A versão nova ainda usa códigos `A/I` em partes do fluxo e já
aceita variações textuais nas leituras. Alterar agora o valor canônico poderia
quebrar filtros e payloads sem uma migration de dados e testes específicos.

### Automações operacionais avulsas e saídas

Os scripts de exportação/envio em `automacoes/`, relatórios, CSV/XLSX gerados,
journals de auditoria e arquivos de credenciais não entraram na candidata. Eles
usam service role e tokens OAuth e parte de suas funções já existe no portal
novo. Permanecem preservados na pasta antiga para uma revisão operacional
separada.

### `.env` e outros segredos

Não foram copiados. A candidata contém somente modelos sem valores reais.

## Validação executada

- Build de produção: passou.
- Instalação reproduzível (`npm ci --dry-run --ignore-scripts`): passou.
- Parser de códigos de e-mail: 4 testes, 4 passaram.
- Teste de URL CDN: passou.
- Geração da árvore de rotas: incluiu a tela e os três endpoints de e-mail.
- `git diff --check`: passou sem erros de whitespace.
- Prettier dos arquivos novos com parser suportado: passou. Arquivos SQL e
  `.env` não possuem parser configurado neste projeto e foram conferidos pelo
  `git diff --check`.
- Teste de importação por planilha: não executado por exigir o caminho de uma
  planilha real.
- Lint global: bloqueado por 57 mil violações preexistentes de CRLF/Prettier no
  checkout Windows.
- Lint focado sem a regra de quebra de linha: módulos novos passaram; os 34
  erros restantes são usos antigos de `any` nos arquivos-base já existentes.

## Riscos e decisões antes de considerar final

1. Decidir se a importação deve obrigatoriamente aguardar uma auditoria
   assíncrona moderna antes de criar produtos no Bling.
2. Testar o OAuth e webhook Nylas no ambiente de desenvolvimento com secrets
   reais e validar um código recebido de ponta a ponta.
3. Aplicar e testar as três migrations novas em um Supabase de teste.
4. Executar a importação com uma planilha real de cada fornecedor que possui
   mais de um prefixo.
5. Revisar as 18 vulnerabilidades relatadas por `npm audit`: 2 críticas, 7
   altas, 8 moderadas e 1 baixa. `xlsx` não oferece correção automática; `zod`
   exige mudança major para a correção sugerida.
6. Definir uma política única de fim de linha para eliminar o ruído de lint no
   Windows.

## Recomendação

Usar esta pasta como candidata técnica, não como versão final. O próximo passo
seguro é validar banco, Nylas e uma planilha real no ambiente isolado; depois,
se aprovado, criar um commit local revisável e somente então decidir o push.
