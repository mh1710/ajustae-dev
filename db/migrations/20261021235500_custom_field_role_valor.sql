BEGIN;
-- Valor escolhido pelo usuário para campos de lista suspensa na atualização automática.
ALTER TABLE public.bling_custom_field_roles ADD COLUMN IF NOT EXISTS valor text;
NOTIFY pgrst, 'reload schema';
COMMIT;
