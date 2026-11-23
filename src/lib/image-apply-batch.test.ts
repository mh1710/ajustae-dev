import { test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { chunks, mapLimited } from './image-apply-batch';
test('224 produtos ficam em requisições individuais sem perder itens', () => {
  const products = Array.from({ length: 224 }, (_, i) => i);
  const parts = chunks(products);
  strictEqual(parts.length, 224);
  strictEqual(Math.max(...parts.map((p) => p.length)), 1);
  deepStrictEqual(parts.flat(), products);
});
test('confere todas as fotos com no máximo 6 ao mesmo tempo', async () => {
  let active = 0; let peak = 0;
  const result = await mapLimited(Array.from({ length: 18 }, (_, i) => i), async (n) => {
    active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 2)); active--; return n;
  });
  strictEqual(peak, 6);
  deepStrictEqual(result, Array.from({ length: 18 }, (_, i) => i));
});