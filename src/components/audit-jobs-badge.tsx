import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck, Loader2, Minus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cancelAuditRun, listAuditRuns } from "@/lib/audit.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";

/** Shares persisted audit progress across pages without driving or restarting a run. */
export function AuditJobsBadge() {
  const [companyId] = useSelectedCompany();
  const fetchRuns = useServerFn(listAuditRuns);
  const cancelRun = useServerFn(cancelAuditRun);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const previousRun = useRef<string | null>(null);
  const runs = useQuery({
    queryKey: ["audit-runs", companyId],
    queryFn: () => {
      if (!companyId) throw new Error("Selecione uma empresa.");
      return fetchRuns({ data: { company_id: companyId } });
    },
    enabled: !!companyId,
    refetchInterval: 1500,
  });
  const run = runs.data?.find(item => item.status === "processando") as
    | (Awaited<ReturnType<typeof listAuditRuns>>[number] & {
        image_scan_checked?: number;
        image_scan_started?: boolean;
        image_scan_done?: boolean;
      })
    | undefined;

  useEffect(() => {
    if (previousRun.current && !run && runs.isSuccess) {
      const finished = runs.data?.find(item => item.id === previousRun.current) as any;
      if (finished?.status === "concluida") {
        toast.success(`Auditoria concluída: ${Number(finished.errors_count ?? 0).toLocaleString("pt-BR")} erros e ${Number(finished.warnings_count ?? 0).toLocaleString("pt-BR")} avisos.`, { id: `audit-done-${finished.id}` });
      }
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["audit-issue-types", companyId] });
      setOpen(false);
    }
    previousRun.current = run?.id ?? null;
  }, [run?.id, runs.isSuccess, companyId, qc]);
  useEffect(() => { setOpen(false); previousRun.current = null; }, [companyId]);

  if (!companyId || !run) return null;
  const total = run.total_products ?? 0;
  const checked = Math.min(total, Math.max(run.processed_products ?? 0, run.image_scan_checked ?? 0));
  const photos = run.image_scan_started && !run.image_scan_done;
  const percent = total > 0 ? Math.round(checked / total * 100) : 0;

  async function cancel() {
    if (!run) return;
    setCancelling(true);
    try {
      await cancelRun({ data: { run_id: run.id } });
      await qc.invalidateQueries({ queryKey: ["audit-run", run.id] });
      await runs.refetch();
      toast.info("Auditoria cancelada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cancelar a auditoria.");
    } finally { setCancelling(false); }
  }

  return (
    <div className="fixed bottom-40 right-4 z-50 flex justify-end sm:bottom-44">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="secondary" aria-label="Abrir progresso da auditoria" title="Progresso da auditoria" className="h-auto max-w-[calc(100vw-2rem)] rounded-full border border-primary/30 bg-background/95 py-2 pl-3 pr-4 shadow-lg backdrop-blur">
            <ClipboardCheck className="h-5 w-5 shrink-0 text-primary" />
            <span className="flex flex-col items-start leading-tight">
              <span className="text-xs text-muted-foreground">Auditoria</span>
              <span className="text-sm font-medium tabular-nums">{checked.toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")}</span>
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-80 max-w-[calc(100vw-2rem)] space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Loader2 className="h-4 w-4 motion-safe:animate-spin text-primary" /> Auditoria de produtos</h2>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Minimizar auditoria" title="Minimizar auditoria" onClick={() => setOpen(false)}><Minus className="h-4 w-4" /></Button>
          </div>
          <p className="text-xs text-muted-foreground">{photos ? "Verificando fotos" : "Conferindo regras de auditoria"}</p>
          <Progress aria-label="Progresso da auditoria" value={percent} />
          <div className="grid grid-cols-2 gap-3 text-sm" aria-live="polite">
            <div><p className="text-muted-foreground">Conferidos</p><p className="text-xl font-semibold tabular-nums">{checked.toLocaleString("pt-BR")}</p></div>
            <div><p className="text-muted-foreground">Faltam</p><p className="text-xl font-semibold tabular-nums">{Math.max(0, total - checked).toLocaleString("pt-BR")}</p></div>
          </div>
          <Button variant="destructive" size="sm" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? "Cancelando…" : "Cancelar auditoria"}</Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}