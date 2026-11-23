import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarClock, Loader2, Plus, Trash2 } from "lucide-react";
import {
  listAutomationSchedules,
  saveAutomationSchedule,
  toggleAutomationSchedule,
  deleteAutomationSchedule,
  type AutomationSchedule,
} from "@/lib/automations.functions";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function fmt(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return "—"; }
}

function describe(s: AutomationSchedule) {
  const hora = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  if (s.frequency === "daily") return `Todos os dias às ${hora}`;
  if (s.frequency === "weekly") return `Toda ${WEEKDAYS[s.weekday ?? 1]} às ${hora}`;
  if (s.frequency === "monthly") return `Todo dia ${s.day_of_month ?? 1} às ${hora}`;
  return `A cada ${s.interval_days ?? 1} dia(s) às ${hora}`;
}

export function SchedulesCard({ companyId }: { companyId?: string }) {
  const fetchList = useServerFn(listAutomationSchedules);
  const doSave = useServerFn(saveAutomationSchedule);
  const doToggle = useServerFn(toggleAutomationSchedule);
  const doDelete = useServerFn(deleteAutomationSchedule);

  const list = useQuery({
    queryKey: ["automation-schedules", companyId],
    queryFn: () => fetchList({ data: { company_id: companyId! } }),
    enabled: !!companyId,
  });

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("Automação programada");
  const [frequency, setFrequency] = useState<AutomationSchedule["frequency"]>("daily");
  const [time, setTime] = useState("03:00");
  const [weekday, setWeekday] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [intervalDays, setIntervalDays] = useState("3");
  const [includeStores, setIncludeStores] = useState(true);
  const [applyStatus, setApplyStatus] = useState(true);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setOpen(false); setEditingId(null); }, [companyId]);

  function startNew() {
    setEditingId(null);
    setName("Automação programada");
    setFrequency("daily");
    setTime("03:00");
    setWeekday("1");
    setDayOfMonth("1");
    setIntervalDays("3");
    setIncludeStores(true);
    setApplyStatus(true);
    setOnlyChanged(true);
    setOpen(true);
  }

  function startEdit(s: AutomationSchedule) {
    setEditingId(s.id);
    setName(s.name);
    setFrequency(s.frequency);
    setTime(`${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`);
    setWeekday(String(s.weekday ?? 1));
    setDayOfMonth(String(s.day_of_month ?? 1));
    setIntervalDays(String(s.interval_days ?? 3));
    setIncludeStores(s.options?.include_stores !== false);
    setApplyStatus(s.options?.apply_status !== false);
    setOnlyChanged(s.options?.only_changed !== false);
    setOpen(true);
  }

  async function save() {
    if (!companyId) return;
    const [h, m] = time.split(":");
    setSaving(true);
    try {
      await doSave({
        data: {
          id: editingId ?? undefined,
          company_id: companyId,
          slug: "estoque-preco-fornecedor",
          name,
          enabled: true,
          frequency,
          hour: Number(h ?? 3),
          minute: Number(m ?? 0),
          weekday: frequency === "weekly" ? Number(weekday) : null,
          day_of_month: frequency === "monthly" ? Number(dayOfMonth) : null,
          interval_days: frequency === "interval" ? Number(intervalDays) : null,
          include_stores: includeStores,
          apply_status: applyStatus,
          only_changed: onlyChanged,
        },
      });
      toast.success("Agendamento salvo.");
      setOpen(false);
      list.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar agendamento");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(s: AutomationSchedule, enabled: boolean) {
    if (!companyId) return;
    try {
      await doToggle({ data: { id: s.id, company_id: companyId, enabled } });
      list.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  async function remove(s: AutomationSchedule) {
    if (!companyId) return;
    try {
      await doDelete({ data: { id: s.id, company_id: companyId } });
      toast.success("Agendamento removido.");
      list.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" /> Programação
            </CardTitle>
            <CardDescription>
              Execute a automação sozinha no dia e hora escolhidos (horário de Brasília), sem precisar deixar o sistema aberto.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={startNew} disabled={!companyId}>
            <Plus className="mr-2 h-4 w-4" /> Novo agendamento
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {open && (
          <div className="space-y-4 rounded-md border p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Frequência</Label>
                <Select value={frequency} onValueChange={(v) => setFrequency(v as AutomationSchedule["frequency"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Diariamente</SelectItem>
                    <SelectItem value="weekly">Semanalmente</SelectItem>
                    <SelectItem value="monthly">Mensalmente</SelectItem>
                    <SelectItem value="interval">A cada X dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Horário</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
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
                <Switch id="sch-stores" checked={includeStores} onCheckedChange={setIncludeStores} />
                <Label htmlFor="sch-stores">Incluir multilojas</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="sch-status" checked={applyStatus} onCheckedChange={setApplyStatus} />
                <Label htmlFor="sch-status">Ativar/inativar conforme fornecedor</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="sch-changed" checked={onlyChanged} onCheckedChange={setOnlyChanged} />
                <Label htmlFor="sch-changed">Sincronizar somente o que mudou</Label>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            </div>
          </div>
        )}

        {(list.data ?? []).length === 0 && !open && (
          <p className="text-sm text-muted-foreground">Nenhum agendamento criado.</p>
        )}

        {(list.data ?? []).map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{s.name}</span>
                {s.last_status && (
                  <Badge variant={s.last_status === "error" ? "destructive" : "secondary"}>{s.last_status}</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {describe(s)} · próxima: {fmt(s.next_run_at)} · última: {fmt(s.last_run_at)}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.options?.include_stores !== false ? "Com multilojas" : "Somente Bling"} ·{" "}
                {s.options?.apply_status !== false ? "com ativar/inativar" : "sem status"} ·{" "}
                {s.options?.only_changed !== false ? "somente o que mudou" : "envia tudo"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={s.enabled} onCheckedChange={(v) => toggle(s, v)} />
              <Button variant="outline" size="sm" onClick={() => startEdit(s)}>Editar</Button>
              <Button variant="ghost" size="icon" onClick={() => remove(s)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
