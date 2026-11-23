import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const company = z.object({ company_id: z.string().uuid() });
async function checkCompany(context: { supabase: any; userId: string }, id: string) {
  const { data, error } = await context.supabase.from("company_users").select("id")
    .eq("company_id", id).eq("user_id", context.userId).eq("ativo", true).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sem acesso a esta empresa.");
}

async function supplierTitles(db: any, products: { codigo: string | null }[]) {
  const { data, error } = await db.rpc("supplier_product_names", {
    _skus: products.map((p) => p.codigo).filter(Boolean),
  });
  if (error) throw new Error(`Não foi possível consultar os nomes no fornecedor: ${error.message}`);
  return new Map<string, string>(((data ?? []) as { sku: string; nome: string }[])
    .filter((r) => r.nome?.trim()).map((r) => [r.sku, r.nome.trim()]));
}

export const listProductCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => company.extend({ search: z.string().max(100).default(""), page: z.number().int().min(0).default(0), only_missing: z.boolean().default(false) }).parse(input))
  .handler(async ({ data, context }) => {
    await checkCompany(context, data.company_id);
    const db = context.supabase;
    const start = data.page * 30;
    let q = db.from("bling_products").select("id,codigo,nome,gtin,categoria_produto,product_ml_categories(ml_category_id,ml_category_path,ml_product_id,ml_product_title,match_by,updated_at)", { count: "exact" })
      .eq("company_id", data.company_id).order("codigo").range(start, start + 29);
    if (data.only_missing) q = q.is("product_ml_categories", null);
    if (data.search.trim()) q = q.or(`codigo.ilike.%${data.search.replace(/[,().%_]/g, "")}%,nome.ilike.%${data.search.replace(/[,().%_]/g, "")}%`);
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

export const suggestProductCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => company.extend({ product_ids: z.array(z.string().uuid()).min(1).max(30) }).parse(input))
  .handler(async ({ data, context }) => {
    await checkCompany(context, data.company_id);
    const { data: products, error } = await context.supabase.from("bling_products")
      .select("id,codigo,nome,gtin").eq("company_id", data.company_id).in("id", data.product_ids);
    if (error) throw new Error(error.message);
    const { getMlAccessToken } = await import("@/lib/mercadolivre.server");
    const { suggestMlCategory } = await import("@/lib/categories.server");
    const token = await getMlAccessToken().catch(() => null);
    const names = await supplierTitles(context.supabase, products ?? []);
    const suggestions = [];
    for (const p of products ?? []) {
      const supplierName = names.get(p.codigo ?? "");
      const title = supplierName || p.nome;
      try {
        suggestions.push({ id: p.id, sku: p.codigo, nome: title, nome_origem: supplierName ? "fornecedor" : "produto",
          ...(await suggestMlCategory(token, p.gtin, title)) });
      } catch (e) {
        suggestions.push({ id: p.id, sku: p.codigo, nome: title, nome_origem: supplierName ? "fornecedor" : "produto",
          category_id: null, category_path: null, ml_product_id: null, ml_product_title: null, match_by: null,
          error: e instanceof Error ? e.message : "Falha na consulta" });
      }
    }
    return suggestions;
  });

export const saveProductCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => company.extend({ items: z.array(z.object({
    id: z.string().uuid(), category_id: z.string().min(2).max(80), category_path: z.string().min(1).max(500),
    ml_product_id: z.string().min(2).max(80).nullable(), ml_product_title: z.string().min(1).max(500).nullable(), match_by: z.enum(["ean", "titulo", "categoria"]),
  })).min(1).max(30) }).parse(input))
  .handler(async ({ data, context }) => {
    await checkCompany(context, data.company_id);
    const { data: products, error: productError } = await context.supabase.from("bling_products")
      .select("id,codigo,nome,gtin").eq("company_id", data.company_id).in("id", data.items.map((i) => i.id));
    if (productError) throw new Error(productError.message);
    if (products?.length !== data.items.length || new Set(data.items.map((i) => i.id)).size !== data.items.length) throw new Error("Produto fora da empresa selecionada.");
    const { getMlAccessToken } = await import("@/lib/mercadolivre.server");
    const { suggestMlCategory } = await import("@/lib/categories.server");
    const token = await getMlAccessToken().catch(() => null);
    const names = await supplierTitles(context.supabase, products);
    for (const item of data.items) {
      const product = products.find((p) => p.id === item.id);
      if (!product) throw new Error("Produto não encontrado.");
      const fresh = await suggestMlCategory(token, product.gtin, names.get(product.codigo ?? "") || product.nome);
      if (fresh.category_id !== item.category_id || fresh.ml_product_id !== item.ml_product_id || fresh.match_by !== item.match_by) {
        throw new Error(`A sugestão do produto ${product.codigo ?? ""} mudou. Busque novamente antes de salvar.`);
      }
    }
    const { error } = await (context.supabase as any).from("product_ml_categories").upsert(data.items.map((i) => ({
      product_id: i.id, company_id: data.company_id, ml_category_id: i.category_id,
      ml_category_path: i.category_path, ml_product_id: i.ml_product_id,
      ml_product_title: i.ml_product_title, match_by: i.match_by, updated_by: context.userId, updated_at: new Date().toISOString(),
    })), { onConflict: "product_id" });
    if (error) throw new Error(error.message);
    return { saved: data.items.length };
  });
