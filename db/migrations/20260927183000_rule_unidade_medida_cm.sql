INSERT INTO public.validation_rules (company_id, slug, name, description, category, severity, active, config)
SELECT NULL, 'unidade-medida-centimetros', 'Unidade de medida em centímetros',
       'A unidade de medida das dimensões do produto deve ser sempre centímetros.',
       'dimensoes', 'error', true, '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.validation_rules WHERE slug = 'unidade-medida-centimetros' AND company_id IS NULL);
