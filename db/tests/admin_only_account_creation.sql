BEGIN;
DO $$
BEGIN
  IF has_function_privilege('anon','public.authorize_account_creation(text)','EXECUTE')
    OR has_function_privilege('authenticated','public.authorize_account_creation(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Only the privileged server may authorize new accounts';
  END IF;
END $$;
DO $$
DECLARE new_id uuid := gen_random_uuid();
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
    VALUES (new_id, 'signup-denied-test@example.invalid', '{}', '{"provisioned_by_admin":true}');
    RAISE EXCEPTION 'Public signup must not create accounts even with spoofed user metadata';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = new_id) THEN
    RAISE EXCEPTION 'Rejected signup persisted a user';
  END IF;
END $$;
DO $$
DECLARE new_id uuid := gen_random_uuid(); grant_nonce uuid;
BEGIN
  grant_nonce := public.authorize_account_creation('admin-created-test@example.invalid');
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
  VALUES (new_id, 'admin-created-test@example.invalid', '{}', jsonb_build_object('account_creation_grant',grant_nonce));
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = new_id) THEN
    RAISE EXCEPTION 'Trusted admin provisioning must still create accounts';
  END IF;
  IF EXISTS (SELECT 1 FROM app_private.account_creation_grants WHERE nonce=grant_nonce) THEN
    RAISE EXCEPTION 'Provisioning grant must be consumed exactly once';
  END IF;
  BEGIN
    INSERT INTO auth.users (id,email,raw_user_meta_data)
    VALUES (gen_random_uuid(),'admin-created-test@example.invalid',jsonb_build_object('account_creation_grant',grant_nonce));
    RAISE EXCEPTION 'Consumed grants must not allow replay';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;