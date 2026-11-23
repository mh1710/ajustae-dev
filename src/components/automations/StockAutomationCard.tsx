import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Boxes, Loader2, Trash2, Pause, Play } from "lucide-react";
import { AutomationLogDialog } from "@/components/automations/AutomationLogDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { listMyCompanies } from "@/lib/companies.functions";
import {
  listMyAutomationSchedules,
  saveStockAutomationForCompanies,
  toggleAutomationSchedule,
  deleteAutomationSchedules,
  type StockAutomationRow,
} from "@/lib/automations.functions";
import { pauseBlingPush, resumeBlingPush, cancelBlingPush } from "@/lib/bling-push.functions";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function fmt(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return "—"; }
}

function describe(s: StockAutomationRow) {
  const hora = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  if (s.frequency === "times_per_day") {
    const list = (s.times ?? []).filter(Boolean);
    return list.length > 0
      ? `${list.length}x por dia às ${list.join(", ")}`
      : `Todos os dias às ${hora}`;
  }
  if (s.frequency === "daily") return `Todos os dias às ${hora}`;
  if (s.frequency === "weekly") return `Toda ${WEEKDAYS[s.weekday ?? 1]} às ${hora}`;
  if (s.frequency === "monthly") return `Todo dia ${s.day_of_month ?? 1} às ${hora}`;
  return `A cada ${s.interval_days ?? 1} dia(s) às ${hora}`;
}

