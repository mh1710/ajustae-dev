import { test } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import { calculateRepasse } from './repasse-calculation';

test('desconta os quatro custos e divide por dois como a primeira linha da planilha', () => {
  deepStrictEqual(calculateRepasse({ custo_produto: 75.6, quantidade: 1, custo_etiqueta: 44.95, custo_boy: 5, custo_embalagem: 3, repasse: 206.89 }), { custos: 128.55, resultado: 78.34, divisao: 39.17 });
});
test('multiplica o custo do produto pela quantidade', () => {
  deepStrictEqual(calculateRepasse({ custo_produto: 75.6, quantidade: 2, custo_etiqueta: 44.95, custo_boy: 5, custo_embalagem: 3, repasse: 206.89 }), { custos: 204.15, resultado: 2.74, divisao: 1.37 });
});
test('preserva ajustes negativos e arredonda meio centavo', () => {
  deepStrictEqual(calculateRepasse({ custo_produto: 0, quantidade: 1, custo_etiqueta: 0, custo_boy: 0, custo_embalagem: 0, repasse: -82.21 }), { custos: 0, resultado: -82.21, divisao: -41.11 });
});
test('tarifa performance negativa fica dividida por dois', () => {
  deepStrictEqual(calculateRepasse({ custo_produto: 0, quantidade: 1, custo_etiqueta: 0, custo_boy: 0, custo_embalagem: 0, repasse: -55 }), { custos: 0, resultado: -55, divisao: -27.5 });
});
