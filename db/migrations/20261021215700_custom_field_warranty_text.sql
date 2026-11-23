BEGIN;
ALTER TABLE public.bling_custom_field_roles
  DROP CONSTRAINT bling_custom_field_roles_role_check;
ALTER TABLE public.bling_custom_field_roles
  ADD CONSTRAINT bling_custom_field_roles_role_check
  CHECK (role IN ('mapa','anvisa','anatel_homologacao','anatel','garantia','garantia_extenso','modelo'));
NOTIFY pgrst, 'reload schema';
COMMIT;