import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { suggestNcmBatch, applyNcmSuggestions, type NcmSuggestion } from "@/lib/ncm-suggest.functions";

type Props = { open: boolean; onOpenChange: (v: boolean) => void; companyId: string; productIds: string[]; onApplied?: () => void };

export function NcmSuggestDialog({ open, onOpenChange, companyId, productIds, onApplied }: Props) {
  const suggest = useServerFn(suggestNcmBatch);
  const applyNcm = useServerFn(applyNcmSuggestions);
  const [items, setItems] = useState<NcmSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const stop = useRef(false);

  async function start() {
    stop.current = false; setItems([]); setSelected(new Set()); setDone(0); setRunning(true);
    try {
      for (let i = 0; i < productIds.length && !stop.current; i += 100) {
        const result = await suggest({ data: { company_id: companyId, product_ids: productIds.slice(i, i + 100) } });
        setItems((old) => [...old, ...result.items]);
        setSelected((old) => { const next = new Set(old); result.items.forEach((item) => { if (item.ncm) next.add(item.id); }); return next; });
        setDone(Math.min(i + 100, productIds.length));
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Erro ao buscar NCM."); }
    finally { setRunning(false); }
  }

  async function apply() {
    const payload = items.filter((item) => item.ncm && selected.has(item.id)).map((item) => ({ id: item.id, ncm: item.ncm ?? "" }));
    if (!payload.length) return;
    setApplying(true);
    try {
      let updated = 0;
      for (let i = 0; i < payload.length; i += 100) {
        const result = await applyNcm({ data: { company_id: companyId, items: payload.slice(i, i + 100) } });
        updated += result.updated;
      }
      toast.success(`NCM aplicado em ${updated} produto(s).`);
      onApplied?.(); onOpenChange(false); setItems([]);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Erro ao aplicar NCM."); }
    finally { setApplying(false); }
  }

  const found = items.filter((item) => item.ncm);
  return <Dialog open={open} onOpenChange={(value) => { if (!running && !applying) onOpenChange(value); }}>
    <DialogContent className="max-w-4xl">
      <DialogHeader>
        <DialogTitle>Buscar NCM para {productIds.length.toLocaleString("pt-BR")} produto(s)</DialogTitle>
        <DialogDescription>O Mercado Livre não oferece NCM na busca pública. Confira as sugestões do fornecedor antes de aplicar; a classificação fiscal deve ser validada por você.</DialogDescription>
      </DialogHeader>
      {(running || items.length > 0) && <div className="space-y-3">
        <div className="flex items-center justify-between text-sm"><span>{done} de {productIds.length} pesquisados · {found.length} encontrados · {selected.size} marcados</span>{running && <Button size="sm" variant="outline" onClick={() => { stop.current = true; }}>Parar busca</Button>}</div>
        <Progress value={productIds.length ? done / productIds.length * 100 : 0} />
        <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setSelected(new Set(found.map((item) => item.id)))}>Marcar todos</Button><Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Desmarcar todos</Button></div>
        <div className="max-h-[50vh] overflow-auto rounded border"><table className="w-full text-sm"><thead className="sticky top-0 bg-muted text-left"><tr><th className="p-2">Aplicar</th><th className="p-2">Produto</th><th className="p-2">NCM sugerido</th><th className="p-2">Origem</th></tr></thead><tbody>
          {items.map((item) => <tr key={item.id} className="border-t align-top"><td className="p-2"><Checkbox disabled={!item.ncm} checked={selected.has(item.id)} onCheckedChange={(value) => setSelected((old) => { const next = new Set(old); value ? next.add(item.id) : next.delete(item.id); return next; })} /></td><td className="p-2"><div className="font-mono text-xs text-muted-foreground">{item.sku}</div>{item.nome}</td><td className="p-2 font-mono">{item.ncm ?? "—"}</td><td className="p-2 text-xs">{item.error ? <span className="text-destructive">{item.error}</span> : `Fornecedor: ${item.fornecedor}`}</td></tr>)}
        </tbody></table></div>
      </div>}
      <DialogFooter>{!running && items.length === 0 ? <Button onClick={start}>Buscar NCMs</Button> : <><Button variant="outline" disabled={running || applying} onClick={() => { setItems([]); onOpenChange(false); }}>Descartar tudo</Button><Button disabled={running || applying || selected.size === 0} onClick={apply}>Aplicar {selected.size} NCM(s)</Button></>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}