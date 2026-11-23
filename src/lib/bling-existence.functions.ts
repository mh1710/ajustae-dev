import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';
const company=z.object({company_id:z.string().uuid()});
async function member(context:{supabase:any;userId:string},companyId:string){
 const {data,error}=await context.supabase.from('company_users').select('ativo').eq('company_id',companyId).eq('user_id',context.userId).maybeSingle();
 if(error)throw new Error(error.message);if(!data?.ativo)throw new Error('Sem acesso à empresa.');
}
export type ExistenceJob={id:string;status:string;total:number;done_count:number;existing_count:number;deleted_count:number;skipped_count:number;error_count:number;last_error:string|null};
export const startExistenceJob=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .inputValidator((input:unknown)=>company.extend({product_ids:z.array(z.string().uuid()).min(1).max(50000).optional(),confirm_delete:z.literal(true)}).parse(input))
 .handler(async({data,context})=>{
  await member(context,data.company_id);
  const {supabaseAdmin}=await import('@/integrations/supabase/client.server');
  const {data:id,error}=await (supabaseAdmin as any).rpc('start_bling_existence_job',{_company_id:data.company_id,_user_id:context.userId,_ids:data.product_ids??null});
  if(error)throw new Error(error.message);return {job_id:id as string};
 });
export const getExistenceJob=createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).inputValidator((input:unknown)=>company.parse(input))
 .handler(async({data,context})=>{
  await member(context,data.company_id);
  const db=context.supabase as any;
  const {data:job,error}=await db.from('bling_existence_jobs').select('id,status,total,done_count,existing_count,deleted_count,skipped_count,error_count,last_error').eq('company_id',data.company_id).order('started_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw new Error(error.message); if(!job)return {job:null,items:[]};
  const {data:items,error:itemError}=await db.from('bling_existence_items').select('product_id,codigo,nome,status,erro,checked_at').eq('job_id',job.id).eq('company_id',data.company_id).neq('status','pendente').order('checked_at',{ascending:false}).limit(30);
  if(itemError)throw new Error(itemError.message);return {job:job as ExistenceJob,items:items??[]};
 });
export const controlExistenceJob=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .inputValidator((input:unknown)=>company.extend({job_id:z.string().uuid(),action:z.enum(['pause','resume','cancel'])}).parse(input))
 .handler(async({data,context})=>{
  await member(context,data.company_id);const {supabaseAdmin}=await import('@/integrations/supabase/client.server');
  const status=data.action==='pause'?'pausado':data.action==='resume'?'executando':'cancelado';
  const from=data.action==='resume'?['pausado','erro']:['executando','pausado','erro'];
  const {data:changed,error}=await (supabaseAdmin as any).from('bling_existence_jobs').update({status,lease_token:null,lease_until:null,last_error:null,next_tick_at:new Date().toISOString(),...(status==='cancelado'?{finished_at:new Date().toISOString()}: {})}).eq('id',data.job_id).eq('company_id',data.company_id).in('status',from).select('id').maybeSingle();
  if(error)throw new Error(error.message);if(!changed)throw new Error('Tarefa não disponível para esta ação.');return {ok:true};
 });
