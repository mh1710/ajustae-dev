# Testes unitários automatizados do Ajustae

Esta pasta concentra o executor seguro da suíte unitária. Ela reaproveita os testes
existentes em `src`, inclusive os testes históricos escritos com `node:test`, e
adiciona uma fronteira que bloqueia rede e remove credenciais privilegiadas.

## Execução desacompanhada

```powershell
npm run test:unit
```

O comando espera todos os testes terminarem, grava o resultado em
`tests/unit/reports/latest.md` e mostra somente um resumo final. Não usa Bling,
Supabase, Cloudflare, Mercado Livre, Nylas ou Nango reais.

O mesmo relatório executa heurísticas sobre os limites entre banco e Bling. Os
achados aparecem como alertas para discussão e como `it.todo`: não derrubam a
suíte até o contrato esperado ser aprovado e implementado.

Para diagnóstico detalhado no terminal:

```powershell
npm run test:unit:direct
```

## Onde criar os próximos testes

- Funções puras continuam próximas do código em `src/**/*.test.ts`.
- Contratos gerais e fronteiras de segurança ficam em `tests/unit/specs`.
- Fixtures fictícias compartilhadas devem ficar em `tests/unit/fixtures`.
- Não colocar IDs, e-mails, tokens, URLs ou payloads reais nas fixtures.

Todo erro corrigido deve ganhar primeiro um teste que reproduza o problema. Para
operações Bling, o teste deve simular resposta de sucesso e falha e comprovar que o
banco só recebe o estado confirmado depois da resposta esperada do ERP.
