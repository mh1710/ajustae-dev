import {createFileRoute} from '@tanstack/react-router';
import {z} from 'zod';
export const Route=createFileRoute('/api/public/bling/existence-tick')({server:{handlers:{POST:async({request})=>{
 const secret=process.env.BLING_WORKER_SECRET?.trim();
 if(!secret || request.headers.get('x-worker-secret')?.trim()!==secret)return new Response('Forbidden',{status:403});
 const parsed=z.object({job_id:z.string().uuid().optional()}).safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return new Response('Invalid request',{status:400});
 const {processExistenceTick}=await import('@/lib/bling-existence.server');
 return Response.json(await processExistenceTick(parsed.data.job_id));
}}}});
