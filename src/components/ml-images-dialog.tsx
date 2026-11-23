import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { suggestMlImages, applyMlImages, type MlImageSuggestion } from "@/lib/ml-images-suggest.functions";
import { applyCrossCompanyFix } from "@/lib/cross-company-fix.functions";
import { chunks, IMAGE_SEARCH_PRODUCTS_PER_REQUEST, IMAGE_SEARCHES_IN_PARALLEL } from "@/lib/image-apply-batch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Props = { open: boolean; onOpenChange: (v: boolean) => void; companyId: string; productIds: string[]; min: number; max: number; companies?: { id: string; nome: string }[]; initialSource?: string; onApplied?: () => void };

export function MlImagesDialog({ open, onOpenChange, companyId, productIds, min, max, companies = [], initialSource = "supplier_ml", onApplied }: Props) {
  const suggest = useServerFn(suggestMlImages);
  const suggestCompany = useServerFn(applyCrossCompanyFix);
  const [source, setSource] = useState(initialSource);
  const apply = useServerFn(applyMlImages);
  const [items, setItems] = useState<MlImageSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(0);
  const stop = useRef(false);
  const runId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const ok = (i: MlImageSuggestion) => !i.error && i.imagens.length >= min;

  // Stopping frees the screen at once: in-flight requests are aborted and any late answer is ignored.
  function stopSearch() {
    stop.current = true;
    runId.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }

  async function start() {
    stop.current = false; setItems([]); setSelected(new Set()); setDone(0); setRunning(true);
    const myRun = ++runId.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const active = () => runId.current === myRun && !stop.current;
    // Several small searches run at the same time; each one reports as soon as it finishes.
    const parts = chunks(productIds, IMAGE_SEARCH_PRODUCTS_PER_REQUEST);
    let next = 0;
    let failed: unknown = null;
    const worker = async () => {
      while (active() && !failed && next < parts.length) {
        const ids = parts[next++];
        try {
          const r = source === "supplier_ml"
            ? await suggest({ data: { company_id: companyId, product_ids: ids, min, max }, signal: controller.signal })
            : await suggestCompany({ data: { company_id: companyId, product_ids: ids, rule_slug: "imagem-placeholder", dry_run: true, ...(source !== "__all__" ? { source_company_ids: [source] } : {}) }, signal: controller.signal });
          if (!active()) return;
          setItems((old) => [...old, ...r.items]);
          setDone((n) => Math.min(n + ids.length, productIds.length));
        } catch (e) { if (active()) failed = e; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(IMAGE_SEARCHES_IN_PARALLEL, parts.length) }, worker));
    if (runId.current !== myRun) return;
    if (failed) toast.error(failed instanceof Error ? failed.message : "Erro ao buscar imagens.");
    abortRef.current = null;
    setRunning(false);
  }

  async function doApply() {
    const payload = items.filter((i) => ok(i) && selected.has(i.id)).map((i) => ({ id: i.id, imagens: i.imagens }));
    if (!payload.length) return;
    setApplying(true); setApplied(0);
    let updated = 0, skipped = 0;
    try {
      for (const part of chunks(payload)) {
        const r = await apply({ data: { company_id: companyId, items: part } });
        updated += r.updated; skipped += r.skipped; setApplied((n) => n + part.length);
        setSelected((old) => { const next = new Set(old); part.forEach((item) => next.delete(item.id)); return next; });
      }
      toast.success(`Imagens aplicadas em ${updated} produto(s). Envie ao Bling para publicar.`);
      if (skipped) toast.warning(`${skipped} produto(s) não foram alterados: alguma foto sugerida não abriu. Busque as imagens novamente para eles.`);
      onApplied?.(); onOpenChange(false); setItems([]);
    } catch (e) {
      toast.error(`${e instanceof Error ? e.message : "Erro ao aplicar imagens."} ${updated} produto(s) já foram alterados; os marcados restantes podem ser enviados de novo.`);
      if (updated) onApplied?.();
    }
    finally { setApplying(false); }
  }

  const found = items.filter(ok);
  return <Dialog open={open} onOpenChange={(v) => { if (!running && !applying) onOpenChange(v); }}>
    <DialogContent className="max-w-5xl">
      <DialogHeader>
        <DialogTitle>Correção de imagens · {productIds.length.toLocaleString("pt-BR")} produto(s)</DialogTitle>
        <DialogDescription>Mínimo: {min} imagens · Máximo: {max} · Revisão pendente</DialogDescription>
      </DialogHeader>
      {items.length === 0 && <Select value={source} onValueChange={setSource} disabled={running}>
        <SelectTrigger aria-label="Origem das fotos"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="supplier_ml">Fornecedor / Mercado Livre por EAN</SelectItem>
          <SelectItem value="__all__" disabled={!companies.some(c => c.id !== companyId)}>Outra empresa · primeira correta</SelectItem>
          {companies.filter(c => c.id !== companyId).map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
        </SelectContent>
      </Select>}
      {(running || items.length > 0) && <div className="space-y-3">
        <div className="flex items-center justify-between text-sm"><span>{applying ? `${applied} produto(s) conferidos · ${selected.size} restantes` : `${done} de ${productIds.length} pesquisados · ${found.length} encontrados · ${selected.size} marcados`}</span>{running && <Button size="sm" variant="outline" onClick={stopSearch}>Parar busca</Button>}</div>
        <Progress value={applying ? applied / Math.max(1, applied + selected.size) * 100 : productIds.length ? done / productIds.length * 100 : 0} />
        <div className="flex gap-2"><Button size="sm" variant="ghost" disabled={applying} onClick={() => setSelected(new Set(found.map((i) => i.id)))}>Marcar todos</Button><Button size="sm" variant="ghost" disabled={applying} onClick={() => setSelected(new Set())}>Desmarcar todos</Button></div>
        <div className="max-h-[55vh] overflow-auto rounded border"><table className="w-full text-sm"><thead className="sticky top-0 bg-muted text-left"><tr><th className="p-2">Aplicar</th><th className="p-2">Produto</th><th className="p-2">Imagens sugeridas</th></tr></thead><tbody>
          {items.map((i) => <tr key={i.id} className="border-t align-top">
            <td className="p-2"><Checkbox disabled={applying || !ok(i)} checked={selected.has(i.id)} onCheckedChange={(v) => setSelected((old) => { const n = new Set(old); v ? n.add(i.id) : n.delete(i.id); return n; })} /></td>
            <td className="p-2 w-64"><div className="font-mono text-xs text-muted-foreground">{i.sku} · EAN {i.ean ?? "—"}</div>{i.nome}<div className="text-xs text-muted-foreground">Hoje: {i.atuais} · Válidas: {i.validas} · Inválidas: {i.invalidas}</div>{i.source && <div className="mt-1 text-xs">Origem: {i.source === "outra_empresa" ? i.source_name ?? "Outra empresa" : i.source === "atuais" ? "Fotos válidas atuais" : i.source === "fornecedor" ? "Fornecedor" : "Mercado Livre"}</div>}{i.ml_nome && <div className="mt-1 text-xs">ML: {i.ml_nome}</div>}</td>
            <td className="p-2">{i.error && <div className="mb-1 text-xs text-destructive">{i.error}</div>}<div className="flex flex-wrap gap-1">{i.imagens.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" loading="lazy" className="h-16 w-16 rounded border object-contain bg-background" /></a>)}</div></td>
          </tr>)}
        </tbody></table></div>
      </div>}
      <DialogFooter>{!running && items.length === 0 ? <Button onClick={start}>Buscar imagens</Button> : <><Button variant="outline" disabled={running || applying} onClick={() => { setItems([]); onOpenChange(false); }}>Descartar tudo</Button><Button disabled={running || applying || selected.size === 0} onClick={doApply}>Trocar imagens de {selected.size} produto(s)</Button></>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}
