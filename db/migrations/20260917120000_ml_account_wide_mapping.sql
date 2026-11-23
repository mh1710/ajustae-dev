-- Mercado Livre passa a ser um fornecedor da CONTA (todas as empresas),
-- mapeando cada SKU único apenas uma vez.

create table if not exists public.ml_sku_checks (
  sku text primary key,
  job_id uuid,
  qualifies boolean not null default false,
  checked_at timestamptz not null default now()
);
grant select on public.ml_sku_checks to authenticated;
grant all on public.ml_sku_checks to service_role;
alter table public.ml_sku_checks enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ml_sku_checks' and policyname = 'authenticated read ml sku checks'
  ) then
    create policy "authenticated read ml sku checks" on public.ml_sku_checks
      for select to authenticated using (true);
  end if;
end $$;

alter table public.ml_map_jobs add column if not exists company_ids uuid[];

create index if not exists ml_product_matches_sku_idx on public.ml_product_matches (sku);
create index if not exists ml_product_matches_ean_idx on public.ml_product_matches (ean);

create or replace function public.ml_account_sku_total(_company_ids uuid[])
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct codigo)::int
  from public.bling_products
  where company_id = any(_company_ids)
    and codigo is not null
    and codigo <> '';
$$;
grant execute on function public.ml_account_sku_total(uuid[]) to service_role, authenticated;
