/** Durable, single-flight category suggestions; never writes to Bling or approves products. */
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { classifyOfficialCategory, CategoryAiError } from './category-ai/classify.server';
import { officialCategory } from './category-ai/taxonomy.server';
import { suggestMlCategory } from './categories.server';
const db = supabaseAdmin as any;
const LEASE_MS = 90_000;
function checked<T extends { error?: { message: string } | null }>(r: T): T { if (r.error) throw new Error(r.error.message); return r; }

export async function enqueueCategoryTick(jobId: string, origin?: string) {
  const base = (process.env.APP_PUBLIC_URL ?? origin ?? '').replace(/\/$/, '');
  const secret = process.env.BLING_WORKER_SECRET ?? '';
  if (!base || !secret) throw new Error('Execução de categorias não configurada.');
  checked(await db.rpc('enqueue_category_tick', { _url: `${base}/api/public/categories/tick`, _secret: secret, _body: { job_id: jobId } }));
}

export async function processCategoryTick(requestedId?: string) {
  const now = new Date();
  const token = crypto.randomUUID(); // ownership fence, not an AI run ID
  let q = db.from('product_category_jobs').select('*').eq('status', 'executando')
    .lte('next_tick_at', now.toISOString()).or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .order('started_at').limit(1);
  if (requestedId) q = q.eq('id', requestedId);
  const candidate = checked(await q.maybeSingle()).data;
  if (!candidate) return { done: true };
  const job = checked(await db.from('product_category_jobs').update({ lease_token: token, lease_until: new Date(Date.now() + LEASE_MS).toISOString(), heartbeat_at: now.toISOString() })
    .eq('id', candidate.id).eq('status', 'executando').lte('next_tick_at', now.toISOString())
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`).select('*').maybeSingle()).data;
  if (!job) return { done: false, busy: true };
  const controller = new AbortController();
  const running = async () => {
    const { data } = checked(await db.from('product_category_jobs').select('status,lease_token').eq('id', job.id).single());
    return data.status === 'executando' && data.lease_token === token;
  };
  // Only explicit pause/cancel/ownership loss aborts; no AI timeout or timeout retry.
  const heartbeat = setInterval(async () => {
    try {
      if (!(await running())) { controller.abort(); return; }
      checked(await db.from('product_category_jobs').update({ lease_until: new Date(Date.now() + LEASE_MS).toISOString(), heartbeat_at: new Date().toISOString() }).eq('id', job.id).eq('lease_token', token));
    } catch { controller.abort(); }
  }, 3000);
  try {
    const { data: items } = checked(await db.from('product_category_job_items').select('product_id').eq('job_id', job.id).eq('status', 'pendente').order('product_id').limit(3));
    if (!items.length) {
      checked(await db.from('product_category_jobs').update({ status: 'concluido', finished_at: new Date().toISOString() }).eq('id', job.id).eq('lease_token', token).eq('status','executando'));
      return { done: true };
    }
    const { getMlAccessToken } = await import('./mercadolivre.server');
    const mlToken = await getMlAccessToken().catch(() => null);
    for (const item of items) {
      if (!(await running())) return { done: true, stopped: true };
      const p = checked(await db.from('bling_products').select('id,codigo,nome,gtin').eq('id', item.product_id).eq('company_id',job.company_id).single()).data;
      const names = checked(await db.rpc('supplier_product_names', { _skus: p.codigo ? [p.codigo] : [] })).data;
      const supplier = names?.find((r: any) => r.sku === p.codigo)?.nome?.trim();
      const title = supplier || p.nome || '';
      let row: Record<string, unknown> = { nome_busca: title, nome_origem: supplier ? 'fornecedor' : 'produto' };
      try {
        let suggestion;
        try { suggestion = await suggestMlCategory(mlToken, p.gtin, title); }
        catch(e) { if(!job.use_ai) throw e; suggestion={category_id:null,category_path:null,ml_product_id:null,ml_product_title:null,match_by:null,error:e instanceof Error?e.message:"Falha no Mercado Livre"}; }
        if (!suggestion.category_id && job.use_ai && title.length >= 3) {
          const access = checked(await db.from('category_ai_access').select('*').eq('id',true).single()).data;
          if (access.blocked_reason) throw new CategoryAiError(access.message, 403, access.blocked_reason);
          const key = process.env.LOVABLE_API_KEY;
          if (!key) throw new CategoryAiError('A chave da IA não está configurada.',401,'configuration');
          const ai = await classifyOfficialCategory(title, controller.signal, key);
          if (ai) suggestion = { ...suggestion, ...ai, ml_product_id: null, ml_product_title: null, match_by: 'ia' as any, error: null };
        }
        const official = suggestion.category_id ? officialCategory(suggestion.category_id) : null;
        row = official?.leaf ? { ...row, status:'encontrado', ...suggestion, category_path:official.path, erro:null }
          : { ...row, status:'sem', erro:'Nenhuma categoria oficial identificada com segurança.' };
      } catch(e) {
        if (controller.signal.aborted) return { done:true,stopped:true };
        if (e instanceof CategoryAiError) {
          if (['credits','policy','access'].includes(e.reason)) {
            checked(await db.from('category_ai_access').update({blocked_reason:e.reason,message:e.message,updated_at:new Date().toISOString()}).eq('id',true));
            checked(await db.from('product_category_jobs').update({status:'pausado',blocked_reason:e.reason,last_error:e.message}).eq('status','executando').eq('use_ai',true));
          } else if (['rate','transient'].includes(e.reason)) {
            const attempts=(job.retry_count ?? 0)+1;
            checked(await db.from('product_category_jobs').update({retry_count:attempts, status:attempts>=3?'pausado':'executando',blocked_reason:attempts>=3?'rate':null,next_tick_at:new Date(Date.now()+Math.max(60,e.retryAfter)*1000*2**(attempts-1)).toISOString(),last_error:e.message}).eq('id',job.id));
          } else checked(await db.from('product_category_jobs').update({status:'pausado',blocked_reason:e.reason,last_error:e.message}).eq('id',job.id));
          return { done:true,stopped:true };
        }
        row = { ...row, status:'erro',erro:e instanceof Error?e.message:String(e) };
      }
      if (job.retry_count) checked(await db.from('product_category_jobs').update({retry_count:0,last_error:null}).eq('id',job.id).eq('lease_token',token));
      const completed = checked(await db.rpc('complete_category_item',{_job_id:job.id,_token:token,_product_id:item.product_id,_result:row})).data;
      if (!completed) return {done:true,stopped:true};
    }
    checked(await db.from('product_category_jobs').update({next_tick_at:new Date(Date.now()+2000).toISOString()}).eq('id',job.id).eq('lease_token',token));
    return {done:false};
  } catch(e) {
    if (controller.signal.aborted) return {done:true,stopped:true};
    checked(await db.from('product_category_jobs').update({status:'erro',last_error:e instanceof Error?e.message:String(e)}).eq('id',job.id).eq('lease_token',token).eq('status','executando'));
    return {done:true,stopped:true};
  } finally {
    clearInterval(heartbeat);
    checked(await db.from('product_category_jobs').update({lease_until:null,lease_token:null}).eq('id',job.id).eq('lease_token',token));
  }
}
