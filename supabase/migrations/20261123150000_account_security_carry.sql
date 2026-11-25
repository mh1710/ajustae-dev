-- A troca de senha encerra todas as sessões; a sessão nova criada logo em seguida com a senha nova
-- herda a verificação por código uma única vez, se a sessão anterior já estava verificada.
alter table public.account_security add column if not exists mfa_carry_until timestamptz;
