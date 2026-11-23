import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { customFieldQueueProgress, isCustomFieldSendJob, visibleCustomFieldJobs, unifiedQueueProgress } from "./custom-field-queue-progress";

const job = { kind: "auto", status: "executando", total: 100, done_count: 30, error_count: 10 };

test("progresso inclui os produtos com erro entre os processados", () => {
  deepStrictEqual(customFieldQueueProgress(job), { total: 100, processed: 40, pending: 60, percent: 40 });
});

test("fila inclui atualização automática e edição, mas não leitura do Bling", () => {
  strictEqual(isCustomFieldSendJob(job), true);
  strictEqual(isCustomFieldSendJob({ ...job, kind: "push" }), true);
  strictEqual(isCustomFieldSendJob({ ...job, kind: "sync" }), false);
});

test("tarefa pausada mantém restantes e cancelada não mostra pendentes", () => {
  strictEqual(customFieldQueueProgress({ ...job, status: "pausado" }).pending, 60);
  strictEqual(customFieldQueueProgress({ ...job, status: "cancelado" }).pending, 0);
});

test("tarefa totalmente processada com erros chega a 100 por cento", () => {
  strictEqual(customFieldQueueProgress({ ...job, status: "concluido", done_count: 90 }).percent, 100);
});

test("progresso único ignora canceladas e tarefas antigas quando existe envio ativo", () => {
  deepStrictEqual(visibleCustomFieldJobs([job, { ...job, status: "cancelado" }, { ...job, status: "concluido" }]), [job]);
});

test("produtos contam uma vez mesmo com várias requisições; requisições somam", () => {
  const progress = unifiedQueueProgress({ total: 709, concluidos: 709, erros: 0, products_total: 707, products_done: 707 }, [job], 25);
  strictEqual(progress.productsTotal, 707);
  strictEqual(progress.productsDone, 647);
  strictEqual(progress.total, 794);
  strictEqual(progress.done, 734);
  strictEqual(progress.pending, 60);
  strictEqual(progress.errors, 10);
});

test("finalizada sem alterações não inventa requisições", () => {
  const progress = unifiedQueueProgress(undefined, [{ ...job, status: "concluido", done_count: 100, error_count: 0 }], 0);
  strictEqual(progress.productsDone, 100);
  strictEqual(progress.total, 0);
  strictEqual(progress.done, 0);
});
test("requisições contam uma chamada por depósito de estoque, não uma por produto", () => {
  const progress = unifiedQueueProgress(
    { total: 17886, concluidos: 350, erros: 0, products_total: 17886, products_done: 350, requests_total: 35786, requests_done: 702 },
    [],
    0,
  );
  strictEqual(progress.total, 35786);
  strictEqual(progress.done, 702);
  strictEqual(progress.productsTotal, 17886);
  strictEqual(progress.productsDone, 350);
});
