-- Reconsulta do Mercado Livre: cobertura diária garantida, sem execuções sobrepostas.
create table if not exists public.ml_refresh_state (
  singleton boolean primary key default true check (singleton),
  lease_until timestamptz not null default now() - interval '1 minute',
  last_started_at timestamptz,
  last_finished_at timestamptz,
  processed_cycle int not null default 0
);
insert into public.ml_refresh_state (singleton) values (true) on conflict do nothing;
grant all on public.ml_refresh_state to service_role;
alter table public.ml_refresh_state enable row level security;

create or replace function public.ml_refresh_lease(_minutes int default 2)
returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update public.ml_refresh_state
     set lease_until = now() + make_interval(mins => greatest(_minutes,1)),
         last_started_at = now()
   where singleton and lease_until < now()
  returning true into ok;
  return coalesce(ok,false);
end $$;
grant execute on function public.ml_refresh_lease(int) to service_role;

create or replace function public.ml_refresh_release()
returns void language sql security definer set search_path = public as $$
  update public.ml_refresh_state
     set lease_until = now() - interval '1 minute', last_finished_at = now()
   where singleton;
$$;
grant execute on function public.ml_refresh_release() to service_role;

-- cron: de hora em hora (antes era a cada 5 minutos)
