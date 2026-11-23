-- Cria as 11 empresas (a partir do catálogo bling_oauth_apps) para o usuário
-- blingsvaleria@gmail.com, com vínculo admin e credenciais Bling já preenchidas.

do $$
declare
  v_user uuid;
  app record;
  v_company uuid;
begin
  select id into v_user from auth.users where email = 'blingsvaleria@gmail.com';
  if v_user is null then
    raise notice 'usuário blingsvaleria@gmail.com não encontrado; nada a fazer';
    return;
  end if;

  for app in select nome, client_id, client_secret from public.bling_oauth_apps order by nome loop
    select id into v_company
      from public.companies
     where owner_user_id = v_user and nome = app.nome
     limit 1;

    if v_company is null then
      insert into public.companies (owner_user_id, nome, status)
      values (v_user, app.nome, 'ativa')
      returning id into v_company;
    end if;

    insert into public.company_users (company_id, user_id, role, ativo)
    values (v_company, v_user, 'admin', true)
    on conflict do nothing;

    insert into public.bling_integrations (company_id, status, client_id, client_secret, oauth_app_nome)
    values (v_company, 'desconectada', app.client_id, app.client_secret, app.nome)
    on conflict (company_id) do update
      set client_id = excluded.client_id,
          client_secret = excluded.client_secret,
          oauth_app_nome = excluded.oauth_app_nome;
  end loop;
end $$;
