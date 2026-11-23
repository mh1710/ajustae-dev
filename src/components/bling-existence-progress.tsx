import {useEffect} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useServerFn} from '@tanstack/react-start';
import {Pause,Play,X} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Progress} from '@/components/ui/progress';
import {getExistenceJob,controlExistenceJob} from '@/lib/bling-existence.functions';
export function BlingExistenceProgress({companyId}:{companyId:string|undefined}){
 const qc=useQueryClient(),getFn=useServerFn(getExistenceJob),controlFn=useServerFn(controlExistenceJob);
 const query=useQuery({queryKey:['bling-existence',companyId],enabled:!!companyId,queryFn:()=>{if(!companyId)throw new Error('Selecione a empresa.');return getFn({data:{company_id:companyId}});},refetchInterval:6000,refetchIntervalInBackground:true,refetchOnWindowFocus:'always'});
 const job=query.data?.job;
 useEffect(()=>{if(job?.done_count)qc.invalidateQueries({queryKey:['products']});},[job?.done_count,qc]);
 async function control(action:'pause'|'resume'|'cancel'){
  if(!companyId || !job)return;
  try{await controlFn({data:{company_id:companyId,job_id:job.id,action}});await query.refetch();}catch(e){toast.error(e instanceof Error?e.message:'Falha ao controlar a verificação.');}
 }
 if(query.isError)return <p className="text-sm text-destructive">Não foi possível carregar a verificação no Bling.</p>;
 if(!job)return null;
 const remaining=Math.max(0,job.total-job.done_count),percent=job.total?Math.round(job.done_count/job.total*100):0;
 const labels:Record<string,string>={executando:'em andamento',pausado:'pausada',cancelado:'cancelada',concluido:'concluída',erro:'com erro'};
 return <section className="space-y-3 border-y border-border py-4" aria-label="Progresso da verificação no Bling">
  <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Verificação no Bling {labels[job.status]}</h3><div className="flex gap-2">
   {job.status==='executando' && <Button size="sm" variant="outline" onClick={()=>control('pause')}><Pause className="mr-1 h-4 w-4"/>Pausar</Button>}
   {['pausado','erro'].includes(job.status) && <Button size="sm" variant="outline" onClick={()=>control('resume')}><Play className="mr-1 h-4 w-4"/>Retomar</Button>}
   {['executando','pausado','erro'].includes(job.status) && <Button size="sm" variant="outline" onClick={()=>control('cancel')}><X className="mr-1 h-4 w-4"/>Cancelar</Button>}
  </div></div>
  <Progress value={percent} aria-label={`${job.done_count} de ${job.total} produtos verificados`}/>
  <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm"><span>Verificados: <strong>{job.done_count.toLocaleString('pt-BR')} / {job.total.toLocaleString('pt-BR')}</strong> ({percent}%)</span><span>Faltam: <strong>{remaining.toLocaleString('pt-BR')}</strong></span><span>Excluídos daqui: <strong>{job.deleted_count}</strong></span><span>Existem no Bling: {job.existing_count}</span><span>Não verificáveis: {job.skipped_count}</span><span>Erros: {job.error_count}</span></div>
  {job.last_error && <p className="text-sm text-destructive">{job.last_error}</p>}
  {!!query.data?.items.length && <details><summary className="cursor-pointer text-sm font-medium">Últimos produtos verificados</summary><div className="max-h-64 overflow-y-auto">
    {query.data.items.map((i:any)=><div key={i.product_id} className="border-b border-border py-2 text-sm"><span className="font-medium">{i.codigo || 'Sem SKU'}</span> · {i.nome}<div className={i.status==='erro'?'text-destructive':'text-muted-foreground'}>{i.status==='excluido'?'Excluído do Ajusta-Ê':i.status==='existe'?'Existe no Bling':i.erro || 'Mantido no sistema'}</div></div>)}
  </div></details>}
 </section>;
}
