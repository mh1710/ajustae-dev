-- Mapeamento do Mercado Livre mais rápido:
-- 1) guarda o produto de catálogo achado (permite recotar preço com 1 requisição);
-- 2) RPC de claim atômico, para vários workers em paralelo no mesmo job.

alter table public.ml_product_matches add column if not exists catalog_product_id text;

create index if not exists ml_product_matches_catalog_idx
  on public.ml_product_matches (catalog_product_id)
  where catalog_product_id is not null;

create or replace function public.ml_claim_batch(_job_id uuid, _limit int)
returns table (id uuid, company_id uuid, codigo text, nome text, gtin text)
language plpgsql
security definer
set search_path = public
as $$
declare
  _cur uuid;
  _ids uuid[];
  _last uuid;
  rec record;
begin
  select j.cursor_id, coalesce(j.company_ids, array[j.company_id])
    into _cur, _ids
  from public.ml_map_jobs j
  where j.id = _job_id
  for update;

  if _ids is null then
    return;
  end if;

  for rec in
    select p.id, p.company_id, p.codigo, p.nome, p.gtin
    from public.bling_products p
    where p.company_id = any(_ids)
      and (_cur is null or p.id > _cur)
    order by p.id
    limit greatest(_limit, 1)
  loop
    id := rec.id;
    company_id := rec.company_id;
    codigo := rec.codigo;
    nome := rec.nome;
    gtin := rec.gtin;
    _last := rec.id;
    return next;
  end loop;

  if _last is not null then
    update public.ml_map_jobs
       set cursor_id = _last, updated_at = now()
     where ml_map_jobs.id = _job_id;
  end if;
end;
$$;

grant execute on function public.ml_claim_batch(uuid, int) to service_role;

-- Progresso somado de forma atômica (vários workers no mesmo job).
create or replace function public.ml_bump_progress(
  _job_id uuid, _processed int, _found int, _full int
) returns void
language sql
security definer
set search_path = public
as $$
  update public.ml_map_jobs
     set processed = coalesce(processed,0) + coalesce(_processed,0),
         found_count = coalesce(found_count,0) + coalesce(_found,0),
         full_count = coalesce(full_count,0) + coalesce(_full,0),
         updated_at = now()
   where id = _job_id;
$$;
grant execute on function public.ml_bump_progress(uuid, int, int, int) to service_role;
