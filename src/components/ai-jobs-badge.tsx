import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Sparkles, X, Play, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AI_JOB_LABELS,
  cancelAiTransformJob,
  listAiTransformJobs,
  resumeAiTransformJob,
  type AiJobProgress,
} from "@/lib/ai-jobs.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import { useAccess } from "@/hooks/use-access";

const ACTIVE = new Set(["pendente", "executando", "pausado_creditos", "pausado_limite"]);

function statusLabel(job: AiJobProgress) {
  switch (job.status) {
    case "pendente":
      return "Na fila";
    case "executando":
      return "Em andamento";
    case "pausado_limite":
      return "Aguardando liberação da IA";
    case "pausado_creditos":
      return "Pausado: créditos da IA";
    case "concluido":
      return "Concluído";
    case "cancelado":
      return "Cancelado";
    default:
      return "Com erro";
  }
}

/** Botão flutuante com o andamento das transformações de IA em segundo plano. */
export function AiJobsBadge() {
  const { access } = useAccess();
  const readOnly = access.company_restricted;
  const [companyId] = useSelectedCompany();
  const qc = useQueryClient();
  const fetchJobs = useServerFn(listAiTransformJobs);
  const doCancel = useServerFn(cancelAiTransformJob);
  const doResume = useServerFn(resumeAiTransformJob);
  const [open, setOpen] = useState(false);

  const jobs = useQuery({
    queryKey: ["ai-jobs", companyId],
    queryFn: () => fetchJobs({ data: { company_id: companyId! } }),
    enabled: !!companyId,
    refetchInterval: 3_000,
  });

  const [dismissed, setDismissed] = useState<string[]>([]);
  const list = (jobs.data ?? []).filter(
    (j) => !dismissed.includes(j.id) && j.status !== "cancelado",
  );
  const active = list.filter((j) => ACTIVE.has(j.status));
  const running = active.length > 0;

  // Assim que uma transformação termina, a lista de produtos é atualizada.
  useEffect(() => {
    if (!running && list.some((j) => j.status === "concluido")) {
      qc.invalidateQueries({ queryKey: ["products"] });
    }
  }, [running, list, qc]);

  if (!companyId || list.length === 0) return null;

  const totals = active.reduce(
    (acc, j) => ({ done: acc.done + j.done, total: acc.total + j.total }),
    { done: 0, total: 0 },
  );
  const percent = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 100;

  async function cancel(jobId: string) {
    try {
      await doCancel({ data: { job_id: jobId } });
      setDismissed((prev) => [...prev, jobId]);
      setOpen(false);
      toast.info("Transformação por IA interrompida.");
      jobs.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível interromper.");
    }
  }

  async function resume(jobId: string) {
    try {
      await doResume({ data: { job_id: jobId } });
      toast.success("Transformação retomada.");
      jobs.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível retomar.");
    }
  }

  return (
    <div className="fixed bottom-20 right-4 z-50 flex justify-end sm:bottom-24">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            className="h-auto rounded-full border border-primary/30 bg-background/95 py-2 pl-3 pr-4 shadow-lg backdrop-blur"
          >
            <Sparkles className={running ? "text-primary animate-pulse" : "text-muted-foreground"} />
            <span className="flex flex-col items-start leading-tight">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Transformação por IA
              </span>
              <span className="text-sm font-medium">
                {running
                  ? `${totals.done.toLocaleString("pt-BR")} de ${totals.total.toLocaleString("pt-BR")}`
                  : "Finalizada"}
              </span>
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-80 space-y-3">
          <div className="text-sm font-medium">Transformações por IA</div>
          {running ? <Progress value={percent} /> : null}
          <div className="space-y-3">
            {list.slice(0, 4).map((job) => (
              <div key={job.id} className="rounded-md border p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{AI_JOB_LABELS[job.kind] ?? job.kind}</span>
                  <div className="flex items-center gap-1">
                    {!readOnly && (job.status === "pausado_creditos" || job.status === "erro") ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2"
                        onClick={() => resume(job.id)}
                        aria-label="Retomar"
                      >
                        <Play className="h-3 w-3" />
                      </Button>
                    ) : null}
                    {!readOnly && ACTIVE.has(job.status) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2"
                        onClick={() => cancel(job.id)}
                        aria-label="Interromper"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-1 text-muted-foreground">
                  {job.status === "concluido" ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  ) : job.status === "pausado_creditos" || job.status === "erro" ? (
                    <AlertTriangle className="h-3 w-3 text-amber-600" />
                  ) : null}
                  {statusLabel(job)}
                </div>
                <div className="mt-1">
                  {job.done.toLocaleString("pt-BR")} / {job.total.toLocaleString("pt-BR")} · alterados{" "}
                  <strong>{job.updated_count.toLocaleString("pt-BR")}</strong> · erros{" "}
                  <strong>{job.errors.toLocaleString("pt-BR")}</strong>
                </div>
                {job.last_sku ? (
                  <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                    último SKU: {job.last_sku}
                  </div>
                ) : null}
                {job.last_error && job.status !== "concluido" ? (
                  <div className="mt-1 line-clamp-2 text-[10px] text-amber-700">{job.last_error}</div>
                ) : null}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            As transformações continuam mesmo se você trocar de página ou fechar esta janela.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
