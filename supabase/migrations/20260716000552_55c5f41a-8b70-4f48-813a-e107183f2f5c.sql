-- Mantém apenas as 3 regras globais ativas (descrição mínima, título máximo, garantia duplicada).
-- Demais regras (globais ou por empresa) são desativadas — o registro em código só reconhece esses 3 slugs.
UPDATE public.validation_rules
   SET active = false
 WHERE slug NOT IN ('descricao-minima','titulo-maximo','descricao-curta-garantia');

-- Remove eventuais duplicatas globais e recria as 3 com os defaults desejados.
DELETE FROM public.validation_rules
 WHERE company_id IS NULL
   AND slug IN ('descricao-minima','titulo-maximo','descricao-curta-garantia');

INSERT INTO public.validation_rules
  (company_id, slug, name, description, category, severity, active, config)
VALUES
  (NULL, 'descricao-minima', 'Descrição mínima',
   'Descrição complementar deve ter no mínimo 150 caracteres.',
   'conteudo', 'warning', true, '{"min":150}'::jsonb),
  (NULL, 'titulo-maximo', 'Título máximo',
   'Nome do produto deve ter no máximo 60 caracteres.',
   'conteudo', 'warning', true, '{"max":60}'::jsonb),
  (NULL, 'descricao-curta-garantia', 'Garantia duplicada na descrição curta',
   'A palavra "garantia" não pode aparecer mais de uma vez na descrição curta.',
   'conteudo', 'warning', true, '{"max_ocorrencias":1}'::jsonb);