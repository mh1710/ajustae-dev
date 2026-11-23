import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { suggestEanBatch, applyEanSuggestions, type EanSuggestion } from "@/lib/ean-suggest.functions";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  productIds: string[];
  onApplied?: () => void;
};

export function EanSuggestDialog({ open, onOpenChange, companyId, productIds, onApplied }: Props) {
  const fnSuggest = useServerFn(suggestEanBatch);
  const fnApply = useServerFn(applyEanSuggestions);
  const [mode, setMode] = useState<"ml" | "ai">("ml");
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [items, setItems] = useState<EanSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(0);
  const [minSim, setMinSim] = useState(0);
  const stopRef = useRef(false);

  async function start() {
    stopRef.current = false;
    setRunning(true);
    setItems([]);
    setSelected(new Set());
    setDone(0);
    setMinSim(0);
    const B = 5;
    try {
      for (let i = 0; i < productIds.length && !stopRef.current; i += B) {
        const r = await fnSuggest({ data: { company_id: companyId, product_ids: productIds.slice(i, i + B), mode } });
        setItems((prev) => [...prev, ...r.items]);
        setSelected((prev) => {
          const n = new Set(prev);
          for (const it of r.items) if (it.ean) n.add(it.id);
          return n;
        });
        setDone(Math.min(i + B, productIds.length));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na busca.");
    } finally {
      setRunning(false);
    }
  }

  async function apply() {
    const payload = items.filter((i) => i.ean && selected.has(i.id)).map((i) => ({ id: i.id, ean: i.ean! }));
    if (!payload.length) { toast.info("Nenhum EAN marcado para aplicar."); return; }
    setApplying(true);
    try {
      let updated = 0;
      for (let i = 0; i < payload.length; i += 1000) {
        const r = await fnApply({ data: { company_id: companyId, items: payload.slice(i, i + 1000) } });
        updated += r.updated;
      }
      toast.success(`EAN aplicado em ${updated} produto(s).`);
      onApplied?.();
      onOpenChange(false);
      setItems([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao aplicar.");
    } finally {
      setApplying(false);
    }
  }

  const found = items.filter((i) => i.ean);
  const visible = items.filter((it) => {
    if (it.error && !it.ean) return minSim === 0;
    const pct = Math.round((it.similarity ?? 1) * 100);
    return pct >= minSim;
  });
  const toggle = (id: string, v: boolean) =>
    setSelected((p) => { const n = new Set(p); v ? n.add(id) : n.delete(id); return n; });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!running && !applying) onOpenChange(v); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Buscar EAN para {productIds.length.toLocaleString("pt-BR")} produto(s)</DialogTitle>
          <DialogDescription>
            Nada é alterado até você revisar. Marque os EANs que quer aplicar e descarte os outros.
          </DialogDescription>
        </DialogHeader>

        {items.length === 0 && !running && (
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as "ml" | "ai")} className="space-y-2">
            <div className="flex items-start gap-2">
              <RadioGroupItem value="ml" id="ean-ml" />
              <Label htmlFor="ean-ml" className="font-normal">
                <span className="font-medium">Mercado Livre pelo título</span> — procura o produto no catálogo do ML e pega o EAN do anúncio mais parecido.
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="ai" id="ean-ai" />
              <Label htmlFor="ean-ai" className="font-normal">
                <span className="font-medium">Buscar com IA</span> — pesquisa na internet e a IA escolhe o código que pertence ao produto.
              </Label>
            </div>
          </RadioGroup>
        )}

        {(running || items.length > 0) && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>{done} de {productIds.length} pesquisados · {found.length} com EAN · {selected.size} marcados</span>
              {running && <Button size="sm" variant="outline" onClick={() => { stopRef.current = true; }}>Parar busca</Button>}
            </div>
            <Progress value={productIds.length ? (done / productIds.length) * 100 : 0} />
            {found.length > 0 && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(found.map((i) => i.id)))}>Marcar todos</Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Desmarcar todos</Button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm whitespace-nowrap">Semelhança mínima do título: <span className="font-medium">{minSim}%</span></span>
                  <Slider
                    value={[minSim]}
                    min={0}
                    max={100}
                    step={5}
                    onValueChange={(v) => setMinSim(v[0] ?? 0)}
                    className="flex-1"
                  />
                </div>
                {minSim > 0 && (
                  <p className="text-xs text-muted-foreground">Mostrando só os títulos com pelo menos {minSim}% de semelhança ({visible.length} de {items.length}).</p>
                )}
              </div>
            )}
            <div className="max-h-[50vh] overflow-auto rounded border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted text-left">
                    <tr>
                      <th className="p-2 w-10">Aplicar</th>
                      <th className="p-2">Produto</th>
                      <th className="p-2">EAN sugerido</th>
                      <th className="p-2 w-20">Parecido</th>
                      <th className="p-2">Encontrado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((it) => {
                      const pct = it.ean ? Math.round((it.similarity ?? 1) * 100) : null;
                      return (
                        <tr key={it.id} className="border-t align-top">
                          <td className="p-2">
                            <Checkbox disabled={!it.ean} checked={selected.has(it.id)} onCheckedChange={(v) => toggle(it.id, !!v)} />
                          </td>
                          <td className="p-2">
                            <div className="font-mono text-xs text-muted-foreground">{it.sku}</div>
                            <div>{it.nome}</div>
                          </td>
                          <td className="p-2 font-mono">{it.ean ?? "—"}</td>
                          <td className="p-2 font-mono text-xs">{pct != null ? `${pct}%` : "—"}</td>
                          <td className="p-2 text-xs text-muted-foreground">{it.ean ? it.match : <span className="text-destructive">{it.error}</span>}</td>
                        </tr>
                      );
                    })}
                    {visible.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-4 text-center text-muted-foreground">
                          Nenhum título com essa semelhança. Arraste o seletor para baixo.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
            </div>
          </div>
        )}

        <DialogFooter>
          {items.length === 0 && !running ? (
            <Button onClick={start}>Buscar EANs</Button>
          ) : (
            <>
              <Button variant="outline" disabled={running || applying} onClick={() => { setItems([]); onOpenChange(false); }}>Descartar tudo</Button>
              <Button disabled={running || applying || selected.size === 0} onClick={apply}>
                {applying && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Aplicar {selected.size} EAN(s)
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
