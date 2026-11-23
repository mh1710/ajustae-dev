import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { importProspectItems, reviewProspectItem } from "@/lib/ml-prospect.functions";
import { draftMissing, preparedIssues, toDraft, type Draft, type PreparedProspect } from "@/lib/ml-prospect-ready";

export type { PreparedProspect } from "@/lib/ml-prospect-ready";

export function ProspectImportDialog({ open, onOpenChange, companyId, prepared, onFinished }: {
  open: boolean; onOpenChange: (v: boolean) => void; companyId: string | null; prepared: PreparedProspect[]; onFinished: () => void;
}) {
  const doReview = useServerFn(reviewProspectItem);
  const doImport = useServerFn(importProspectItems);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setDrafts(Object.fromEntries(prepared.map(p => [String(p.row.id), toDraft(p)])));
  }, [prepared]);

  const patch = (id: string, change: Partial<Draft>) => setDrafts(prev => ({ ...prev, [id]: { ...prev[id]!, ...change } }));
  // Only products the preparation left 100% complete can be imported; the others are listed with their reasons.
  const { complete, pending } = useMemo(() => {
    const complete: PreparedProspect[] = []; const pending: Array<{ p: PreparedProspect; issues: string[] }> = [];
    for (const p of prepared) { const issues = preparedIssues(p); if (issues.length) pending.push({ p, issues }); else complete.push(p); }
    return { complete, pending };
  }, [prepared]);
  const ready = complete.filter(p => { const d = drafts[String(p.row.id)]; return d?.status === "pendente" && !draftMissing(d).length; });

  const run = async () => {
    if (!companyId) return;
    setRunning(true);
    for (const p of ready) {
      const id = String(p.row.id); const d = drafts[id]!;
      patch(id, { status: "importando", message: null });
      try {
        const n = (v: string) => Number(v.replace(",", "."));
        const res = await doReview({ data: {
          company_id: companyId, item_id: id, titulo: d.titulo.trim(), marca: d.marca.trim(), ncm: d.ncm, anatel: d.anatel,
          descricao_curta: d.descricao, ncm_confirmed: true, anatel_confirmed: true,
          weight_kg: n(d.weight_kg), length_cm: n(d.length_cm), width_cm: n(d.width_cm), height_cm: n(d.height_cm),
        } });
        // Photos are rechecked and the Mercado Livre supplier contact is ensured inside the import itself.
        const issues = res.issues.filter(i => i.rule !== "imagem-placeholder" && i.rule !== "fornecedor-vinculado").map(i => i.message);
        if (issues.length) { patch(id, { status: "bloqueado", message: issues.join(" · ") }); continue; }
        const imported = await doImport({ data: { company_id: companyId, item_ids: [id] } });
        patch(id, imported.imported > 0
          ? { status: "importado", message: "Na fila de cadastro do Bling." }
          : { status: "bloqueado", message: "Já existia nesta empresa." });
      } catch (e) {
        patch(id, { status: "bloqueado", message: e instanceof Error ? e.message : "Falha ao importar." });
      }
    }
    setRunning(false);
    onFinished();
  };

  return (
    <Dialog open={open} onOpenChange={v => !running && onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-auto">
        <DialogHeader>
          <DialogTitle>Importar produtos 100% completos</DialogTitle>
          <DialogDescription>
            Buscamos NCM, Anatel, marca, peso, medidas, fotos e descrição pelo EAN e já preenchemos tudo. Só vão para o Bling os produtos 100% completos, sem precisar conferir um por um.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium">{complete.length} produto(s) 100% completos · {pending.length} com pendência (não serão importados)</p>
        <div className="space-y-2">
          {complete.map(p => {
            const id = String(p.row.id); const d = drafts[id];
            if (!d) return null;
            const sources = p.row.raw?.prepared?.sources ?? {};
            const done = d.status === "importado";
            return (
              <section key={id} className="space-y-1 rounded-md border p-3" aria-label={d.titulo}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-medium">{d.titulo}</p>
                  <Badge variant={done ? "default" : d.status === "bloqueado" ? "destructive" : "secondary"}>
                    {d.status === "importando" ? "Importando…" : done ? "Importado" : d.status === "bloqueado" ? "Não importado" : "Pronto"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  EAN {p.row.ean ?? "—"} · NCM {d.ncm}{p.row.ncm_fonte ? ` (${p.row.ncm_fonte})` : ""} · Anatel {d.anatel}{sources.anatel ? ` (${sources.anatel})` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.weight_kg} kg · {d.length_cm} × {d.width_cm} × {d.height_cm} cm · {Number(p.row.pictures_count ?? 0)} foto(s)
                </p>
                {d.message && <p className={done ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{d.message}</p>}
              </section>
            );
          })}
          {pending.length > 0 && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">Com pendência — não serão importados ({pending.length})</summary>
              <ul className="mt-2 space-y-2">
                {pending.map(({ p, issues }) => (
                  <li key={String(p.row.id)} className="text-sm">
                    <p className="font-medium">{p.row.titulo}</p>
                    <ul className="list-disc pl-5 text-muted-foreground">{issues.map(i => <li key={i}>{i}</li>)}</ul>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <div className="sticky bottom-0 flex items-center justify-end gap-2 bg-background pt-2">
          <Button variant="outline" disabled={running} onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button disabled={running || !ready.length || !companyId} onClick={run}>
            {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Importar 100% completos ({ready.length})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
