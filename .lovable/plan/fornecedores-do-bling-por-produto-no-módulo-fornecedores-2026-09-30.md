# Fornecedores do Bling por produto (no módulo Fornecedores)

## O que o usuário vai ter
Uma nova aba **"Fornecedores no Bling"** dentro de Fornecedores, no mesmo estilo de Multilojas:

1. **Puxar vínculos do Bling**: botão que busca, para a empresa selecionada, todos os fornecedores ligados a cada produto. A barra de progresso mostra as páginas lidas, e é possível pausar, retomar e cancelar. O trabalho continua mesmo se a pessoa trocar de tela.
2. **Lista de fornecedores encontrados no Bling**: cada fornecedor do Bling (ex.: "HAYAMAX", id 17272125960) aparece com a quantidade de produtos. Ao lado, um seletor liga esse fornecedor a um fornecedor do sistema (Hayamax, Oderço, Evolusom...), igual a ligar loja a marketplace. Com isso, os prefixos do mapa central (HA/HX/HAY → Hayamax etc.) passam a saber qual é o fornecedor dele no Bling.
3. **Lista de produtos** com filtros: todos, com fornecedor ou **sem fornecedor**, além de filtro por fornecedor e busca por SKU/nome. Mostra SKU, nome, fornecedor no Bling, código no fornecedor e preço de custo.
4. **Definir fornecedor em produtos sem fornecedor**:
   - **Pelo prefixo**: um botão "Vincular pelo prefixo" usa o mapa de prefixos com a ligação do passo 2 e cria o vínculo no Bling, com o código do fornecedor igual ao número depois do prefixo (HA73881 → 73881).
   - **Manual**: selecionar produtos e escolher um fornecedor do Bling.
   - Os vínculos vão para a fila de envio ao Bling, com o progresso de sempre, e só são marcados como vinculados aqui quando o Bling confirma.
5. **Regra de auditoria "Produto com fornecedor vinculado"**: volta a ser ativada e passa a usar esses dados. Ela já está criada, mas agora fica desligada para não acusar erro falso.

## Detalhes técnicos
- Tabelas novas no banco externo:
  - `bling_product_suppliers`: company_id, bling_product_id, product_id, bling_link_id, bling_supplier_id, bling_supplier_nome, codigo, preco_custo, padrao e synced_job_id.
  - `bling_supplier_map`: company_id, bling_supplier_id, nome e supplier_codigo, ligado a fornecedores.codigo.
  - `bling_supplier_sync_jobs`: página, status, pausa/cancelamento, contagens e erros.
- As novas tabelas recebem GRANTs e RLS por membro da empresa.
- Worker `/api/public/bling/suppliers-tick`, no mesmo padrão do stores-tick:
  - lê `GET /produtos/fornecedores?pagina=N&limite=100`, com lease, dedup e retomada pela página salva;
  - ao terminar, remove os vínculos que não apareceram mais.
- O nome do fornecedor vem de `GET /contatos/{id}`, com cache por fornecedor.
- Criar vínculo: `POST /produtos/fornecedores` com `{produto:{id}, fornecedor:{id}, codigo, precoCusto, padrao:true}`, por um novo tipo na bling_push_queue (`fornecedor_vinculo`).
- A regra `fornecedor-vinculado` passa a verificar se existe linha em `bling_product_suppliers`, e não mais `fornecedor_id`. Isso vale na auditoria em lote (SQL) e na individual.
- O filtro "sem fornecedor" também entra na tela de Produtos como opção de filtro.

## Validação
- Puxar os vínculos da UNG e comparar a contagem com o teste de hoje: o Bling devolveu todas as páginas nas 3 empresas lidas, com cerca de 100 vínculos por página.
- Ligar HAYAMAX → Hayamax, rodar "Vincular pelo prefixo" em 1 produto sem fornecedor e ler de volta no Bling.
- Rodar a auditoria e conferir se só os produtos realmente sem fornecedor aparecem com erro.
