BEGIN;
CREATE TABLE app_private.account_creation_grants (
  nonce uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '2 minutes'
);
REVOKE ALL ON app_private.account_creation_grants FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.authorize_account_creation(_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE grant_nonce uuid;
BEGIN
  DELETE FROM app_private.account_creation_grants WHERE expires_at < now();
  INSERT INTO app_private.account_creation_grants(email) VALUES (lower(trim(_email)))
  RETURNING nonce INTO grant_nonce;
  RETURN grant_nonce;
END;
$$;
REVOKE ALL ON FUNCTION public.authorize_account_creation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_account_creation(text) TO service_role;
CREATE OR REPLACE FUNCTION public.enforce_admin_account_creation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  DELETE FROM app_private.account_creation_grants
  WHERE nonce::text = NEW.raw_user_meta_data ->> 'account_creation_grant'
    AND email = lower(NEW.email) AND expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Novas contas devem ser criadas exclusivamente pelo administrador.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_admin_account_creation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_admin_account_creation ON auth.users;
CREATE TRIGGER enforce_admin_account_creation BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_account_creation();
COMMIT;