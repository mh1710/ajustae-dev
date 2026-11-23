-- As consultas feitas pela tela (lista de produtos, BI/DRE, auditorias) rodam
-- com o papel "authenticated", que tinha limite de apenas 8 segundos. Em
-- empresas com muitos produtos isso estourava com
-- "canceling statement due to statement timeout". Sobe para 60s.
-- (As funções pesadas em segundo plano já têm limites próprios maiores.)

ALTER ROLE authenticated SET statement_timeout = '60s';
ALTER ROLE anon SET statement_timeout = '15s';
