import { test } from 'node:test';
import { deepStrictEqual, throws } from 'node:assert';
import { importSupplierPayload, type ImportSupplier } from './import-product-supplier';

const destination: ImportSupplier = { bling_supplier_id:'92345',supplier_codigo:'hayamax',supplier_name:'Hayamax comercio',codigo:'73145',preco_custo:75.6,descricao:'Produto Hayamax' };
test('criação usa o contato do destino e SKU do fornecedor sem prefixo', () => {
  deepStrictEqual(importSupplierPayload(destination), { contato:{id:92345},codigo:'73145',precoCusto:75.6,precoCompra:75.6,descricao:'Produto Hayamax' });
});
test('nome diferente do fornecedor não altera vínculo por identidade', () => {
  deepStrictEqual(importSupplierPayload({...destination,supplier_name:'HAYAMAX'}),importSupplierPayload(destination));
});
test('não cria vínculo sem custo positivo', () => {
  throws(() => importSupplierPayload({...destination,preco_custo:0}));
});
test('não aceita fornecedor sem contato válido', () => {
  throws(() => importSupplierPayload({...destination,bling_supplier_id:''}));
});