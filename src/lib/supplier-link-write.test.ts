import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { supplierLinkWrite } from './supplier-link-write';
describe('supplier link repair', () => {
  it('updates an existing unassigned link instead of creating a duplicate', () => {
    const write = supplierLinkWrite('776163627', { fornecedor: { id: 18041202633 }, padrao: true }, 21.9);
    strictEqual(write.method, 'PUT');
    strictEqual(write.path, '/produtos/fornecedores/776163627');
    deepStrictEqual(write.body, { fornecedor: { id: 18041202633 }, padrao: true, precoCompra: 21.9 });
  });
  it('creates only when there is no existing link', () => {
    const write = supplierLinkWrite(null, { fornecedor: { id: 18041202633 } });
    strictEqual(write.method, 'POST');
    strictEqual(write.path, '/produtos/fornecedores');
  });
});