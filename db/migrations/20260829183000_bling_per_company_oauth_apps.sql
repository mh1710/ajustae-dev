-- Bling: credenciais (Client ID / Client Secret) por empresa,
-- com um catálogo de apps OAuth cadastrados.

alter table public.bling_integrations
  add column if not exists client_id text,
  add column if not exists client_secret text,
  add column if not exists oauth_app_nome text;

create table if not exists public.bling_oauth_apps (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  client_id text not null,
  client_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Segredos: nenhum acesso via Data API para anon/authenticated.
grant all on public.bling_oauth_apps to service_role;
alter table public.bling_oauth_apps enable row level security;

insert into public.bling_oauth_apps (nome, client_id, client_secret) values
  ('Casa Mix Brasil',    'f0233771d97a692cd371513087d50a704d4c67be', '8a1ab243f278423a5ead7fe024c876467302cbd48be787bec99877658641'),
  ('SOS',                '9f164befeb9f095712e5175c21e6c753013e134b', '6f344f6977a30deee44591fcb90ead24953765b42c9d387bceb04aaa9ff6'),
  ('Via 44 Store',       '331fd6a7ee48888b840592373de50a8d4fced745', '7faede28eb2ec0d3bfadc634b4123073cbda6893151b08f6b6efca469b5c'),
  ('Casa Mariano',       '0085572d0ca9aa8ad9b2f42838dd326418c75852', 'f672340bb0a27dddd2abfdd6e16cc8c80df82e3a0ee91ae8a1ee8827e72c'),
  ('UNG BRASIL',         '008e07fb4437c36cf285f4c289914ec0541f6c44', '80525ed8e3a042bdf876e73ae058bc16a853bb90a25542f48be6de307f18'),
  ('Essencial',          '34c0c3613c704d03fbd38805d1313a0d28cbeefc', '2f9669a50fb876cde06c04739fea884afcd2969e317d3abd455d85ca07f0'),
  ('RDCell',             'f29de0c138e2e5dd1ed975ca6aed2105143aadf3', '20f310f32fd53bc88c65fcdb04810235c7014585906727edc2f3d94ba41f'),
  ('FMOCIONE',           '070a2d250d91a034de10451d72f138441757acf2', '957369a6b0c16f7f6674239f84d5d5833600f9baef446218f497168ed4be'),
  ('Casa Ipiranga',      '5129709616c9d15b52e8d615ac72342fdf4c08bf', 'e80ce44ef34c9dda2948a47547a60db5a4431aa32f07045299affb2b8175'),
  ('Casa Multi Coisas',  '01785963342e9b89e01a6476d1dbfbe77941d4f1', 'a63f2bd7571cdcb13a214f53fa81b53d641b9366dc360f1a230867560a69'),
  ('Casa Castro',        'd702799ae5112656450f29106b575e9007f5b523', '2e6c72ab3cdc9810b430744e3ef3bb781dfbe20da53e2c338a6c411ef77f')
on conflict (nome) do update
  set client_id = excluded.client_id,
      client_secret = excluded.client_secret,
      updated_at = now();
