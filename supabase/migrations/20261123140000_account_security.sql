-- Senha forte, troca anual e código por e-mail em cada nova sessão.
create table if not exists public.account_security (
  user_id uuid primary key references auth.users(id) on delete cascade,
  password_changed_at timestamptz,          -- null = precisa definir senha nova dentro da política
  mfa_email text,                            -- null = usa o e-mail de login
  updated_at timestamptz not null default now()
);

create table if not exists public.account_mfa_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  verified_at timestamptz not null default now()
);
create index if not exists account_mfa_sessions_user_idx on public.account_mfa_sessions(user_id);

create table if not exists public.account_mfa_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  code_hash text not null,
  sent_to text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists account_mfa_challenges_session_idx on public.account_mfa_challenges(session_id, created_at desc);
create index if not exists account_mfa_challenges_user_idx on public.account_mfa_challenges(user_id, created_at desc);

-- Concessão de uso único gravada pelo servidor logo antes de trocar a senha já validada pela política.
create table if not exists public.account_password_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);

create table if not exists public.account_security_settings (
  id boolean primary key default true check (id),
  enforced boolean not null default false,
  enforced_user_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.account_security_settings (id) values (true) on conflict do nothing;

alter table public.account_security enable row level security;
alter table public.account_mfa_sessions enable row level security;
alter table public.account_mfa_challenges enable row level security;
alter table public.account_password_grants enable row level security;
alter table public.account_security_settings enable row level security;

revoke all on public.account_security, public.account_mfa_sessions, public.account_mfa_challenges,
  public.account_password_grants, public.account_security_settings from anon, authenticated;
grant select, insert, update, delete on public.account_security, public.account_mfa_sessions,
  public.account_mfa_challenges, public.account_password_grants, public.account_security_settings to service_role;

-- Qualquer troca de senha fora do servidor (sem concessão) obriga nova senha dentro da política.
create or replace function public.track_password_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_granted boolean;
begin
  if new.encrypted_password is not distinct from old.encrypted_password then
    return new;
  end if;
  delete from public.account_password_grants
   where user_id = new.id and expires_at > now()
  returning true into v_granted;
  insert into public.account_security (user_id, password_changed_at, updated_at)
  values (new.id, case when coalesce(v_granted, false) then now() else null end, now())
  on conflict (user_id) do update
    set password_changed_at = excluded.password_changed_at, updated_at = now();
  return new;
end $$;

drop trigger if exists on_auth_user_password_changed on auth.users;
create trigger on_auth_user_password_changed
  after update of encrypted_password on auth.users
  for each row execute function public.track_password_change();

-- Conta criada pelo servidor com senha validada: concessão consumida no cadastro.
create or replace function public.track_password_on_create()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_granted boolean;
begin
  delete from public.account_password_grants
   where user_id = new.id and expires_at > now()
  returning true into v_granted;
  insert into public.account_security (user_id, password_changed_at)
  values (new.id, case when coalesce(v_granted, false) then now() else null end)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_password_created on auth.users;
create trigger on_auth_user_password_created
  after insert on auth.users
  for each row execute function public.track_password_on_create();

-- Estado de segurança da sessão atual (sessão verificada por código + senha dentro do prazo).
create or replace function public.current_session_security_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.account_mfa_sessions s
      join public.account_security a on a.user_id = s.user_id
     where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
       and s.user_id = auth.uid()
       and a.password_changed_at > now() - interval '365 days'
  )
$$;

-- Executado pelo PostgREST antes de toda consulta: bloqueia sessões sem código/senha em dia.
create or replace function public.enforce_account_security()
returns void language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid; v_settings public.account_security_settings;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    return;
  end if;
  v_uid := auth.uid();
  if v_uid is null then return; end if;
  select * into v_settings from public.account_security_settings where id;
  if not found then return; end if;
  if not (v_settings.enforced or v_uid = any(v_settings.enforced_user_ids)) then
    return;
  end if;
  if not public.current_session_security_ok() then
    raise exception 'Confirme o código enviado por e-mail e mantenha a senha em dia para continuar.'
      using errcode = '42501', hint = 'account_security_required';
  end if;
end $$;

grant execute on function public.enforce_account_security() to anon, authenticated, service_role;
revoke execute on function public.current_session_security_ok() from anon;
grant execute on function public.current_session_security_ok() to authenticated, service_role;
revoke execute on function public.track_password_change() from anon, authenticated;
revoke execute on function public.track_password_on_create() from anon, authenticated;

-- Contas existentes: senha atual não comprovadamente forte → troca obrigatória quando a exigência valer.
insert into public.account_security (user_id, password_changed_at)
select id, null from auth.users
on conflict (user_id) do nothing;

alter role authenticator set pgrst.db_pre_request = 'public.enforce_account_security';
notify pgrst, 'reload config';
