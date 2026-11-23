create type public.app_role as enum ('admin','user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "user_roles_select_own" on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "user_roles_admin_insert" on public.user_roles
  for insert to authenticated with check (public.has_role(auth.uid(),'admin'));
create policy "user_roles_admin_delete" on public.user_roles
  for delete to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.user_permissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  can_download_sheets boolean not null default false,
  can_push_bling boolean not null default false,
  can_use_ai boolean not null default false,
  active boolean not null default true,
  access_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.user_permissions to authenticated;
grant all on public.user_permissions to service_role;
alter table public.user_permissions enable row level security;

create policy "user_permissions_select_own" on public.user_permissions
  for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "user_permissions_admin_write" on public.user_permissions
  for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create trigger user_permissions_set_updated_at
  before update on public.user_permissions
  for each row execute function public.update_updated_at_column();

create policy "profiles_select_admin" on public.profiles
  for select to authenticated using (public.has_role(auth.uid(),'admin'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
BEGIN
  INSERT INTO public.profiles (id, nome, email, telefone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', ''),
    COALESCE(NEW.email, ''),
    NEW.raw_user_meta_data->>'telefone'
  );
  INSERT INTO public.user_permissions (user_id) VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

insert into public.user_permissions (user_id)
  select id from auth.users on conflict (user_id) do nothing;
insert into public.user_roles (user_id, role)
  select id, 'user' from auth.users on conflict (user_id, role) do nothing;