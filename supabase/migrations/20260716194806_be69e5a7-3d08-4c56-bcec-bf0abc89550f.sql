INSERT INTO public.validation_rules (company_id, slug, name, description, category, severity, active, config)
VALUES (
  NULL,
  'produto-em-fornecedor',
  'Produto presente na base do fornecedor',
  'O prefixo do SKU identifica o fornecedor (O/ODS=Oderço, HX/HA=Hayamax, EV/E=Evolusom). O código numérico após o prefixo precisa existir na base atualizada do respectivo fornecedor.',
  'conteudo',
  'error',
  true,
  '{}'::jsonb
)
ON CONFLICT DO NOTHING;