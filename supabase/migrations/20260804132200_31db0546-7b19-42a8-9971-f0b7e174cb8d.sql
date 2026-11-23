ALTER TABLE public.ml_product_matches
  ADD COLUMN IF NOT EXISTS best_item_id text,
  ADD COLUMN IF NOT EXISTS best_price numeric,
  ADD COLUMN IF NOT EXISTS best_shipping_cost numeric,
  ADD COLUMN IF NOT EXISTS best_total_price numeric,
  ADD COLUMN IF NOT EXISTS best_is_full boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS available_quantity integer,
  ADD COLUMN IF NOT EXISTS has_stock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS zip_code text;

ALTER TABLE public.ml_map_jobs
  ADD COLUMN IF NOT EXISTS zip_code text NOT NULL DEFAULT '87000000';