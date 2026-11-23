-- Exclusões de produtos atualizam supplier_import_rows.match_product_id (FK); sem índice estouravam o tempo limite.
CREATE INDEX IF NOT EXISTS supplier_import_rows_match_product_id_idx ON public.supplier_import_rows(match_product_id);
