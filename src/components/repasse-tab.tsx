import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { PageNumbers } from '@/components/page-numbers';
import { calculateRepasse } from '@/lib/repasse-calculation';
import { includeRepasseDate } from '@/lib/repasse-period';
import { listRepasses, saveRepasse, deleteRepasse, type RepasseRow } from '@/lib/repasses.functions';

const brl = (value: number) => Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const fields = [ ['custo_produto','Custo do produto'], ['custo_etiqueta','Custo de etiqueta'], ['custo_boy','Custo de boy'], ['custo_embalagem','Custo de embalagem'], ['repasse','Repasse recebido'] ] as const;
function blank() {
  return { data: new Date().toLocaleDateString('en-CA'), cliente:'', referencia:'', observacoes:'', custo_produto:'0', quantidade:'1', custo_etiqueta:'0', custo_boy:'0', custo_embalagem:'0', repasse:'0' };
}
type Form = ReturnType<typeof blank>;
function number(value: string) { return Number(value.trim().replace(',','.')); }

export function RepasseTab({companyId,from,to,onPeriodChange}: {companyId:string | undefined;from:string;to:string;onPeriodChange:(from:string,to:string) => void}) {
  const queryClient = useQueryClient();
  const fetch = useServerFn(listRepasses);
  const save = useServerFn(saveRepasse);
  const remove = useServerFn(deleteRepasse);
  const [page,setPage] = useState(1);
  const [form,setForm] = useState<Form>(blank);
  const [editing,setEditing] = useState<string | undefined>();
  const [open,setOpen] = useState(false);
  const [busy,setBusy] = useState(false);
  const [deleting,setDeleting] = useState<RepasseRow | null>(null);
  const query = useQuery({ queryKey:['repasses',companyId,from,to,page], enabled:!!companyId && from <= to,
    queryFn:() => {
      if (!companyId) throw new Error('Selecione uma empresa.');
      return fetch({ data:{company_id:companyId,from,to,page} });
    },
  });
  const values = { custo_produto:number(form.custo_produto), quantidade:Math.floor(number(form.quantidade)), custo_etiqueta:number(form.custo_etiqueta), custo_boy:number(form.custo_boy), custo_embalagem:number(form.custo_embalagem), repasse:number(form.repasse) };
  const validQuantity = form.quantidade.trim() !== '' && Number.isInteger(number(form.quantidade)) && values.quantidade >= 1;
  const validMoney = validQuantity && fields.every(([key]) => form[key].trim() !== '' && Number.isFinite(values[key]) && (key === 'repasse' || values[key] >= 0));
  const preview = calculateRepasse(values);
  function edit(row?:RepasseRow) {
    setEditing(row?.id);
    const initial = blank();
    if (row) {
      initial.data=row.data; initial.cliente=row.cliente; initial.referencia=row.referencia ?? ''; initial.observacoes=row.observacoes ?? '';
      initial.quantidade=String(row.quantidade);
      fields.forEach(([key]) => { initial[key]=String(row[key]); });
    }
    setForm(initial); setOpen(true);
  }
  async function submit(event:React.FormEvent) {
    event.preventDefault();
    if (!companyId || busy || !validMoney) return;
    setBusy(true);
    try {
      await save({data:{company_id:companyId,id:editing,...form,...values}});
      await queryClient.invalidateQueries({queryKey:['repasses',companyId]});
      const period = includeRepasseDate(from,to,form.data);
      setPage(1);
      setOpen(false);
      onPeriodChange(period.from,period.to);
      toast.success(period.from !== from || period.to !== to ? 'Repasse salvo. Período ajustado para incluir a data do lançamento.' : 'Repasse salvo.');
    } catch(error) { toast.error(error instanceof Error ? error.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  }
  async function confirmDelete() {
    if (!companyId || !deleting || busy) return;
    setBusy(true);
    try {
      await remove({data:{company_id:companyId,id:deleting.id}});
      setDeleting(null);
      await queryClient.invalidateQueries({queryKey:['repasses',companyId]});
      toast.success('Repasse excluído.');
    } catch(error) { toast.error(error instanceof Error ? error.message : 'Não foi possível excluir.'); }
    finally { setBusy(false); }
  }
  const totals=query.data?.totals;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Repasses do período</h2>
      <Button onClick={() => edit()} disabled={!companyId}><Plus className="mr-2 h-4 w-4"/>Novo repasse</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {([['Repasses recebidos',totals?.repasse],['Custos',totals?.custos],['Resultado',totals?.resultado],['Divisão por 2',totals?.divisao]] as const).map(([label,value]) =>
        <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{value == null ? '—' : brl(value)}</p></CardContent></Card>)}
    </div>
    <Card><CardContent className="space-y-3 p-4">
      <p className="text-sm font-semibold">Investimento x lucro</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {([['Produtos',totals?.custo_produto],['Etiquetas',totals?.custo_etiqueta],['Boy',totals?.custo_boy],['Embalagens',totals?.custo_embalagem],['Total investido',totals?.custos]] as const).map(([label,value]) =>
          <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className={label==='Total investido'?'text-lg font-semibold':'font-medium'}>{value == null ? '—' : brl(Number(value))}</p></div>)}
      </div>
      <div className="flex flex-wrap gap-6 border-t pt-3">
        <div><p className="text-xs text-muted-foreground">Lucro em R$</p><p className={`text-xl font-semibold ${(totals?.resultado ?? 0) < 0 ? 'text-destructive' : 'text-primary'}`}>{totals ? brl(totals.resultado) : '—'}</p></div>
        <div><p className="text-xs text-muted-foreground">Lucro sobre o investido</p><p className={`text-xl font-semibold ${(totals?.resultado ?? 0) < 0 ? 'text-destructive' : 'text-primary'}`}>{totals && Number(totals.custos) > 0 ? `${(Number(totals.resultado) / Number(totals.custos) * 100).toLocaleString('pt-BR',{maximumFractionDigits:1})}%` : '—'}</p></div>
        <p className="self-end text-xs text-muted-foreground">Para cada R$ 100 investidos, voltaram {totals && Number(totals.custos) > 0 ? brl(100 + Number(totals.resultado) / Number(totals.custos) * 100) : '—'}.</p>
      </div>
    </CardContent></Card>
    {query.isError ? <div role="alert" className="flex flex-wrap items-center gap-3 text-destructive"><span>{query.error.message}</span><Button variant="outline" onClick={() => query.refetch()}>Tentar novamente</Button></div> :
    <div className="overflow-x-auto rounded-md border">
      <Table className="min-w-[1100px]">
        <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Cliente / ajuste</TableHead><TableHead>Referência</TableHead>{fields.map(([key,label]) => <TableHead key={key} className="text-right">{label}</TableHead>)}<TableHead className="text-right">Quantidade</TableHead><TableHead className="text-right">Resultado</TableHead><TableHead className="text-right">Divisão por 2</TableHead><TableHead><span className="sr-only">Ações</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {query.isLoading ? <TableRow><TableCell colSpan={12} className="h-24 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin"/></TableCell></TableRow> :
          !query.data?.rows.length ? <TableRow><TableCell colSpan={12} className="h-24 text-center text-muted-foreground">Nenhum repasse neste período.</TableCell></TableRow> :
          query.data.rows.map(row => <TableRow key={row.id}>
            <TableCell className="whitespace-nowrap">{new Date(row.data+'T12:00:00').toLocaleDateString('pt-BR')}</TableCell>
            <TableCell className="max-w-[250px] whitespace-normal break-words" title={row.observacoes ?? undefined}>{row.cliente}</TableCell><TableCell className="max-w-[120px] break-words">{row.referencia || '—'}</TableCell>
            {fields.map(([key]) => <TableCell className="whitespace-nowrap text-right tabular-nums" key={key}>{brl(row[key])}</TableCell>)}
            <TableCell className="whitespace-nowrap text-right tabular-nums">{row.quantidade}</TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">{brl(row.resultado)}</TableCell><TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{brl(row.divisao)}</TableCell>
            <TableCell><div className="flex"><Button variant="ghost" size="icon" title="Editar repasse" aria-label={`Editar repasse de ${row.cliente}`} onClick={() => edit(row)}><Pencil className="h-4 w-4"/></Button><Button variant="ghost" size="icon" title="Excluir repasse" aria-label={`Excluir repasse de ${row.cliente}`} onClick={() => setDeleting(row)}><Trash2 className="h-4 w-4 text-destructive"/></Button></div></TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </div>}
    <PageNumbers page={page} pageSize={50} total={totals?.quantidade ?? 0} onChange={setPage}/>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{editing ? 'Editar repasse' : 'Novo repasse'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="repasse-data">Data</Label><Input required id="repasse-data" type="date" value={form.data} onChange={e => setForm({...form,data:e.target.value})}/></div>
            <div><Label htmlFor="repasse-ref">Referência / pedido</Label><Input id="repasse-ref" maxLength={100} value={form.referencia} onChange={e => setForm({...form,referencia:e.target.value})}/></div>
          </div>
          <div><Label htmlFor="repasse-cliente">Cliente / ajuste</Label><Input required id="repasse-cliente" maxLength={200} value={form.cliente} onChange={e => setForm({...form,cliente:e.target.value})}/></div>
          <div className="grid gap-3 sm:grid-cols-2">{fields.map(([key,label]) => <div key={key}><Label htmlFor={`repasse-${key}`}>{label} (R$)</Label><Input id={`repasse-${key}`} inputMode="decimal" required value={form[key]} onChange={e => setForm({...form,[key]:e.target.value})}/></div>)}
            <div><Label htmlFor="repasse-quantidade">Quantidade</Label><Input id="repasse-quantidade" inputMode="numeric" required value={form.quantidade} onChange={e => setForm({...form,quantidade:e.target.value})}/></div>
          </div>
          <div><Label htmlFor="repasse-notas">Observações</Label><Textarea id="repasse-notas" maxLength={2000} value={form.observacoes} onChange={e => setForm({...form,observacoes:e.target.value})}/></div>
          <dl className="grid grid-cols-3 gap-2 border-y py-3 text-sm">{([['Custos',preview.custos],['Resultado',preview.resultado],['Divisão por 2',preview.divisao]] as const).map(([label,value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold">{validMoney ? brl(value) : '—'}</dd></div>)}</dl>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy || !validMoney || !form.cliente.trim()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Salvar repasse</Button></div>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={!!deleting} onOpenChange={value => { if (!value && !busy) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>Excluir repasse?</DialogTitle></DialogHeader><p className="break-words">{deleting?.cliente} · {brl(deleting?.repasse ?? 0)}</p><div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Cancelar</Button><Button variant="destructive" disabled={busy} onClick={confirmDelete}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Excluir repasse</Button></div></DialogContent></Dialog>
  </div>;
}