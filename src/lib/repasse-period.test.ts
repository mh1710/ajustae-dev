import { test } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import { includeRepasseDate } from './repasse-period';

test('inclui o repasse de 25/10 quando a lista termina em 21/10', () => {
  deepStrictEqual(includeRepasseDate('2026-07-23', '2026-10-21', '2026-10-25'), { from: '2026-07-23', to: '2026-10-25' });
});
test('inclui um repasse anterior ao início do período', () => {
  deepStrictEqual(includeRepasseDate('2026-10-01', '2026-10-21', '2026-09-30'), { from: '2026-09-30', to: '2026-10-21' });
});
test('preserva o período quando o repasse já está nele', () => {
  deepStrictEqual(includeRepasseDate('2026-10-01', '2026-10-21', '2026-10-10'), { from: '2026-10-01', to: '2026-10-21' });
});