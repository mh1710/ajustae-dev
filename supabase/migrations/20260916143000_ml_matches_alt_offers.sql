-- Coluna usada pelo mapeamento do Mercado Livre para guardar ofertas alternativas (sem Full)
alter table public.ml_product_matches add column if not exists alt_offers jsonb;
