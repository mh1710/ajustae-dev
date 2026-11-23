import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Loader2, Pause, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  adminCdnRotationAction,
  adminGetCdnRotationDashboard,
  adminSaveCdnRotationSettings,
  adminStartCdnRotation,
} from "@/lib/cdn-rotation.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const defaultSettings = {
  enabled: false,
  mode: "manual" as "manual" | "event_driven" | "periodic",
  interval_days: 365,
  grace_days: 7,
  start_hour: 2,
  timezone: "America/Sao_Paulo",
  max_products_per_day: 1000,
  require_revoke_approval: true,
};

const statusLabel: Record<string, string> = {
  planned: "Planejada",
  activating: "Ativando chave",
  stabilizing: "Estabilizando KV",
  preparing: "Preparando",
  pushing: "Atualizando Bling",
  verifying: "Verificando",
  grace: "Período de graça",
  awaiting_revoke: "Aguardando revogação",
  revoking: "Revogando",
  completed: "Concluída",
  paused: "Pausada",
  failed: "Falhou",
  cancelled: "Cancelada",
  rolling_back: "Restaurando URLs antigas",
  rolled_back: "Rollback concluído",
};

type CdnIntegration = {
  id: string;
  company_id: string;
  status: string;
  companies?: { nome?: string | null } | null;
};

type CdnKeyVersion = {
  id: string;
  public_id: string;
};

type CdnRotationJob = {
  id: string;
  status: string;
  created_at: string;
  confirmed_products: number;
  total_products: number;
  error_products: number;
  conflict_products: number;
  old_key_version_id?: string | null;
  new_key_version_id?: string | null;
  last_error?: string | null;
  external_consumers_confirmed_at?: string | null;
  revoke_approved_at?: string | null;
};

