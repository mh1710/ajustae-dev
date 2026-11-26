-- Remove assinaturas antigas que não marcam o produto para reenvio ao Bling.
-- As versões atuais aceitam _product_ids opcional, portanto também cobrem o
-- uso por empresa inteira sem deixar uma RPC ambígua no PostgREST.

DROP FUNCTION IF EXISTS public.transform_strip_html(uuid);
DROP FUNCTION IF EXISTS public.transform_fill_desc_complementar(uuid);
DROP FUNCTION IF EXISTS public.transform_remove_garantia_anatel(uuid);

NOTIFY pgrst, 'reload schema';
