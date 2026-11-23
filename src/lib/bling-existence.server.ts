import {supabaseAdmin} from '@/integrations/supabase/client.server';
import {blingApiGet,type BlingIntegrationRow} from './bling.server';
import {hasMatchingProduct,isConfirmedMissing} from './bling-existence-check';
const db=supabaseAdmin as any;
function check(r:any) {if(r.error) throw new Error(r.error.message);return r.data;}
export async function processExistenceTick(jobId?:string) {
 const now=new Date().toISOString(), token=crypto.randomUUID();
 let q=db.from('bling_existence_jobs').select('*').eq('status','executando').lte('next_tick_at',now)
   // Oldest due turn first: recently processed companies go behind waiting ones.
   .or(`lease_until.is.null,lease_until.lt.${now}`).order('next_tick_at').order('started_at').order('id').limit(1);
 if(jobId)q=q.eq('id',jobId);
 const candidate=check(await q.maybeSingle()); if(!candidate)return {done:true};
 const job=check(await db.from('bling_existence_jobs').update({lease_token:token,lease_until:new Date(Date.now()+90000).toISOString(),heartbeat_at:now})
 .eq('id',candidate.id).eq('status','executando').or(`lease_until.is.null,lease_until.lt.${now}`).select('*').maybeSingle());
 if(!job)return {done:false,busy:true};
 const active=async()=>{const j=check(await db.from('bling_existence_jobs').select('status,lease_token').eq('id',job.id).single());return j.status==='executando' && j.lease_token===token;};
 const heartbeat=setInterval(async()=>{try{if(await active())check(await db.from('bling_existence_jobs').update({lease_until:new Date(Date.now()+90000).toISOString(),heartbeat_at:new Date().toISOString()}).eq('id',job.id).eq('lease_token',token));}catch{}},10000);
 try {
  const integ=check(await db.from('bling_integrations').select('*').eq('id',job.integration_id).eq('company_id',job.company_id).single()) as BlingIntegrationRow;
  const items=check(await db.from('bling_existence_items').select('*').eq('job_id',job.id).eq('status','pendente').order('product_id').limit(20));
  if(!items.length){check(await db.from('bling_existence_jobs').update({status:'concluido',finished_at:new Date().toISOString()}).eq('id',job.id).eq('lease_token',token).eq('status','executando'));return {done:true};}
  // Validate company API access before accepting any missing-product response.
  const health=await blingApiGet<any>(integ,'/produtos?pagina=1&limite=1');
  if(!health.ok || !Array.isArray(health.data?.data))throw new Error(`Bling não confirmou acesso aos produtos (HTTP ${health.status}). Nenhum produto excluído nesta rodada.`);
  const deadline=Date.now()+30000;
  for(const i of items){
   if(Date.now()>deadline || !(await active()))break;
   let status='ignorado', http:number|null=null, evidence:any=null, error:string|null=null;
   if(!i.bling_product_id || !/^\d+$/.test(i.bling_product_id))error='Produto sem ID válido no Bling; mantido no sistema.';
   else {
    const first=await blingApiGet(integ,`/produtos/${i.bling_product_id}`);http=first.status;
    if(hasMatchingProduct(first,i.bling_product_id))status='existe';
    else if(isConfirmedMissing(first)){
     if(!(await active()))break;
     const second=await blingApiGet(integ,`/produtos/${i.bling_product_id}`);
     if(isConfirmedMissing(second)) {status='excluido'; evidence={confirmed_twice:true,health_ok:true,bling_product_id:i.bling_product_id,first:first.responseBodySafe,second:second.responseBodySafe};}
     else if(hasMatchingProduct(second,i.bling_product_id))status='existe';
     else throw new Error(`Não foi possível confirmar a ausência de ${i.codigo ?? i.bling_product_id} (HTTP ${second.status}). Produto mantido.`);
    } else if([401,403,429].includes(first.status) || first.status===0 || first.status>=500)throw new Error(`Verificação interrompida no produto ${i.codigo ?? i.bling_product_id}: HTTP ${first.status}. Produto mantido. ${first.errorMessage ?? ''}`);
    else {status='erro';error=`Resposta inconclusiva do Bling (HTTP ${first.status}). Produto mantido.`;}
   }
   const completed=check(await db.rpc('finish_bling_existence_item',{_job_id:job.id,_token:token,_product_id:i.product_id,_status:status,_http:http,_evidence:evidence,_error:error}));
   if(!completed)break;
  }
  check(await db.from('bling_existence_jobs').update({next_tick_at:new Date(Date.now()+2000).toISOString()}).eq('id',job.id).eq('lease_token',token));
  return {done:false};
 }catch(e){
  check(await db.from('bling_existence_jobs').update({status:'pausado',last_error:e instanceof Error?e.message:String(e)}).eq('id',job.id).eq('lease_token',token).eq('status','executando'));
  return {done:true,stopped:true};
 }finally{clearInterval(heartbeat);check(await db.from('bling_existence_jobs').update({lease_until:null,lease_token:null}).eq('id',job.id).eq('lease_token',token));}
}
