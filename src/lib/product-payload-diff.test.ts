import { test } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import { diffProductPayload } from './product-payload-diff';

const full = {
  nome: "Painel Solar 455w",
  preco: 899.9,
  situacao: "A",
  dimensoes: { largura: 10, altura: 1.5, profundidade: 15 },
  midia: { imagens: { externas: ["https://cdn.ex/1.jpg", "https://cdn.ex/2.jpg"] } },
};

test('sem registro anterior envia tudo', () => {
  deepStrictEqual(diffProductPayload(full, null), full);
});

test('nada mudou: não envia nada', () => {
  deepStrictEqual(diffProductPayload(full, { ...full }), {});
});

test('envia somente o campo que mudou', () => {
  const last = { ...full, preco: 799.9 };
  deepStrictEqual(diffProductPayload(full, last), { preco: 899.9 });
});

test('mudança dentro de sub-objeto envia o sub-objeto inteiro', () => {
  const last = { ...full, dimensoes: { largura: 10, altura: 2, profundidade: 15 } };
  deepStrictEqual(diffProductPayload(full, last), {
    dimensoes: { largura: 10, altura: 1.5, profundidade: 15 },
  });
});

test('lista de imagens diferente é detectada', () => {
  const last = { ...full, midia: { imagens: { externas: ["https://cdn.ex/1.jpg"] } } };
  deepStrictEqual(diffProductPayload(full, last), { midia: full.midia });
});

test('campo novo (ausente no último envio) é enviado', () => {
  const { preco: _preco, ...last } = full;
  deepStrictEqual(diffProductPayload(full, last), { preco: 899.9 });
});
test('trocar somente uma foto envia apenas a lista final de imagens do produto alterado', () => {
  const original = { ...full, midia: { imagens: { imagensURL: [{ link: 'https://cdn.ex/1.jpg' }, { link: 'https://cdn.ex/2.jpg' }, { link: 'https://cdn.ex/3.jpg' }] } } };
  const edited = { ...original, midia: { imagens: { imagensURL: [{ link: 'https://cdn.ex/1.jpg' }, { link: 'https://cdn.ex/nova.jpg' }, { link: 'https://cdn.ex/3.jpg' }] } } };
  deepStrictEqual(diffProductPayload(edited, original), { midia: edited.midia });
});
test('alteração de imagens em um produto não gera envio para os outros', () => {
  const previous = [full, full, full];
  const current = [full, { ...full, midia: { imagens: { externas: ['https://cdn.ex/nova.jpg'] } } }, full];
  const changes = current.map((payload, index) => diffProductPayload(payload, previous[index]));
  deepStrictEqual(changes, [{}, { midia: current[1].midia }, {}]);
});