/* ===================== Categorização em lote ===================== */

async function kick(jobId: string) {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { enqueueCategoryTick } = await import("@/lib/category-jobs.server");
  let origin: string | undefined;
  try { origin = new URL(getRequest().url).origin; } catch { /* sem request */ }
  await enqueueCategoryTick(jobId, origin);
}

export const startCategoryJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => company.extend({
    product_ids: z.array(z.string().uuid()).min(1).max(5000).nullable(),
    search: z.string().max(100).default(""), only_missing: z.boolean().default(false), use_ai: z.boolean().default(true),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await checkCompany(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: jobId, error } = await (supabaseAdmin as any).rpc("start_product_category_job", {
      _company_id: data.company_id, _user_id: context.userId, _product_ids: data.product_ids,
      _search: data.search.replace(/[,().%_]/g, ""), _only_missing: data.only_missing, _use_ai: data.use_ai,
    });
    if (error) throw new Error(error.message);
    try { await kick(jobId as string); } catch (e) {
      await (supabaseAdmin as any).from("product_category_jobs").update({status:"erro",last_error:e instanceof Error?e.message:"Falha ao iniciar"}).eq("id",jobId);
      throw e;
    }
    return { job_id: jobId as string };
  });

export const getCategoryJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => company.parse(input))
  .handler(async ({ data, context }) => {
    await checkCompany(context, data.company_id);
    const { data: job, error: jobError } = await (context.supabase as any).from("product_category_jobs")
      .select("id,status,use_ai,total,done_count,found_count,error_count,last_error,blocked_reason,lease_until,heartbeat_at,started_at,finished_at")
      .eq("company_id", data.company_id).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return null;
    const { count, error: countError } = await (context.supabase as any).from("product_category_job_items").select("product_id", { count: "exact", head: true })
      .eq("job_id", job.id).eq("status", "encontrado").eq("review", "pendente");
    if(countError) throw new Error(countError.message);
    return { ...job, to_review: count ?? 0 };
  });

