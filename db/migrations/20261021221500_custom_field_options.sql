-- Guarda o tipo real do campo (Lista, Texto...) e as opções da lista suspensa lidas do Bling.
alter table public.bling_custom_fields
  add column if not exists tipo_campo_id integer,
  add column if not exists opcoes jsonb;

comment on column public.bling_custom_fields.tipo_campo_id is
  'ID do tipo do campo no Bling (1 Inteiro, 2 Decimal, 3 Lista, 4 Texto, 5 Texto longo, 6 Lógico, 7 Data)';
comment on column public.bling_custom_fields.opcoes is
  'Opções da lista suspensa vindas do Bling: [{"id":123,"nome":"3 meses"}]';