export function AdminCdnSecurity() {
  const queryClient = useQueryClient();
  const getDashboard = useServerFn(adminGetCdnRotationDashboard);
  const saveSettings = useServerFn(adminSaveCdnRotationSettings);
  const startRotation = useServerFn(adminStartCdnRotation);
  const rotationAction = useServerFn(adminCdnRotationAction);
  const [form, setForm] = useState(defaultSettings);
  const [integrationId, setIntegrationId] = useState("");
  const [consumersConfirmed, setConsumersConfirmed] = useState(false);

  const dashboard = useQuery({
    queryKey: ["admin-cdn-rotation"],
    queryFn: () => getDashboard({}),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (dashboard.data?.settings) {
      const settings = dashboard.data.settings as typeof defaultSettings;
      setForm({
        enabled: !!settings.enabled,
        mode: settings.mode,
        interval_days: Number(settings.interval_days),
        grace_days: Number(settings.grace_days),
        start_hour: Number(settings.start_hour),
        timezone: settings.timezone,
        max_products_per_day: Number(settings.max_products_per_day),
        require_revoke_approval: !!settings.require_revoke_approval,
      });
    }
  }, [dashboard.data?.settings]);

  const integrations = useMemo(
    () => (dashboard.data?.integrations ?? []) as CdnIntegration[],
    [dashboard.data?.integrations],
  );
  useEffect(() => {
    if (!integrationId && integrations[0]?.id) setIntegrationId(integrations[0].id);
  }, [integrationId, integrations]);

  const versions = useMemo(
    () =>
      new Map(
        ((dashboard.data?.versions ?? []) as CdnKeyVersion[]).map((version) => [
          version.id,
          version,
        ]),
      ),
    [dashboard.data?.versions],
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-cdn-rotation"] });

  const save = useMutation({
    mutationFn: () => saveSettings({ data: form }),
    onSuccess: () => {
      toast.success("Política CDN salva. Nenhuma rotação foi iniciada.");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Falha ao salvar política."),
  });

  const start = useMutation({
    mutationFn: (kind: "dry_run" | "pilot" | "full") =>
      startRotation({
        data: {
          integration_id: integrationId,
          kind,
          external_consumers_confirmed: kind === "dry_run" ? false : consumersConfirmed,
          consumer_scope: "bling_only",
        },
      }),
    onSuccess: () => {
      toast.success("Rotação criada e colocada na fila.");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar rotação."),
  });

  const action = useMutation({
    mutationFn: ({
      job_id,
      action,
    }: {
      job_id: string;
      action:
        | "pause"
        | "resume"
        | "expand_full"
        | "confirm_consumers"
        | "rollback"
        | "cancel"
        | "approve_revoke";
    }) => rotationAction({ data: { job_id, action } }),
    onSuccess: () => refresh(),
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Falha na ação."),
  });

  function run(kind: "dry_run" | "pilot" | "full") {
    if (!integrationId) return toast.error("Selecione uma integração.");
    if (kind !== "dry_run" && !consumersConfirmed) {
      return toast.error("Confirme o inventário de consumidores externos.");
    }
    const description =
      kind === "dry_run"
        ? "Simular a criação dos links sem alterar Bling ou banco?"
        : kind === "pilot"
          ? "Iniciar piloto real em até 10 produtos? A chave antiga continuará válida."
          : "Iniciar rotação real de todos os produtos desta integração?";
    if (confirm(description)) start.mutate(kind);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Segurança da CDN</CardTitle>
        </div>
        <CardDescription>
          URLs assinadas por imagem, atualização confirmada no Bling e revogação somente depois dos
          gates de cache e consumidores.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {dashboard.isLoading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando política…
          </div>
        ) : dashboard.isError ? (
          <p className="text-sm text-destructive">
            {dashboard.error instanceof Error
              ? dashboard.error.message
              : "Não foi possível carregar a configuração."}
          </p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <Label>Modo</Label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.mode}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      mode: event.target.value as typeof form.mode,
                      enabled: false,
                    })
                  }
                >
                  <option value="manual">Manual</option>
                  <option value="event_driven">Por incidente</option>
                  <option value="periodic">Periódico</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Intervalo (dias)</Label>
                <Input
                  type="number"
                  min={30}
                  max={730}
                  disabled={form.mode !== "periodic"}
                  value={form.interval_days}
                  onChange={(event) =>
                    setForm({ ...form, interval_days: Number(event.target.value) })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Graça mínima (dias)</Label>
                <Input
                  type="number"
                  min={2}
                  max={90}
                  value={form.grace_days}
                  onChange={(event) => setForm({ ...form, grace_days: Number(event.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label>Máximo de produtos/24h</Label>
                <Input
                  type="number"
                  min={1}
                  max={40000}
                  value={form.max_products_per_day}
                  onChange={(event) =>
                    setForm({ ...form, max_products_per_day: Number(event.target.value) })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Hora de início</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={form.start_hour}
                  onChange={(event) => setForm({ ...form, start_hour: Number(event.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label>Fuso horário</Label>
                <Input
                  value={form.timezone}
                  onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.enabled}
                  disabled={form.mode !== "periodic"}
                  onCheckedChange={(enabled) => setForm({ ...form, enabled })}
                />
                Agendamento ativo
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.require_revoke_approval}
                  onCheckedChange={(require_revoke_approval) =>
                    setForm({ ...form, require_revoke_approval })
                  }
                />
                Exigir aprovação para revogar
              </label>
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
                política
              </Button>
            </div>

            <div className="rounded-md border p-3">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <div className="space-y-1">
                  <Label>Integração para simulação ou execução manual</Label>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={integrationId}
                    onChange={(event) => setIntegrationId(event.target.value)}
                  >
                    {integrations.map((integration) => (
                      <option key={integration.id} value={integration.id}>
                        {integration.companies?.nome ?? integration.company_id} ·{" "}
                        {integration.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <Switch checked={consumersConfirmed} onCheckedChange={setConsumersConfirmed} />
                  Produtos sem canais externos ou canais inventariados
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => run("dry_run")}
                  disabled={start.isPending}
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Simular
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => run("pilot")}
                  disabled={start.isPending}
                >
                  Piloto de 10 produtos
                </Button>
                <Button size="sm" onClick={() => run("full")} disabled={start.isPending}>
                  <KeyRound className="mr-2 h-4 w-4" /> Rotação completa
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Execuções recentes</Label>
                <Button variant="ghost" size="sm" onClick={() => dashboard.refetch()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              {((dashboard.data?.jobs ?? []) as CdnRotationJob[]).map((job) => {
                const oldVersion = job.old_key_version_id
                  ? versions.get(job.old_key_version_id)
                  : undefined;
                const newVersion = job.new_key_version_id
                  ? versions.get(job.new_key_version_id)
                  : undefined;
                return (
                  <div key={job.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={job.status === "paused" ? "destructive" : "outline"}>
                        {statusLabel[job.status] ?? job.status}
                      </Badge>
                      <span className="text-muted-foreground">
                        {new Date(job.created_at).toLocaleString("pt-BR")}
                      </span>
                      <span className="ml-auto">
                        {job.confirmed_products}/{job.total_products} confirmados
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {oldVersion?.public_id ?? "sem chave anterior"} →{" "}
                      {newVersion?.public_id ?? "preparando"}
                      {job.error_products > 0 && ` · ${job.error_products} erro(s)`}
                      {job.conflict_products > 0 && ` · ${job.conflict_products} conflito(s)`}
                    </div>
                    {job.last_error && (
                      <p className="mt-2 text-xs text-destructive">{job.last_error}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {!["completed", "cancelled", "paused", "awaiting_revoke"].includes(
                        job.status,
                      ) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => action.mutate({ job_id: job.id, action: "pause" })}
                        >
                          <Pause className="mr-1 h-3 w-3" /> Pausar
                        </Button>
                      )}
                      {job.status === "paused" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => action.mutate({ job_id: job.id, action: "resume" })}
                        >
                          <Play className="mr-1 h-3 w-3" /> Retomar
                        </Button>
                      )}
                      {["paused", "grace", "awaiting_revoke"].includes(job.status) &&
                        job.total_products <= 10 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              confirm(
                                "Expandir este mesmo piloto para todos os produtos da integração?",
                              ) && action.mutate({ job_id: job.id, action: "expand_full" })
                            }
                          >
                            Expandir para todos
                          </Button>
                        )}
                      {["paused", "grace", "awaiting_revoke"].includes(job.status) &&
                        job.confirmed_products > 0 && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              confirm(
                                "Reenviar as URLs antigas ao Bling e restaurar o banco produto por produto?",
                              ) && action.mutate({ job_id: job.id, action: "rollback" })
                            }
                          >
                            Rollback
                          </Button>
                        )}
                      {job.status === "paused" && !job.external_consumers_confirmed_at && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            confirm(
                              "Confirmar que produtos e canais externos foram inventariados para este ciclo?",
                            ) && action.mutate({ job_id: job.id, action: "confirm_consumers" })
                          }
                        >
                          Confirmar consumidores
                        </Button>
                      )}
                      {job.status === "awaiting_revoke" && (
                        <Button
                          size="sm"
                          onClick={() =>
                            confirm(
                              "Revogar definitivamente a chave antiga após o purge e os canários?",
                            ) && action.mutate({ job_id: job.id, action: "approve_revoke" })
                          }
                        >
                          Aprovar revogação
                        </Button>
                      )}
                      {!["completed", "cancelled", "revoking"].includes(job.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            confirm("Cancelar esta execução sem revogar chaves?") &&
                            action.mutate({ job_id: job.id, action: "cancel" })
                          }
                        >
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
              {!dashboard.data?.jobs?.length && (
                <p className="text-sm text-muted-foreground">Nenhuma rotação executada.</p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
