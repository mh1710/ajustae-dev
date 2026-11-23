
ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS preco_embalagem numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preco_transporte numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxa_devolucao numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxa_promocao numeric(6,2) NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS comissao_faixa_0_9 numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comissao_faixa_10_39 numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comissao_faixa_40_79 numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comissao_faixa_80_299 numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comissao_faixa_300_799 numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comissao_faixa_800_plus numeric(6,2) NOT NULL DEFAULT 0;