export const controlCategoryJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => company.extend({ job_id: z.string().uuid(), action: z.enum(["pause", "resume", "cancel"]) }).parse(input))
  .handler(async ({ data, context }) => {
    await checkCompany(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const status = data.action === "pause" ? "pausado" : data.action === "resume" ? "executando" : "cancelado";
    const from = data.action === "resume" ? ["pausado", "erro"] : ["executando", "pausado", "erro"];
    if (data.action === "resume") {
      const {data: blocked} = await (supabaseAdmin as any).from("product_category_jobs").select("blocked_reason,created_by").eq("id",data.job_id).eq("company_id",data.company_id).single();
      if (["access", "refusal", "configuration"].includes(blocked?.blocked_reason)) throw new Error("Esta tarefa foi interrompida pela IA. Resolva o aviso antes de iniciar uma nova busca.");
      if (["credits", "policy"].includes(blocked?.blocked_reason) && blocked.created_by!==context.userId) throw new Error("Somente quem iniciou a tarefa pode retomar após este bloqueio.");
      if (["credits", "policy"].includes(blocked?.blocked_reason)) await (supabaseAdmin as any).from("category_ai_access").update({blocked_reason:null,message:null}).eq("id",true).in("blocked_reason",["credits","policy"]);
    }
    const { error } = await (supabaseAdmin as any).from("product_category_jobs")
      .update({ status, next_tick_at: new Date().toISOString(), blocked_reason:null, heartbeat_at: new Date().toISOString(), ...(status === "cancelado" ? { finished_at: new Date().toISOString() } : {}) })
      .eq("id", data.job_id).eq("company_id", data.company_id).in("status", from);
    if (error) throw new Error(error.message);
    if (data.action === "resume") await kick(data.job_id);
    return { ok: true };
  });

export const listCategoryJobItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => company.extend({ job_id: z.string().uuid(), kind: z.enum(["revisar", "sem"]), page: z.number().int().min(0).default(0) }).parse(input))
  .handler(async ({ data, context }) => {
    await checkCompany(context, data.company_id);
    let q = (context.supabase as any).from("product_category_job_items")
      .select("product_id,status,nome_busca,nome_origem,category_id,category_path,ml_product_title,match_by,erro,bling_products(codigo,nome)", { count: "exact" })
      .eq("job_id", data.job_id).eq("company_id", data.company_id).order("product_id").range(data.page * 50, data.page * 50 + 49);
    q = data.kind === "revisar" ? q.eq("status", "encontrado").eq("review", "pendente") : q.in("status", ["sem", "erro"]);
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

export const reviewCategoryJobItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => company.extend({
    job_id: z.string().uuid(), action: z.enum(["save", "discard"]), product_ids: z.array(z.string().uuid()).min(1).max(5000),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await checkCompany(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {data: count, error} = await (supabaseAdmin as any).rpc("review_category_items", {
      _company_id:data.company_id,_user_id:context.userId,_job_id:data.job_id,_ids:data.product_ids,_action:data.action,
    });
    if(error) throw new Error(error.message);
    return {count:count as number};
  });

export const searchOfficialCategories = createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .inputValidator((input:unknown)=>company.extend({search:z.string().min(2).max(100)}).parse(input))
  .handler(async({data,context})=>{
    await checkCompany(context,data.company_id);
    const {searchTaxonomy}=await import("./category-ai/taxonomy.server");
    return searchTaxonomy(data.search);
  });

export const listOfficialCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => company.extend({ search: z.string().max(100).default(""), root: z.string().max(80).default(""), page: z.number().int().min(0).default(0) }).parse(input))
  .handler(async ({ data, context }) => {
    await checkCompany(context, data.company_id);
    const { browseTaxonomy } = await import("./category-ai/taxonomy.server");
    return browseTaxonomy(data.search, data.root, data.page);
  });

export const chooseCategorySuggestion = createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((input:unknown)=>company.extend({job_id:z.string().uuid(),product_id:z.string().uuid(),category_id:z.string().regex(/^MLB\d+$/)}).parse(input))
  .handler(async({data,context})=>{
    await checkCompany(context,data.company_id);
    const {officialCategory}=await import("./category-ai/taxonomy.server");
    const c=officialCategory(data.category_id);
    if(!c?.leaf) throw new Error("Selecione uma categoria final da lista oficial.");
    const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
    const {data:changed,error}=await (supabaseAdmin as any).from("product_category_job_items").update({
      status:"encontrado",review:"pendente",category_id:c.id,category_path:c.path,match_by:"categoria",ml_product_id:null,ml_product_title:null,erro:null,
    }).eq("company_id",data.company_id).eq("job_id",data.job_id).eq("product_id",data.product_id).in("status",["sem","erro"]).select("product_id").maybeSingle();
    if(error) throw new Error(error.message);
    if(!changed) throw new Error("Produto não disponível para revisão.");
    const {error:recountError}=await (supabaseAdmin as any).rpc("recount_category_job",{_job_id:data.job_id});
    if(recountError) throw new Error(recountError.message);
    return {ok:true};
  });
