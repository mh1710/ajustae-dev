BEGIN;
ALTER TABLE public.dre_repasses
  ADD COLUMN quantidade integer NOT NULL DEFAULT 1 CHECK (quantidade >= 1),
  DROP COLUMN divisao,
  DROP COLUMN resultado,
  ADD COLUMN resultado numeric(14,2) GENERATED ALWAYS AS (repasse-custo_produto*quantidade-custo_etiqueta-custo_boy-custo_embalagem) STORED,
  ADD COLUMN divisao numeric(14,2) GENERATED ALWAYS AS (round((repasse-custo_produto*quantidade-custo_etiqueta-custo_boy-custo_embalagem)/2,2)) STORED;
COMMIT;
