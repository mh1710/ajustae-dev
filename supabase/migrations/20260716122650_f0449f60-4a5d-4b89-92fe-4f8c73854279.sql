
DELETE FROM public.audit_results;
DELETE FROM public.audit_runs;
DELETE FROM public.validation_rules;

INSERT INTO public.validation_rules (company_id, slug, name, description, category, severity, active, config) VALUES
(NULL, 'titulo-maximo', 'Título máximo (60 caracteres)', 'O nome/descrição do produto não pode ter mais que 60 caracteres.', 'conteudo', 'error', true, '{"max":60}'::jsonb),
(NULL, 'descricao-curta-minima', 'Descrição curta mínima (150 caracteres)', 'A descrição curta deve ter no mínimo 150 caracteres.', 'conteudo', 'error', true, '{"min":150}'::jsonb),
(NULL, 'descricao-complementar-igual-nome', 'Descrição complementar igual ao nome', 'A descrição complementar deve ser idêntica ao nome/descrição do produto. Auto-corrigível.', 'conteudo', 'error', true, '{"autofix":true}'::jsonb),
(NULL, 'ean-obrigatorio', 'EAN obrigatório', 'O campo GTIN/EAN não pode estar vazio.', 'conteudo', 'warning', true, '{}'::jsonb),
(NULL, 'imagens-obrigatorias', 'Precisa ter imagens', 'O produto precisa ter ao menos uma imagem.', 'imagens', 'error', true, '{}'::jsonb),
(NULL, 'imagens-padrao', 'Padrão das imagens (PNG/JPG, 500-2500)', 'Imagens devem ser PNG ou JPG, entre 500x500 e 2500x2500 pixels.', 'imagens', 'error', true, '{"min":500,"max":2500}'::jsonb);
