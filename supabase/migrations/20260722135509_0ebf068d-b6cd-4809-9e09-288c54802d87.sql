
ALTER TABLE public.fornecedores
  DROP COLUMN IF EXISTS comissao_faixa_0_9,
  DROP COLUMN IF EXISTS comissao_faixa_10_39,
  DROP COLUMN IF EXISTS comissao_faixa_40_79,
  DROP COLUMN IF EXISTS comissao_faixa_80_299,
  DROP COLUMN IF EXISTS comissao_faixa_300_799,
  DROP COLUMN IF EXISTS comissao_faixa_800_plus;

ALTER TABLE public.pricing_settings
  ADD COLUMN IF NOT EXISTS profit_bands JSONB NOT NULL DEFAULT
    '[
      {"min":0,     "max":9.99,   "margin_percent":0},
      {"min":10,    "max":39.99,  "margin_percent":0},
      {"min":40,    "max":79.99,  "margin_percent":0},
      {"min":80,    "max":299.99, "margin_percent":0},
      {"min":300,   "max":799.99, "margin_percent":0},
      {"min":800,   "max":null,   "margin_percent":0}
    ]'::jsonb;
