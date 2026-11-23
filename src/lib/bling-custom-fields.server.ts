/**
 * Campos customizados de produtos no Bling: leitura (sync) e edição em massa (push). Server-only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blingApiGet, blingApiRequest, type BlingIntegrationRow } from "@/lib/bling.server";
import { autoCustomFieldValues, creationCustomFieldValues, type AutoFieldRole } from "@/lib/custom-field-auto-values";
import { productCustomFieldModules, CUSTOM_FIELD_ACCESS_MESSAGE } from "@/lib/custom-field-modules";

const LEASE_MS = 90_000;
const db = supabaseAdmin as any;

type Job = {
  id: string; company_id: string; integration_id: string; kind: "sync" | "push" | "auto"; status: string;
  cursor_id: string | null; done_count: number; error_count: number; field_id: string | null; valor: string | null;
};

async function isStopped(jobId: string) {
  const { data } = await db.from("bling_custom_field_jobs").select("status").eq("id", jobId).maybeSingle();
  return !data || data.status !== "executando";
}

async function claim(jobId: string): Promise<Job | null> {
  const now = new Date();
  const { data } = await db.from("bling_custom_field_jobs")
    .update({ lease_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq("id", jobId).eq("status", "executando")
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .select("id, company_id, integration_id, kind, status, cursor_id, done_count, error_count, field_id, valor")
    .maybeSingle();
  return (data as Job) ?? null;
}

/** Lê do Bling as definições dos campos customizados do módulo Produtos. */
export async function syncCustomFieldDefinitions(integ: BlingIntegrationRow, companyId: string) {
  const m = await blingApiGet<any>(integ, "/campos-customizados/modulos");
  if (!m.ok) throw new Error(m.status === 403 ? CUSTOM_FIELD_ACCESS_MESSAGE : `HTTP ${m.status} ao listar módulos de campos customizados`);
  const prodMods = productCustomFieldModules(m.data);
  const tipos = await blingApiGet<any>(integ, "/campos-customizados/tipos");
  const tipoNome = new Map<number, string>();
  for (const t of ((tipos.data as any)?.data ?? []) as any[]) {
    if (Number.isFinite(Number(t?.id))) tipoNome.set(Number(t.id), String(t.nome ?? ""));
  }
  const rows: any[] = [];
  for (const mod of prodMods) {
    const c = await blingApiGet<any>(integ, `/campos-customizados/modulos/${mod.id}`);
    if (!c.ok) throw new Error(c.status === 403 ? CUSTOM_FIELD_ACCESS_MESSAGE : `HTTP ${c.status} ao ler definições dos campos`);
    for (const f of ((c.data as any)?.data ?? []) as any[]) {
      // O detalhe traz o tipo real e as opções da lista suspensa; se falhar, usa o resumo da lista.
      const d = await blingApiGet<any>(integ, `/campos-customizados/${f.id}`);
      const det = d.ok ? ((d.data as any)?.data ?? {}) : {};
      const tipoId = Number(det.tipoCampo?.id ?? f.tipoCampo?.id ?? NaN);
      const opcoes = Array.isArray(det.opcoes)
        ? det.opcoes
            .filter((o: any) => o && Number(o.id) !== 0 && String(o.nome ?? "").trim())
            .map((o: any) => ({ id: Number(o.id), nome: String(o.nome).trim() }))
        : null;
      rows.push({
        company_id: companyId, integration_id: integ.id, bling_id_campo: String(f.id),
        nome: det.nome ?? f.nome ?? `Campo ${f.id}`,
        tipo: tipoNome.get(tipoId) ?? det.tipoCampo?.nome ?? f.tipoCampo?.nome ?? null,
        tipo_campo_id: Number.isFinite(tipoId) ? tipoId : null,
        opcoes: opcoes && opcoes.length ? opcoes : null,
        situacao: det.situacao ?? f.situacao ?? null,
      });
    }
  }
  if (rows.length) {
    const { error } = await db.from("bling_custom_fields").upsert(rows, { onConflict: "integration_id,bling_id_campo" });
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

async function fieldMap(integrationId: string) {
  const { data } = await db.from("bling_custom_fields").select("id, bling_id_campo").eq("integration_id", integrationId);
  return new Map(((data ?? []) as any[]).map((r) => [String(r.bling_id_campo), r.id as string]));
}

async function runSync(job: Job, integ: BlingIntegrationRow, deadline: number) {
  if (!job.cursor_id && job.done_count === 0) await syncCustomFieldDefinitions(integ, job.company_id);
  const fmap = await fieldMap(integ.id);
  let cursor = job.cursor_id;
  let done = job.done_count;
  let errors = job.error_count;
  while (Date.now() < deadline) {
    if (await isStopped(job.id)) return false;
    let q = db.from("bling_products").select("id, bling_product_id")
      .eq("company_id", job.company_id).not("bling_product_id", "is", null).order("id").limit(30);
    if (cursor) q = q.gt("id", cursor);
    const { data } = await q;
    const list = (data ?? []) as { id: string; bling_product_id: string }[];
    if (list.length === 0) return true;
    for (let i = 0; i < list.length; i += 6) {
      if (Date.now() >= deadline) break;
      const chunk = list.slice(i, i + 6);
      const res = await Promise.all(chunk.map((p) => blingApiGet<any>(integ, `/produtos/${encodeURIComponent(p.bling_product_id)}`)));
      if (await isStopped(job.id)) return false;
      const snapshots: { product_id: string; values: any[] }[] = [];
      for (let k = 0; k < chunk.length; k++) {
        const r = res[k];
        if (!r.ok) {
          if (r.status === 401 || r.status === 403) throw new Error(`HTTP ${r.status} ao ler produto`);
          errors++;
          continue;
        }
        snapshots.push({ product_id: chunk[k].id, values: ((r.data as any)?.data?.camposCustomizados ?? []).flatMap((c: any) => {
          const cf = fmap.get(String(c.idCampoCustomizado));
          return cf ? [{ custom_field_id: cf, id_vinculo: c.idVinculo ? String(c.idVinculo) : null, valor: c.valor ?? null }] : [];
        }) });
      }
      // Uma única transação para o lote; remove também valores que o Bling esvaziou.
      if (snapshots.length) {
        const { error } = await db.rpc("save_custom_field_snapshots", { _company_id: job.company_id, _snapshots: snapshots });
        if (error) throw new Error(error.message);
      }
      done += chunk.length;
      cursor = chunk[chunk.length - 1].id;
      const { error: progressError } = await db.from("bling_custom_field_jobs").update({ cursor_id: cursor, done_count: done, error_count: errors }).eq("id", job.id).eq("status", "executando");
      if (progressError) throw new Error(progressError.message);
    }
  }
  return false;
}

type CfLog = { product_id: string; codigo?: string | null; nome?: string | null; ok: boolean; campos: string; erro?: string | null; status?: number | null; ms?: number | null };
/** Registra cada gravação de campos no Bling para aparecer nos Logs de envio. Falha aqui nunca interrompe o job. */
async function logCf(job: Job, rows: CfLog[]) {
  if (rows.length === 0) return;
  try {
    await db.from("bling_custom_field_logs").insert(rows.map((r) => ({
      company_id: job.company_id, job_id: job.id, product_id: r.product_id, product_codigo: r.codigo ?? null,
      product_nome: r.nome ?? null, status: r.ok ? "concluido" : "erro", campos: r.campos.slice(0, 1000),
      erro: r.erro ?? null, response_status: r.status ?? null, duration_ms: r.ms ?? null,
    })));
  } catch { /* log é auxiliar */ }
}

async function runPush(job: Job, integ: BlingIntegrationRow, deadline: number) {
  const { data: cf } = await db.from("bling_custom_fields").select("id, bling_id_campo, nome").eq("id", job.field_id).maybeSingle();
  if (!cf) throw new Error("Campo customizado não encontrado");
  let done = job.done_count;
  let errors = job.error_count;
  while (Date.now() < deadline) {
    if (await isStopped(job.id)) return false;
    const { data: items } = await db.from("bling_custom_field_push_items").select("product_id")
      .eq("job_id", job.id).eq("status", "pendente").limit(30);
    const ids = ((items ?? []) as { product_id: string }[]).map((i) => i.product_id);
    if (ids.length === 0) return true;
    const { data: prods } = await db.from("bling_products").select("id, bling_product_id, codigo, nome").in("id", ids);
    const list = (prods ?? []) as { id: string; bling_product_id: string; codigo: string | null; nome: string | null }[];
    for (let i = 0; i < list.length; i += 3) {
      if (Date.now() >= deadline) break;
      const chunk = list.slice(i, i + 3);
      const t0 = Date.now();
      const res = await Promise.all(chunk.map((p) => blingApiRequest<any>(integ, "PATCH", `/produtos/${encodeURIComponent(p.bling_product_id)}`, {
        camposCustomizados: [{ idCampoCustomizado: Number(cf.bling_id_campo), valor: job.valor ?? "" }],
      })));
      const ms = Date.now() - t0;
      await logCf(job, chunk.map((p, k) => ({
        product_id: p.id, codigo: p.codigo, nome: p.nome, ok: res[k].ok, ms, status: res[k].status,
        campos: `${(cf as any).nome ?? "Campo"}: ${job.valor ?? ""}`,
        erro: res[k].ok ? null : JSON.stringify((res[k] as any).data ?? (res[k] as any).error ?? res[k].status).slice(0, 300),
      })));
      for (let k = 0; k < chunk.length; k++) {
        const r = res[k];
        const p = chunk[k];
        if (r.ok) {
          done++;
          await db.from("bling_custom_field_push_items").update({ status: "ok", erro: null }).eq("job_id", job.id).eq("product_id", p.id);
          await db.from("bling_product_custom_values").upsert(
            { company_id: job.company_id, product_id: p.id, custom_field_id: cf.id, valor: job.valor, dirty: false },
            { onConflict: "product_id,custom_field_id" },
          );
        } else {
          if (r.status === 401) throw new Error("HTTP 401 ao gravar no Bling");
          errors++;
          const msg = JSON.stringify((r as any).data ?? (r as any).error ?? r.status).slice(0, 300);
          await db.from("bling_custom_field_push_items").update({ status: "erro", erro: msg }).eq("job_id", job.id).eq("product_id", p.id);
        }
      }
    }
    await db.from("bling_custom_field_jobs").update({ done_count: done, error_count: errors }).eq("id", job.id);
  }
  return false;
}

function similarity(a: string, b: string) {
  const tok = (s: string) => new Set(s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((t) => t.length >= 2));
  const A = tok(a), B = tok(b);
  if (!A.size || !B.size) return 0;
  let w = 0, tot = 0;
  for (const t of A) { const k = /\d/.test(t) ? 3 : 1; tot += k; if (B.has(t)) w += k; }
  return w / tot;
}

async function mlModel(token: string, ean: string | null, titulo: string | null): Promise<string | null> {
  const pick = async (x: any) => {
    let m = (x?.attributes ?? []).find((a: any) => a?.id === "MODEL")?.value_name;
    if (!m && x?.id) {
      const d = await fetch(`https://api.mercadolibre.com/products/${x.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (d.ok) m = ((await d.json()) as any)?.attributes?.find((a: any) => a?.id === "MODEL")?.value_name;
    }
    return m ? String(m).trim().slice(0, 100) : null;
  };
  const g = (ean ?? "").replace(/\D/g, "");
  if (g.length >= 8) {
    const r = await fetch(`https://api.mercadolibre.com/products/search?site_id=MLB&status=active&product_identifier=${g}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const matches = (((await r.json()) as any)?.results ?? []) as any[];
      for (const x of matches.slice(0, 10)) {
        const codes = (x.attributes ?? []).filter((a: any) => a.id === "GTIN")
          .flatMap((a: any) => String(a.value_name ?? "").split(/[,;\s]+/).map((v) => v.replace(/\D/g, "")));
        if (!codes.includes(g)) continue;
        const m = await pick(x);
        if (m) return m;
      }
    }
  }
  if (titulo) {
    const r = await fetch(`https://api.mercadolibre.com/products/search?site_id=MLB&status=active&q=${encodeURIComponent(titulo.slice(0, 120))}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const res = (((await r.json()) as any)?.results ?? []).slice(0, 10) as any[];
      const best = res.map((x) => ({ x, s: similarity(titulo, String(x.name ?? "")) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= 0.6) return pick(best.x);
    }
  }
  return null;
}

async function runAuto(job: Job, integ: BlingIntegrationRow, deadline: number) {
  const { data: roles } = await db.from("bling_custom_field_roles")
    .select("role, custom_field_id, valor, bling_custom_fields(bling_id_campo, nome)").eq("company_id", job.company_id);
  const roleList = ((roles ?? []) as any[]).map((r) => ({ role: r.role as string, cf: r.custom_field_id as string, bid: Number(r.bling_custom_fields?.bling_id_campo), valor: (r.valor as string | null) ?? null, nome: (r.bling_custom_fields?.nome as string | null) ?? r.role }));
  if (roleList.length === 0) throw new Error("Nenhum campo configurado. Aponte os campos antes de atualizar.");
  const needModel = roleList.some((r) => r.role === "modelo");
  let mlToken: string | null = null;
  if (needModel) {
    try { const { getMlAccessToken } = await import("@/lib/mercadolivre.server"); mlToken = await getMlAccessToken(); } catch { mlToken = null; }
  }
  let done = job.done_count;
  let errors = job.error_count;
  while (Date.now() < deadline) {
    if (await isStopped(job.id)) return false;
    const { data: items } = await db.from("bling_custom_field_push_items").select("product_id")
      .eq("job_id", job.id).eq("status", "pendente").limit(15);
    const ids = ((items ?? []) as { product_id: string }[]).map((i) => i.product_id);
    if (ids.length === 0) return true;
    const { data: base, error } = await db.rpc("custom_field_auto_base", { _product_ids: ids });
    if (error) throw new Error(error.message);
    const list = (base ?? []) as any[];
    const missing = ids.filter((id) => !list.some((b) => b.product_id === id));
    for (const id of missing) {
      errors++;
      await db.from("bling_custom_field_push_items").update({ status: "erro", erro: "Produto sem ID no Bling" }).eq("job_id", job.id).eq("product_id", id);
    }
    for (let i = 0; i < list.length; i += 3) {
      if (Date.now() >= deadline) break;
      const chunk = list.slice(i, i + 3);
      // Valores já gravados no Bling: só reenvia o que realmente mudou.
      const { data: currentRows } = await db.from("bling_product_custom_values")
        .select("product_id, custom_field_id, valor")
        .in("product_id", chunk.map((b) => b.product_id))
        .in("custom_field_id", roleList.map((r) => r.cf));
      const current = new Map<string, Map<string, string>>();
      for (const row of (currentRows ?? []) as { product_id: string; custom_field_id: string; valor: string | null }[]) {
        if (!current.has(row.product_id)) current.set(row.product_id, new Map());
        current.get(row.product_id)!.set(row.custom_field_id, row.valor ?? "");
      }
      await Promise.all(chunk.map(async (b) => {
        let modelo: string | null = b.modelo_fornecedor ?? null;
        if (!modelo && needModel && mlToken) {
          try { modelo = await mlModel(mlToken, b.gtin, b.nome_fornecedor ?? b.nome); } catch { modelo = null; }
        }
        const values = autoCustomFieldValues(roleList, { anatel: b.anatel, modelo });
        const changed = values.filter((v) => (current.get(b.product_id)?.get(v.cf) ?? "") !== v.valor);
        if (changed.length === 0) {
          // Nada mudou: não chama o Bling, só marca como conferido.
          done++;
          await db.from("bling_custom_field_push_items").update({ status: "ok", erro: null }).eq("job_id", job.id).eq("product_id", b.product_id);
          return;
        }
        const t0 = Date.now();
        const res = await blingApiRequest<any>(integ, "PATCH", `/produtos/${encodeURIComponent(b.bling_product_id)}`, {
          camposCustomizados: changed.map((v) => ({ idCampoCustomizado: v.bid, valor: v.valor })),
        });
        const nomes = new Map(roleList.map((r) => [r.cf, r.nome]));
        await logCf(job, [{
          product_id: b.product_id, codigo: b.codigo, nome: b.nome, ok: res.ok, status: res.status, ms: Date.now() - t0,
          campos: changed.map((v) => `${nomes.get(v.cf) ?? "Campo"}: ${v.valor}`).join(" · "),
          erro: res.ok ? null : JSON.stringify((res as any).data ?? (res as any).error ?? res.status).slice(0, 300),
        }]);
        if (res.ok) {
          const semModelo = needModel && !modelo ? "Modelo não encontrado (demais campos gravados)" : null;
          if (semModelo) errors++; else done++;
          await db.from("bling_custom_field_push_items").update({ status: semModelo ? "erro" : "ok", erro: semModelo }).eq("job_id", job.id).eq("product_id", b.product_id);
          await db.from("bling_product_custom_values").upsert(
            changed.map((v) => ({ company_id: job.company_id, product_id: b.product_id, custom_field_id: v.cf, valor: v.valor, dirty: false })),
            { onConflict: "product_id,custom_field_id" },
          );
        } else {
          if (res.status === 401) throw new Error("HTTP 401 ao gravar no Bling");
          errors++;
          const msg = JSON.stringify((res as any).data ?? (res as any).error ?? res.status).slice(0, 300);
          await db.from("bling_custom_field_push_items").update({ status: "erro", erro: msg }).eq("job_id", job.id).eq("product_id", b.product_id);
        }
      }));
    }
    await db.from("bling_custom_field_jobs").update({ done_count: done, error_count: errors }).eq("id", job.id);
  }
  return false;
}

export async function processCustomFieldTick(jobId: string, budgetMs = 45_000) {
  const job = await claim(jobId);
  if (!job) return { done: false, busy: true, stopped: await isStopped(jobId) };
  const { data: integ } = await db.from("bling_integrations").select("*").eq("id", job.integration_id).maybeSingle();
  if (!integ) {
    await db.from("bling_custom_field_jobs").update({ status: "erro", last_error: "Integração não encontrada", lease_until: null }).eq("id", jobId);
    return { done: true, stopped: true };
  }
  const deadline = Date.now() + budgetMs;
  try {
    const finished = job.kind === "sync" ? await runSync(job, integ, deadline) : job.kind === "auto" ? await runAuto(job, integ, deadline) : await runPush(job, integ, deadline);
    if (finished) {
      await db.from("bling_custom_field_jobs").update({ status: "concluido", finished_at: new Date().toISOString(), lease_until: null, last_error: null }).eq("id", jobId).eq("status", "executando");
      return { done: true };
    }
  } catch (e) {
    await db.from("bling_custom_field_jobs").update({ status: "erro", last_error: e instanceof Error ? e.message : String(e), lease_until: null }).eq("id", jobId).eq("status", "executando");
    return { done: true, stopped: true };
  }
  await db.from("bling_custom_field_jobs").update({ lease_until: null }).eq("id", jobId);
  return { done: false, stopped: await isStopped(jobId) };
}

export async function enqueueCustomFieldTick(jobId: string, origin?: string) {
  const base = (process.env.APP_PUBLIC_URL ?? origin ?? "").replace(/\/$/, "");
  const secret = process.env.BLING_WORKER_SECRET ?? "";
  if (!base || !secret) return false;
  await db.rpc("enqueue_http_job", { _url: `${base}/api/public/bling/custom-fields-tick`, _secret: secret, _body: { job_id: jobId } });
  return true;
}

/** Company's auto custom-field roles, with the field definition (list options) for validation. */
async function loadAutoRoles(companyId: string): Promise<AutoFieldRole[]> {
  const { data: roles } = await db.from("bling_custom_field_roles")
    .select("role, custom_field_id, valor, bling_custom_fields(bling_id_campo, nome, tipo_campo_id, opcoes)").eq("company_id", companyId);
  return ((roles ?? []) as any[]).map((r) => ({
    role: r.role as string, cf: r.custom_field_id as string, bid: Number(r.bling_custom_fields?.bling_id_campo),
    valor: (r.valor as string | null) ?? null, nome: (r.bling_custom_fields?.nome as string | null) ?? r.role,
    field: { tipo_campo_id: r.bling_custom_fields?.tipo_campo_id ?? null, opcoes: r.bling_custom_fields?.opcoes ?? null },
  }));
}

/**
 * Values the automatic custom-field update would write, computed for a product being created,
 * so it reaches Bling already filled. Empty when the company has no field mapping.
 */
export async function creationCustomFields(companyId: string, productId: string) {
  const roles = await loadAutoRoles(companyId);
  if (!roles.length) return [];
  const { data: base, error } = await db.rpc("custom_field_auto_base", { _product_ids: [productId] });
  if (error) throw new Error(error.message);
  const b = ((base ?? []) as any[])[0];
  if (!b) return [];
  let modelo: string | null = b.modelo_fornecedor ?? null;
  if (!modelo && roles.some((r) => r.role === "modelo")) {
    try {
      const { getMlAccessToken } = await import("@/lib/mercadolivre.server");
      modelo = await mlModel(await getMlAccessToken(), b.gtin, b.nome_fornecedor ?? b.nome);
    } catch { modelo = null; }
  }
  return creationCustomFieldValues(roles, { anatel: b.anatel, modelo });
}

/** Records the values written at creation so later automatic runs do not resend them. */
export async function saveCreatedCustomFields(companyId: string, productId: string, values: { cf: string; valor: string }[]) {
  if (!values.length) return;
  await db.from("bling_product_custom_values").upsert(
    values.map((v) => ({ company_id: companyId, product_id: productId, custom_field_id: v.cf, valor: v.valor, dirty: false })),
    { onConflict: "product_id,custom_field_id" },
  );
}
