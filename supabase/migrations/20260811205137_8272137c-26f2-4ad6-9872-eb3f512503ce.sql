DO $do$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'run_audit_sql';
  IF d IS NULL THEN RAISE EXCEPTION 'run_audit_sql not found'; END IF;
  d := replace(d, 'bs.nome_loja', 'bs.descricao');
  EXECUTE d;
END
$do$;