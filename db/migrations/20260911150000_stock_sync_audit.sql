-- Auditoria de sincronização de estoque (compara estoque local x estoque no Bling)

create table if not exists public.stock_audit_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid,
  status text not null default 'processando',
  sample_pct numeric not null default 10,
  total_products integer not null default 0,
  checked_products integer not null default 0,
  ok_count integer not null default 0,
  divergent_count integer not null default 0,
  missing_count integer not null default 0,
  error_count integer not null default 0,
  last_error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_audit_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.stock_audit_runs(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid,
  bling_product_id text,
  codigo text,
  nome text,
  bucket text not null default 'com_estoque',
  estoque_local numeric,
  estoque_bling numeric,
  diferenca numeric,
  status text not null default 'pendente',
  detalhe text,
  checked_at timestamptz
);

create index if not exists stock_audit_runs_company_idx on public.stock_audit_runs (company_id, created_at desc);
create index if not exists stock_audit_items_run_idx on public.stock_audit_items (run_id, status);

grant select, insert, update, delete on public.stock_audit_runs to authenticated;
grant select, insert, update, delete on public.stock_audit_items to authenticated;
grant all on public.stock_audit_runs to service_role;
grant all on public.stock_audit_items to service_role;

alter table public.stock_audit_runs enable row level security;
alter table public.stock_audit_items enable row level security;

drop policy if exists stock_audit_runs_members_all on public.stock_audit_runs;
create policy stock_audit_runs_members_all on public.stock_audit_runs
  for all to authenticated
  using (app_private.is_company_member(company_id, auth.uid()))
  with check (app_private.is_company_member(company_id, auth.uid()));

drop policy if exists stock_audit_items_members_all on public.stock_audit_items;
create policy stock_audit_items_members_all on public.stock_audit_items
  for all to authenticated
  using (app_private.is_company_member(company_id, auth.uid()))
  with check (app_private.is_company_member(company_id, auth.uid()));

-- Cria a execução e sorteia a amostra (metade com estoque, metade zerados)
create or replace function public.start_stock_sync_audit(
  _company_id uuid,
  _user_id uuid,
  _pct numeric default 10
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_total_com integer;
  v_total_zero integer;
  v_take_com integer;
  v_take_zero integer;
  v_total integer;
begin
  select count(*) into v_total_com
  from bling_products
  where company_id = _company_id and bling_product_id is not null and coalesce(estoque, 0) > 0;

  select count(*) into v_total_zero
  from bling_products
  where company_id = _company_id and bling_product_id is not null and coalesce(estoque, 0) <= 0;

  v_take_com := greatest(case when v_total_com > 0 then ceil(v_total_com * _pct / 100.0)::int else 0 end, case when v_total_com > 0 then 1 else 0 end);
  v_take_zero := greatest(case when v_total_zero > 0 then ceil(v_total_zero * _pct / 100.0)::int else 0 end, case when v_total_zero > 0 then 1 else 0 end);

  insert into stock_audit_runs (company_id, user_id, sample_pct, status)
  values (_company_id, _user_id, _pct, 'processando')
  returning id into v_run_id;

  insert into stock_audit_items (run_id, company_id, product_id, bling_product_id, codigo, nome, bucket, estoque_local)
  select v_run_id, _company_id, p.id, p.bling_product_id, p.codigo, p.nome, 'com_estoque', coalesce(p.estoque, 0)
  from (
    select id, bling_product_id, codigo, nome, estoque
    from bling_products
    where company_id = _company_id and bling_product_id is not null and coalesce(estoque, 0) > 0
    order by random()
    limit v_take_com
  ) p;

  insert into stock_audit_items (run_id, company_id, product_id, bling_product_id, codigo, nome, bucket, estoque_local)
  select v_run_id, _company_id, p.id, p.bling_product_id, p.codigo, p.nome, 'zerado', coalesce(p.estoque, 0)
  from (
    select id, bling_product_id, codigo, nome, estoque
    from bling_products
    where company_id = _company_id and bling_product_id is not null and coalesce(estoque, 0) <= 0
    order by random()
    limit v_take_zero
  ) p;

  select count(*) into v_total from stock_audit_items where run_id = v_run_id;

  update stock_audit_runs
  set total_products = v_total,
      status = case when v_total = 0 then 'concluida' else 'processando' end,
      finished_at = case when v_total = 0 then now() else null end
  where id = v_run_id;

  return json_build_object('run_id', v_run_id, 'total', v_total, 'com_estoque', v_take_com, 'zerados', v_take_zero);
end;
$$;

grant execute on function public.start_stock_sync_audit(uuid, uuid, numeric) to authenticated, service_role;
