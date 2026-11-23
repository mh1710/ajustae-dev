DELETE FROM public.audit_results WHERE rule_slug IN ('imagens-obrigatorias','imagens-padrao');
DELETE FROM public.validation_rules WHERE slug IN ('imagens-obrigatorias','imagens-padrao');
UPDATE public.audit_runs SET status='cancelada', finished_at=COALESCE(finished_at, now()) WHERE status='processando';