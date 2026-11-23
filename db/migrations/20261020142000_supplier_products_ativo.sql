-- Catálogo de fornecedor: produtos que saíram da fonte não devem aparecer nas listas.
-- Mantemos a linha (dados preservados) e apenas marcamos ativo = false.
alter table fornecedor_produtos add column if not exists ativo boolean not null default true;

-- Início da leitura em andamento: ao concluir uma leitura completa, produtos
-- não atualizados nela (updated_at anterior) são desativados.
alter table fornecedores add column if not exists sync_started_at timestamptz;
