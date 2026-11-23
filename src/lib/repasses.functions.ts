import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export type RepasseRow = {
  id: string; company_id: string; data: string; cliente: string; referencia: string | null; observacoes: string | null;
  custo_produto: number; quantidade: number; custo_etiqueta: number; custo_boy: number; custo_embalagem: number; repasse: number; resultado: number; divisao: number;
};
export type RepasseTotals = { quantidade: number; repasse: number; custos: number; resultado: number; divisao: number; custo_produto?: number; custo_etiqueta?: number; custo_boy?: number; custo_embalagem?: number };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)), 'Data inválida');
const money = z.number().finite().max(99999999999).min(-99999999999).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.001, 'Use até duas casas decimais');
const amount = money.refine(value => value >= 0, 'Custo não pode ser negativo');
const company = z.object({ company_id: z.string().uuid() });
export const repasseInput = company.extend({
  id: z.string().uuid().optional(), data: date, cliente: z.string().trim().min(1).max(200),
  referencia: z.string().trim().max(100).default(''), observacoes: z.string().trim().max(2000).default(''),
  custo_produto: amount, quantidade: z.number().int().min(1).max(999999).default(1), custo_etiqueta: amount, custo_boy: amount, custo_embalagem: amount, repasse: money,
});
async function assertMember(context: { supabase: any; userId: string }, companyId: string) {
  const { data, error } = await context.supabase.from('company_users').select('ativo').eq('company_id',companyId).eq('user_id',context.userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.ativo) throw new Error('Sem acesso a esta empresa.');
}
export const listRepasses = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => company.extend({ from: date, to: date, page: z.number().int().min(1).default(1) }).refine(v => v.from <= v.to, 'Período inválido').parse(input))
  .handler(async ({ data, context }) => {
    await assertMember(context,data.company_id);
    const db = context.supabase as any;
    const [rows, totals] = await Promise.all([
      db.from('dre_repasses').select('id,company_id,data,cliente,referencia,observacoes,custo_produto,quantidade,custo_etiqueta,custo_boy,custo_embalagem,repasse,resultado,divisao')
        .eq('company_id',data.company_id).gte('data',data.from).lte('data',data.to).order('data',{ascending:false}).order('id').range((data.page-1)*50,data.page*50-1),
      db.rpc('dre_repasse_totals',{ _company_id:data.company_id, _from:data.from, _to:data.to }),
    ]);
    if (rows.error) throw new Error(rows.error.message);
    if (totals.error) throw new Error(totals.error.message);
    return { rows: rows.data as RepasseRow[], totals: totals.data as RepasseTotals };
  });
export const saveRepasse = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => repasseInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertMember(context,data.company_id);
    const { id, ...payload } = data;
    const db = context.supabase as any;
    const query = id ? db.from('dre_repasses').update(payload).eq('company_id',data.company_id).eq('id',id) : db.from('dre_repasses').insert({...payload,created_by:context.userId});
    const { data: row, error } = await query.select('id').single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });
export const deleteRepasse = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => company.extend({ id:z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertMember(context,data.company_id);
    const { error } = await (context.supabase as any).from('dre_repasses').delete().eq('company_id',data.company_id).eq('id',data.id).select('id').single();
    if (error) throw new Error(error.message);
    return { ok: true };
  });