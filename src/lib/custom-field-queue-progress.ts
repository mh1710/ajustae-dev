type QueueJob = {
  id?: string;
  kind: string;
  status: string;
  total: number;
  done_count: number;
  error_count: number;
};

export function isCustomFieldSendJob(job: QueueJob) {
  return job.kind === "push" || job.kind === "auto";
}

export function visibleCustomFieldJobs<T extends QueueJob>(jobs: T[]): T[] {
  const sends = jobs.filter(isCustomFieldSendJob).filter((job) => job.status !== "cancelado");
  const active = sends.filter((job) => job.status === "executando" || job.status === "pausado");
  return active.length > 0 ? active : sends.slice(0, 1);
}

export function unifiedQueueProgress(
  push: { total: number; concluidos: number; erros: number; products_total?: number; products_done?: number; requests_total?: number; requests_done?: number } | undefined,
  jobs: QueueJob[],
  sentRequests: number,
) {
  const fields = jobs.map(customFieldQueueProgress);
  const fieldTotal = fields.reduce((sum, field) => sum + field.total, 0);
  const fieldDone = fields.reduce((sum, field) => sum + field.processed, 0);
  const remaining = fields.reduce((sum, field) => sum + field.pending, 0);
  // Chamadas reais ao Bling: estoque por depósito vale uma chamada por depósito enviado.
  const pushTotal = push?.requests_total ?? push?.total ?? 0;
  const pushDone = push?.requests_done ?? ((push?.concluidos ?? 0) + (push?.erros ?? 0));
  const total = pushTotal + sentRequests + remaining;
  const done = pushDone + sentRequests;
  // Produtos únicos: o mesmo produto em várias requisições (estoques, campos) conta 1.
  const pushProducts = push?.products_total ?? 0;
  const pushProductsLeft = Math.max(0, pushProducts - (push?.products_done ?? 0));
  const productsTotal = Math.max(pushProducts, fieldTotal);
  const productsDone = Math.max(0, productsTotal - Math.max(pushProductsLeft, fieldTotal - fieldDone));
  return {
    total, done, productsTotal, productsDone,
    pct: total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0,
    productsPct: productsTotal > 0 ? Math.min(100, Math.round(productsDone / productsTotal * 100)) : 0,
    pending: jobs.filter((job) => job.status === "executando").reduce((sum, job) => sum + customFieldQueueProgress(job).pending, 0),
    paused: jobs.filter((job) => job.status === "pausado").reduce((sum, job) => sum + customFieldQueueProgress(job).pending, 0),
    errors: jobs.reduce((sum, job) => sum + job.error_count, push?.erros ?? 0),
  };
}

export function customFieldQueueProgress(job: QueueJob) {
  const total = Math.max(0, job.total);
  const processed = Math.min(total, Math.max(0, job.done_count + job.error_count));
  return {
    total,
    processed,
    pending: job.status === "executando" || job.status === "pausado" ? total - processed : 0,
    percent: total > 0 ? Math.round((processed / total) * 100) : 0,
  };
}