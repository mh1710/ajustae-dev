BEGIN;
-- Auth owns the login email; profiles are only a display projection.
UPDATE public.profiles p
SET email = u.email, updated_at = now()
FROM auth.users u
WHERE p.id = u.id AND u.email IS NOT NULL
  AND p.email IS DISTINCT FROM u.email;

CREATE OR REPLACE FUNCTION public.sync_profile_auth_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles SET email = COALESCE(NEW.email, ''), updated_at = now()
  WHERE id = NEW.id AND email IS DISTINCT FROM COALESCE(NEW.email, '');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_profile_auth_email() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
AFTER UPDATE OF email ON auth.users
FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION public.sync_profile_auth_email();

-- This provisioned company account must not bypass partner restrictions.
DELETE FROM public.user_roles r
USING auth.users u
WHERE r.user_id = u.id AND r.role = 'admin'
  AND lower(u.email) = 'matheusmariano@ajusttae.com.br'
  AND EXISTS (SELECT 1 FROM public.user_roles v WHERE v.user_id = u.id AND v.role = 'company_viewer');
COMMIT;