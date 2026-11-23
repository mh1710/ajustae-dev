-- O classificador oficial sugere uma categoria pelo título sem retornar anúncio.
ALTER TABLE public.product_ml_categories
  ALTER COLUMN ml_product_id DROP NOT NULL,
  ALTER COLUMN ml_product_title DROP NOT NULL;
ALTER TABLE public.product_ml_categories DROP CONSTRAINT IF EXISTS product_ml_categories_match_by_check;
ALTER TABLE public.product_ml_categories ADD CONSTRAINT product_ml_categories_match_by_check
  CHECK (match_by IN ('ean', 'titulo', 'categoria'));