export function StockAutomationCard() {
  const companies = useQuery({ queryKey: ["companies"], queryFn: () => listMyCompanies() });

  const fetchSchedules = useServerFn(listMyAutomationSchedules);
  const doSave = useServerFn(saveStockAutomationForCompanies);
  const doToggle = useServerFn(toggleAutomationSchedule);
  const doDeleteMany = useServerFn(deleteAutomationSchedules);
  const doPausePush = useServerFn(pauseBlingPush);
  const doResumePush = useServerFn(resumeBlingPush);
  const doCancelPush = useServerFn(cancelBlingPush);
  const [busyPush, setBusyPush] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<StockAutomationRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const schedules = useQuery({
    queryKey: ["stock-automation-schedules"],
    queryFn: () => fetchSchedules({ data: { slug: "estoque-preco-fornecedor" } }),
    refetchInterval: 15000,
  });

  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("Automação de estoque");
  const [frequency, setFrequency] = useState<StockAutomationRow["frequency"]>("daily");
  const [time, setTime] = useState("03:00");
  const [weekday, setWeekday] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [intervalDays, setIntervalDays] = useState("3");
  const [times, setTimes] = useState<string[]>(["03:00", "15:00"]);
  const [applyStatus, setApplyStatus] = useState(true);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [considerMlStock, setConsiderMlStock] = useState(true);
  const [saving, setSaving] = useState(false);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of companies.data ?? []) m.set(c.id, c.nome);
    return m;
  }, [companies.data]);

  const rows = schedules.data ?? [];

  function toggleCompany(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    if (selected.length === 0) {
      toast.error("Selecione ao menos uma empresa.");
      return;
    }
    const cleanTimes = Array.from(new Set(times.filter((t) => /^\d{2}:\d{2}$/.test(t)))).sort();
    if (frequency === "times_per_day" && cleanTimes.length === 0) {
      toast.error("Informe ao menos um horário.");
      return;
    }
    const [h, m] = (frequency === "times_per_day" ? cleanTimes[0] ?? time : time).split(":");
    setSaving(true);
    try {
      const res = await doSave({
        data: {
          company_ids: selected,
          name,
          frequency,
          hour: Number(h ?? 3),
          minute: Number(m ?? 0),
          weekday: frequency === "weekly" ? Number(weekday) : null,
          day_of_month: frequency === "monthly" ? Number(dayOfMonth) : null,
          interval_days: frequency === "interval" ? Number(intervalDays) : null,
          times: frequency === "times_per_day" ? cleanTimes : null,
          include_stores: false,
          apply_status: applyStatus,
          only_changed: onlyChanged,
          consider_ml_stock: considerMlStock,
        },
      });
      toast.success(`Automação programada para ${res.saved} empresa(s).`);
      setSelected([]);
      schedules.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar automação");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(s: StockAutomationRow, enabled: boolean) {
    try {
      await doToggle({ data: { id: s.id, company_id: s.company_id, enabled } });
      schedules.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  async function remove(row: StockAutomationRow) {
    setDeleting(true);
    try {
      const pend = (row.queue?.pendentes ?? 0) + (row.queue?.pausados ?? 0);
      await doDeleteMany({ data: { ids: [row.id] } });
      if (pend > 0 || row.running) {
        await doCancelPush({ data: { company_id: row.company_id } });
      }
      toast.success(
        pend > 0
          ? `Agendamento removido e envio cancelado (${pend.toLocaleString("pt-BR")} produto(s)).`
          : "Agendamento removido.",
      );
      setConfirm(null);
      schedules.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setDeleting(false);
    }
  }

  async function pausePush(companyId: string) {
    setBusyPush(companyId);
    try {
      const r = await doPausePush({ data: { company_id: companyId } });
      toast.success(`Envio pausado (${r.pausados.toLocaleString("pt-BR")} produto(s) aguardando).`);
      schedules.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao pausar envio");
    } finally {
      setBusyPush(null);
    }
  }

  async function resumePush(companyId: string) {
    setBusyPush(companyId);
    try {
      const r = await doResumePush({ data: { company_id: companyId } });
      toast.success(`Envio retomado (${r.retomados.toLocaleString("pt-BR")} produto(s)).`);
      schedules.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao retomar envio");
    } finally {
      setBusyPush(null);
    }
  }

  const companyIdsInList = useMemo(() => Array.from(new Set(rows.map((r) => r.company_id))), [rows]);
  const anyEnabled = rows.some((r) => r.enabled);
  const anyPending = rows.some((r) => (r.queue?.pendentes ?? 0) > 0);
  const anyPaused = rows.some((r) => (r.queue?.pausados ?? 0) > 0);

  async function bulk(action: "pause-sched" | "resume-sched" | "pause-push" | "resume-push") {
    setBulkBusy(action);
    try {
      if (action === "pause-sched" || action === "resume-sched") {
        const enabled = action === "resume-sched";
        await Promise.all(
          rows.filter((r) => r.enabled !== enabled).map((r) => doToggle({ data: { id: r.id, company_id: r.company_id, enabled } })),
        );
        toast.success(enabled ? "Todas as automações foram ativadas." : "Todas as automações foram pausadas.");
      } else {
        const fn = action === "pause-push" ? doPausePush : doResumePush;
        const res = await Promise.allSettled(companyIdsInList.map((cid) => fn({ data: { company_id: cid } })));
        const total = res.reduce((acc, r) => {
          if (r.status !== "fulfilled") return acc;
          const v = r.value as { pausados?: number; retomados?: number };
          return acc + (v.pausados ?? v.retomados ?? 0);
        }, 0);
        const failed = res.filter((r) => r.status === "rejected").length;
        toast.success(
          `${action === "pause-push" ? "Envio pausado" : "Envio retomado"} em ${companyIdsInList.length - failed} empresa(s) · ${total.toLocaleString("pt-BR")} produto(s)${failed ? ` · ${failed} falhou(aram)` : ""}`,
        );
      }
      schedules.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setBulkBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Boxes className="h-5 w-5 text-primary" /> Automação de estoque (várias empresas)
        </CardTitle>
        <CardDescription>
          Escolha as empresas e o horário: no momento programado, a atualização de estoque é enfileirada para
          todas elas ao mesmo tempo. Se uma empresa ainda estiver com automação em andamento, ela é pulada
          nesse ciclo (horário de Brasília).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Empresas</Label>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected((companies.data ?? []).map((c) => c.id))}
              >
                Selecionar todas
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Limpar</Button>
            </div>
          </div>
          <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-3">
            {(companies.data ?? []).map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={selected.includes(c.id)} onCheckedChange={() => toggleCompany(c.id)} />
                <span className="truncate">{c.nome}</span>
              </label>
            ))}
            {(companies.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma empresa disponível.</p>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Frequência</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as StockAutomationRow["frequency"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Diariamente</SelectItem>
                <SelectItem value="times_per_day">Várias vezes ao dia</SelectItem>
                <SelectItem value="weekly">Semanalmente</SelectItem>
                <SelectItem value="monthly">Mensalmente</SelectItem>
                <SelectItem value="interval">A cada X dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {frequency !== "times_per_day" && (
            <div className="space-y-1.5">
              <Label>Horário</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          )}
          {frequency === "times_per_day" && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Horários do dia</Label>
              <div className="flex flex-wrap items-center gap-2">
                {times.map((t, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input
                      type="time"
                      className="w-[7.5rem]"
                      value={t}
                      onChange={(e) =>
                        setTimes((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                      }
                    />
                    {times.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setTimes((prev) => prev.filter((_, j) => j !== i))}
                      >
                        ×
                      </Button>
                    )}
                  </div>
                ))}
                {times.length < 12 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setTimes((prev) => [...prev, "12:00"])}>
                    Adicionar horário
                  </Button>
                )}
              </div>
            </div>
          )}
          {frequency === "weekly" && (
            <div className="space-y-1.5">
              <Label>Dia da semana</Label>
              <Select value={weekday} onValueChange={setWeekday}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d, i) => (
                    <SelectItem key={d} value={String(i)}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {frequency === "monthly" && (
            <div className="space-y-1.5">
              <Label>Dia do mês (1–28)</Label>
              <Input type="number" min={1} max={28} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
            </div>
          )}
          {frequency === "interval" && (
            <div className="space-y-1.5">
              <Label>Intervalo (dias)</Label>
              <Input type="number" min={1} max={365} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-6">
          <div className="flex items-center gap-2">
            <Switch id="stk-ml" checked={considerMlStock} onCheckedChange={setConsiderMlStock} />
            <Label htmlFor="stk-ml">Considerar estoque do Mercado Livre</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="stk-status" checked={applyStatus} onCheckedChange={setApplyStatus} />
            <Label htmlFor="stk-status">Ativar/inativar conforme fornecedor</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="stk-changed" checked={onlyChanged} onCheckedChange={setOnlyChanged} />
            <Label htmlFor="stk-changed">Sincronizar somente o que mudou</Label>
          </div>
        </div>

        <Button onClick={save} disabled={saving || selected.length === 0}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Programar para {selected.length} empresa(s)
        </Button>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Programações</Label>
            {rows.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {anyEnabled ? (
                  <Button variant="outline" size="sm" disabled={!!bulkBusy} onClick={() => bulk("pause-sched")}>
                    {bulkBusy === "pause-sched" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Pause className="mr-1 h-3.5 w-3.5" />}
                    Pausar todas as automações
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled={!!bulkBusy} onClick={() => bulk("resume-sched")}>
                    {bulkBusy === "resume-sched" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                    Ativar todas as automações
                  </Button>
                )}
                {anyPending && (
                  <Button variant="destructive" size="sm" disabled={!!bulkBusy} onClick={() => bulk("pause-push")}>
                    {bulkBusy === "pause-push" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Pause className="mr-1 h-3.5 w-3.5" />}
                    Pausar envio ao Bling (todas)
                  </Button>
                )}
                {anyPaused && (
                  <Button variant="secondary" size="sm" disabled={!!bulkBusy} onClick={() => bulk("resume-push")}>
                    {bulkBusy === "resume-push" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                    Retomar envio ao Bling (todas)
                  </Button>
                )}
              </div>
            )}
          </div>
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma automação de estoque programada.</p>
          )}
          {rows.map((s) => {
            const steps = s.run?.steps ?? [];
            const total = steps.length || 4;
            const done = steps.filter((x) => x.status === "done" || x.status === "skipped").length;
            const stepPct = Math.round((done / total) * 100);
            const current = steps.find((x) => x.status === "running");
            const qd = s.queue;
            const qTotal = qd?.total ?? 0;
            const qDone = (qd?.concluidos ?? 0) + (qd?.erros ?? 0);
            const qLeft = Math.max(0, qTotal - qDone);
            const qPct = qTotal > 0 ? Math.round((qDone / qTotal) * 100) : 0;
            const showQueue = qTotal > 0;
            return (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{nameById.get(s.company_id) ?? s.company_id}</span>
                  <Badge variant="outline">{s.name}</Badge>
                  <Badge variant="outline">{s.options.consider_ml_stock !== false ? "Fornecedor + ML" : "Somente fornecedor"}</Badge>
                  {s.running && <Badge variant="secondary">Em andamento</Badge>}
                  {s.last_status === "skipped_running" && (
                    <Badge variant="outline">Pulada (já rodando)</Badge>
                  )}
                  {s.last_status === "error" && <Badge variant="destructive">Falhou</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {describe(s)} · próxima: {fmt(s.next_run_at)} · última: {fmt(s.last_run_at)}
                </p>
                {(steps.length > 0 || showQueue) && (
                  <div className="space-y-1 pt-1">
                    <Progress
                      value={
                        showQueue ? qPct : s.running ? stepPct : s.run?.status === "success" ? 100 : stepPct
                      }
                    />
                    {showQueue && (
                      <p className="text-xs font-medium">
                        {qDone.toLocaleString("pt-BR")} de {qTotal.toLocaleString("pt-BR")} produtos
                        atualizados · {qLeft.toLocaleString("pt-BR")} restante(s)
                        {qd?.erros ? ` · ${qd.erros.toLocaleString("pt-BR")} com erro` : ""}
                        {qd?.pausados ? ` · envio pausado (${qd.pausados.toLocaleString("pt-BR")})` : ""}
                      </p>
                    )}
                    {steps.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {s.running
                          ? `Etapa ${Math.min(done + 1, total)} de ${total}${current ? ` · ${current.label}` : ""}${current?.detail ? ` — ${current.detail}` : ""}`
                          : s.run?.status === "success"
                            ? `Concluída · ${total} de ${total} etapas`
                            : s.run?.status === "error"
                              ? `Interrompida em ${done} de ${total} etapas`
                              : `${done} de ${total} etapas`}
                      </p>
                    )}
                  </div>
                )}
                {(s.run?.error || s.integration?.last_error) && (
                  <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                    <span className="font-medium">Erro: </span>
                    {s.run?.error || s.integration?.last_error}
                  </div>
                )}
                {!s.run?.error &&
                  !s.integration?.last_error &&
                  s.integration?.status === "requer_reconexao" && (
                    <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                      Conexão com o Bling expirada — reconecte esta empresa em Integrações.
                    </div>
                  )}
              </div>
              <div className="flex items-center gap-2">
                {(qd?.pendentes ?? 0) > 0 && (
                  <Button variant="outline" size="sm" disabled={busyPush === s.company_id} onClick={() => pausePush(s.company_id)}>
                    {busyPush === s.company_id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Pause className="mr-1 h-3.5 w-3.5" />}
                    Pausar envio
                  </Button>
                )}
                {(qd?.pausados ?? 0) > 0 && (
                  <Button variant="secondary" size="sm" disabled={busyPush === s.company_id} onClick={() => resumePush(s.company_id)}>
                    {busyPush === s.company_id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                    Retomar envio
                  </Button>
                )}
                <AutomationLogDialog
                  companyId={s.company_id}
                  companyName={nameById.get(s.company_id) ?? s.company_id}
                />
                <Switch checked={s.enabled} onCheckedChange={(v) => toggle(s, v)} />
                <Button variant="ghost" size="icon" onClick={() => setConfirm(s)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>

            </div>
            );
          })}

        </div>

        <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover esta programação?</AlertDialogTitle>
              <AlertDialogDescription>
                {confirm && ((confirm.queue?.pendentes ?? 0) + (confirm.queue?.pausados ?? 0) > 0 || confirm.running)
                  ? `Existe envio em andamento para ${nameById.get(confirm.company_id) ?? "esta empresa"}. Ao remover, o envio será cancelado e ${(((confirm.queue?.pendentes ?? 0) + (confirm.queue?.pausados ?? 0))).toLocaleString("pt-BR")} produto(s) na fila não serão atualizados.`
                  : "A programação será removida. Nenhum envio está em andamento."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Voltar</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                onClick={(e) => {
                  e.preventDefault();
                  if (confirm) remove(confirm);
                }}
              >
                {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Remover e cancelar envio
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
