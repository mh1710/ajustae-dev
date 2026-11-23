import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, CloudUpload, RefreshCw, AlertTriangle, Trash2, PowerOff, Pause, Play, Ban, History, Gauge } from "lucide-react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { PricingPolicyAlert } from "@/components/pricing-policy-alert";
import { getCustomFieldsOverview } from "@/lib/bling-custom-fields.functions";
import { unifiedQueueProgress, visibleCustomFieldJobs } from "@/lib/custom-field-queue-progress";
import { supabase } from "@/integrations/supabase/client";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  enqueueBlingPush,
  enqueueBlingDelete,
  enqueueBlingInactivate,
  getBlingPushProgress,
  retryBlingPushErrors,
  listBlingPushErrors,
  kickBlingPushWorker,
  pauseBlingPush,
  resumeBlingPush,
  cancelBlingPush,
  deleteBlingPushErrors,
  getBlingDailyUsage,
  listBlingPushHistory,
} from "@/lib/bling-push.functions";



interface Props {
  companyId: string | undefined;
  selectedIds: string[];
}

export function BlingPushCard({ companyId, selectedIds }: Props) {
  const qc = useQueryClient();
  const fnEnqueue = useServerFn(enqueueBlingPush);
  const fnDelete = useServerFn(enqueueBlingDelete);
  const fnInactivate = useServerFn(enqueueBlingInactivate);
  const fnProgress = useServerFn(getBlingPushProgress);
  const fnRetry = useServerFn(retryBlingPushErrors);
  const fnList = useServerFn(listBlingPushErrors);
  const fnKick = useServerFn(kickBlingPushWorker);
  const fnPause = useServerFn(pauseBlingPush);
  const fnResume = useServerFn(resumeBlingPush);
  const fnCancel = useServerFn(cancelBlingPush);
  const fnDeleteErrors = useServerFn(deleteBlingPushErrors);
  const fnUsage = useServerFn(getBlingDailyUsage);
  const fnHistory = useServerFn(listBlingPushHistory);
  const fnCustomFieldsOverview = useServerFn(getCustomFieldsOverview);


  const [scope, setScope] = useState<"all" | "selected">("all");
  const [tipo, setTipo] = useState<"ambos" | "preco" | "estoque" | "todos" | "criar">("ambos");
  const [destino, setDestino] = useState<"bling" | "bling_multilojas">("bling");
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [inactivating, setInactivating] = useState(false);
  const [inactivateOpen, setInactivateOpen] = useState(false);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteErrorsOpen, setDeleteErrorsOpen] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<"all" | "concluido" | "erro">("all");
  const [historyPage, setHistoryPage] = useState(0);
  const historyPageSize = 50;

  // Após enfileirar, mantém o polling ativo por um tempo mesmo que a fila ainda
  // esteja sendo montada em segundo plano (senão só aparece ao recarregar).
  const [pollUntil, setPollUntil] = useState(0);
  const { access } = useAccess();
  const canPush = access.can_push_bling;

  const progress = useQuery({
    queryKey: ["bling-push-progress", companyId],
    queryFn: () => fnProgress({ data: { company_id: companyId! } }),
    enabled: !!companyId,
    refetchInterval: (q) => {
      const d = q.state.data as { pendentes?: number } | undefined;
      if (d && (d.pendentes ?? 0) > 0) return 3000;
      return Date.now() < pollUntil ? 2000 : false;
    },
  });

  const customFieldsProgress = useQuery({
    queryKey: ["cf-overview", companyId],
    queryFn: () => {
      if (!companyId) throw new Error("Selecione uma empresa.");
      return fnCustomFieldsOverview({ data: { company_id: companyId } });
    },
    enabled: !!companyId,
    // Continua consultando mesmo com a fila comum vazia para descobrir novos envios.
    refetchInterval: 6000,
  });
  const customFieldJobs = visibleCustomFieldJobs(customFieldsProgress.data?.jobs ?? []);
  const customFieldJobIds = customFieldJobs.map((job) => job.id);
  const customFieldRequests = useQuery({
    queryKey: ["cf-queue-requests", companyId, customFieldJobIds],
    queryFn: async () => {
      if (!companyId || customFieldJobIds.length === 0) return 0;
      const { count, error } = await supabase.from("bling_custom_field_logs" as never)
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId).in("job_id", customFieldJobIds);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!companyId && customFieldJobIds.length > 0,
    refetchInterval: 6000,
  });


  const errors = useQuery({
    queryKey: ["bling-push-errors", companyId],
    queryFn: () => fnList({ data: { company_id: companyId!, limit: 50 } }),
    enabled: !!companyId && errorsOpen,
  });

  const usage = useQuery({
    queryKey: ["bling-daily-usage", companyId],
    queryFn: () => fnUsage({ data: { company_id: companyId! } }),
    enabled: !!companyId,
    refetchInterval: (q) => {
      const p = (progress.data as { pendentes?: number } | undefined);
      return p && (p?.pendentes ?? 0) > 0 ? 5000 : 60000;
    },
  });

  const history = useQuery({
    queryKey: ["bling-push-history", companyId, historyStatus, historyPage],
    queryFn: () => fnHistory({ data: {
      company_id: companyId!,
      limit: historyPageSize,
      offset: historyPage * historyPageSize,
      status: historyStatus === "all" ? undefined : historyStatus,
    } }),
    enabled: !!companyId && historyOpen,
  });

  useEffect(() => {
    if (selectedIds.length === 0 && scope === "selected") setScope("all");
  }, [selectedIds.length, scope]);

  const p = progress.data as (undefined | {
    total: number; pendentes: number; pausados?: number; concluidos: number; erros: number;
    products_total?: number; products_done?: number;
    requests_total?: number; requests_done?: number;
    oldest_pending: string | null; last_processed: string | null;
  });
  const { total, done, pct, productsTotal, productsDone, productsPct, pending, paused, errors: queueErrors } =
    unifiedQueueProgress(p, customFieldJobs, customFieldRequests.data ?? 0);

  async function handleEnqueue() {
    if (!companyId) return;
    if (!canPush) {
      toast.error("Seu usuário não tem permissão para enviar ao Bling.");
      return;
    }
    setBusy(true);
    // mantém o painel de progresso atualizando por 60s a partir de agora
    setPollUntil(Date.now() + 60_000);
    try {
      const ids = scope === "selected" ? selectedIds : undefined;
      const r = await fnEnqueue({ data: {
        company_id: companyId, product_ids: ids, scope: tipo,
        include_stores: destino === "bling_multilojas",
        only_changed: onlyChanged,
      } });
      if ((r as { async?: boolean }).async) {
        toast.success("Fila sendo montada em segundo plano. O progresso aparece aqui em instantes.");
      } else {
        toast.success(
          `Fila: ${r.created_preco} preço, ${r.created_estoque} estoque, ${r.created_produto ?? 0} atualização, ${r.created_criar ?? 0} criação`
            + ((r.created_lojas ?? 0) > 0 ? `, ${r.created_lojas} loja(s)` : "")
            + ` (atualizados: ${r.updated_existing}).`
            + (r.skipped_sem_bling_id ? ` Sem ID Bling (ignorados): ${r.skipped_sem_bling_id}.` : "")
            + (r.skipped_sem_deposito ? ` Sem depósito: ${r.skipped_sem_deposito}.` : "")
            + ((r as { skipped_sem_mudanca?: number }).skipped_sem_mudanca
                ? ` Já sincronizados (ignorados): ${(r as { skipped_sem_mudanca?: number }).skipped_sem_mudanca}.`
                : ""),
        );
      }

      setPollUntil(Date.now() + 60_000);
      await fnKick({ data: { company_id: companyId } }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["bling-push-progress", companyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enfileirar");
    } finally { setBusy(false); }
  }



  async function handleRetry() {
    if (!companyId) return;
    try {
      const r = await fnRetry({ data: { company_id: companyId } });
      toast.success(`${r.reenfileirados} item(ns) reenfileirados.`);
      await fnKick({ data: { company_id: companyId } }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["bling-push-progress", companyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao reenfileirar");
    }
  }

  async function handleDelete() {
    if (!companyId || selectedIds.length === 0) return;
    setDeleting(true);
    try {
      const r = await fnDelete({ data: { company_id: companyId, product_ids: selectedIds } });
      toast.success(
        `Fila de exclusão: ${r.created} enfileirado(s)` +
        (r.updated_existing ? `, ${r.updated_existing} atualizado(s)` : "") +
        (r.skipped_sem_bling_id ? `. Sem ID Bling: ${r.skipped_sem_bling_id}.` : "."),
      );
      await fnKick({ data: { company_id: companyId } }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["bling-push-progress", companyId] });
      qc.invalidateQueries({ queryKey: ["products"] });
      setDeleteOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enfileirar exclusão");
    } finally { setDeleting(false); }
  }

  async function handleInactivate() {
    if (!companyId || selectedIds.length === 0) return;
    setInactivating(true);
    try {
      const r = await fnInactivate({ data: { company_id: companyId, product_ids: selectedIds } });
      toast.success(
        `Fila de inativação: ${r.created} enfileirado(s)` +
        (r.updated_existing ? `, ${r.updated_existing} atualizado(s)` : "") +
        (r.skipped_sem_bling_id ? `. Sem ID Bling: ${r.skipped_sem_bling_id}.` : "."),
      );
      await fnKick({ data: { company_id: companyId } }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["bling-push-progress", companyId] });
      qc.invalidateQueries({ queryKey: ["products"] });
      setInactivateOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enfileirar inativação");
    } finally { setInactivating(false); }
  }

  async function handlePause() {
    if (!companyId) return;
    setQueueBusy(true);
    try {
      const r = await fnPause({ data: { company_id: companyId } });
      toast.success(`${r.pausados} item(ns) pausado(s).`);
      qc.invalidateQueries({ queryKey: ["bling-push-progress", companyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao pausar");
    } finally { setQueueBusy(false); }
  }

  async function handleResume() {
    if (!companyId) return;
    setQueueBusy(true);
    try {
      const r = await fnResume({ data: { company_id: companyId } });
      toast.success(`${r.retomados} item(ns) retomado(s).`);
      qc.invalidateQueries({ queryKey: ["bling-push-progress", companyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao retomar");
    } finally { setQueueBusy(false); }
  }

  async function handleCancel() {
    if (!companyId) return;
    setQueueBusy(true);
    try {
      const r = await fnCancel({ data: { company_id: companyId } });
      toast.success(`${r.cancelados} item(ns) cancelado(s).`);
      qc.invalidateQueries({ queryKey: ["bling-push-progress", companyId] });
      setCancelOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao cancelar");
    } finally { setQueueBusy(false); }
  }

  async function handleDeleteErrors() {
    if (!companyId) return;
    setQueueBusy(true);
    try {
      const r = await fnDeleteErrors({ data: { company_id: companyId } });
      toast.success(`${r.excluidos} erro(s) excluído(s).`);
      qc.invalidateQueries({ queryKey: ["bling-push-progress", companyId] });
      qc.invalidateQueries({ queryKey: ["bling-push-errors", companyId] });
      setDeleteErrorsOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir erros");
    } finally { setQueueBusy(false); }
  }







  const disabledScope = scope === "selected" && selectedIds.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CloudUpload className="h-5 w-5" /> Sincronizar para o Bling
        </CardTitle>
        <CardDescription>
          Envia preço, estoque ou o produto completo desta base para o Bling, respeitando o limite de 3 req/s. Use "Cadastrar produtos novos" primeiro para criar no Bling os itens que ainda não têm ID; depois rode preço/estoque ou "Todos os campos" para atualizar os existentes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PricingPolicyAlert companyId={companyId} />
        <div className="rounded-md border p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1 min-w-[220px] space-y-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Gauge className="h-4 w-4" />
                Requisições hoje ao Bling
              </div>
              <div className="text-xs text-muted-foreground">
                {usage.data
                  ? `${usage.data.used.toLocaleString("pt-BR")} / ${usage.data.limit.toLocaleString("pt-BR")} (${usage.data.remaining.toLocaleString("pt-BR")} restantes)`
                  : "—"}
              </div>
            </div>
            <Progress
              value={usage.data ? Math.min(100, Math.round((usage.data.used / usage.data.limit) * 100)) : 0}
              className={usage.data && usage.data.used / usage.data.limit >= 0.9 ? "[&>div]:bg-destructive" : usage.data && usage.data.used / usage.data.limit >= 0.7 ? "[&>div]:bg-amber-500" : ""}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => { setHistoryPage(0); setHistoryOpen(true); }}>
            <History className="mr-2 h-4 w-4" /> Logs
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <div className="text-xs mb-1 text-muted-foreground">Escopo</div>
            <Select value={scope} onValueChange={(v) => setScope(v as "all" | "selected")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os produtos</SelectItem>
                <SelectItem value="selected" disabled={selectedIds.length === 0}>
                  Somente selecionados ({selectedIds.length.toLocaleString("pt-BR")})
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs mb-1 text-muted-foreground">O que sincronizar</div>
            <Select value={tipo} onValueChange={(v) => setTipo(v as "ambos" | "preco" | "estoque" | "todos" | "criar")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="criar">Cadastrar no Bling (força criar, sobrescreve ID antigo)</SelectItem>
                <SelectItem value="ambos">Preço e estoque</SelectItem>
                <SelectItem value="preco">Somente preço</SelectItem>
                <SelectItem value="estoque">Somente estoque</SelectItem>
                <SelectItem value="todos">Todos os campos (cadastra novos + atualiza existentes)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs mb-1 text-muted-foreground">Destino</div>
            <Select
              value={destino}
              onValueChange={(v) => setDestino(v as "bling" | "bling_multilojas")}
              disabled={tipo === "criar"}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bling">Somente Bling</SelectItem>
                <SelectItem value="bling_multilojas">Bling + Multilojas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={!companyId || busy || disabledScope || !canPush}
              onClick={handleEnqueue}
              title={canPush ? undefined : "Sem permissão para enviar ao Bling"}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-2 h-4 w-4" />}
              Enviar ao Bling
            </Button>
          </div>
        </div>

        <label className="flex items-start gap-2 rounded-md border p-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-primary"
            checked={onlyChanged}
            onChange={(e) => setOnlyChanged(e.target.checked)}
            disabled={tipo === "criar"}
          />
          <span>
            Enviar somente o que mudou
            <span className="block text-xs text-muted-foreground">
              Compara preço, estoque e campos do cadastro — incluindo imagens, descrições, peso e medidas — com o último envio ao Bling. Produtos sem alterações não geram envio; nos alterados, envia apenas os campos diferentes.
            </span>
          </span>
        </label>

        {!canPush && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Seu usuário não tem permissão para enviar dados ao Bling. Peça a um administrador para liberar
            no painel de administração.
          </div>
        )}


        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium text-destructive flex items-center gap-2">
              <Trash2 className="h-4 w-4" /> Excluir produtos do Bling
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Remove os produtos selecionados no Bling e também na base interna. Ação irreversível.
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={!companyId || selectedIds.length === 0 || deleting}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Excluir selecionados ({selectedIds.length.toLocaleString("pt-BR")})
          </Button>
        </div>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <PowerOff className="h-4 w-4" /> Inativar produtos no Bling
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Marca os produtos selecionados como Inativos no Bling (situação = I). Não apaga nada — pode ser revertido depois.
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!companyId || selectedIds.length === 0 || inactivating}
            onClick={() => setInactivateOpen(true)}
            className="border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
          >
            <PowerOff className="mr-2 h-4 w-4" />
            Inativar selecionados ({selectedIds.length.toLocaleString("pt-BR")})
          </Button>
        </div>

        <AlertDialog open={inactivateOpen} onOpenChange={setInactivateOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Inativar {selectedIds.length.toLocaleString("pt-BR")} produto(s) no Bling?</AlertDialogTitle>
              <AlertDialogDescription>
                Cada produto terá a situação alterada para Inativo no Bling via API. Os registros permanecem na base interna e podem ser reativados depois manualmente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={inactivating}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); void handleInactivate(); }}
                disabled={inactivating}
              >
                {inactivating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PowerOff className="mr-2 h-4 w-4" />}
                Confirmar inativação
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>



        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir {selectedIds.length.toLocaleString("pt-BR")} produto(s) do Bling?</AlertDialogTitle>
              <AlertDialogDescription>
                Cada produto será removido no Bling via API e, em seguida, apagado da base interna deste sistema. Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); void handleDelete(); }}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Confirmar exclusão
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>




        {((p && total > 0) || customFieldJobs.length > 0) && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="text-sm font-medium">Progresso da fila</div>
            <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{done}/{total}</Badge>
                {(p?.pendentes ?? 0) + pending > 0 ? <Badge variant="outline">{(p?.pendentes ?? 0) + pending} pendentes</Badge> : null}
                {(p?.pausados ?? 0) + paused > 0 ? <Badge variant="outline">{(p?.pausados ?? 0) + paused} pausados</Badge> : null}
                {queueErrors > 0 ? <Badge variant="destructive">{queueErrors} com erro</Badge> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(p?.pendentes ?? 0) > 0 ? (
                  <Button variant="outline" size="sm" onClick={handlePause} disabled={queueBusy}>
                    <Pause className="mr-2 h-4 w-4" /> Pausar
                  </Button>
                ) : null}
                {(p?.pausados ?? 0) > 0 ? (
                  <Button variant="outline" size="sm" onClick={handleResume} disabled={queueBusy}>
                    <Play className="mr-2 h-4 w-4" /> Retomar
                  </Button>
                ) : null}
                {((p?.pendentes ?? 0) > 0 || (p?.pausados ?? 0) > 0) ? (
                  <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)} disabled={queueBusy}>
                    <Ban className="mr-2 h-4 w-4" /> Cancelar
                  </Button>
                ) : null}
                {p?.erros ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setErrorsOpen(true)}>
                      <AlertTriangle className="mr-2 h-4 w-4" /> Ver erros
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleRetry}>
                      <RefreshCw className="mr-2 h-4 w-4" /> Reenfileirar erros
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setDeleteErrorsOpen(true)} disabled={queueBusy}
                      className="border-destructive/50 text-destructive hover:bg-destructive/10">
                      <Trash2 className="mr-2 h-4 w-4" /> Excluir erros
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
            <div className="space-y-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Produtos</span>
                  <span className="tabular-nums text-muted-foreground">
                    {productsDone.toLocaleString("pt-BR")} / {productsTotal.toLocaleString("pt-BR")} ({productsPct}%)
                  </span>
                </div>
                <Progress value={productsPct} />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Requisições</span>
                  <span className="tabular-nums text-muted-foreground">
                    {done.toLocaleString("pt-BR")} / {total.toLocaleString("pt-BR")} ({pct}%)
                  </span>
                </div>
                <Progress value={pct} />
              </div>
            </div>
            {p?.last_processed ? (
              <div className="text-xs text-muted-foreground">
                Último processado: {new Date(p.last_processed).toLocaleString("pt-BR")}
              </div>
            ) : null}
            </>
            {customFieldsProgress.isError && (
              <div className="text-xs text-destructive">Não foi possível atualizar o progresso dos campos customizados.</div>
            )}
            {customFieldRequests.isError && (
              <div className="text-xs text-destructive">Não foi possível atualizar a contagem de requisições.</div>
            )}
          </div>
        )}


        <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancelar sincronização?</AlertDialogTitle>
              <AlertDialogDescription>
                Todos os itens pendentes e pausados serão descartados da fila. Itens já processados e com erro permanecem no histórico. Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={queueBusy}>Voltar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); void handleCancel(); }}
                disabled={queueBusy}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {queueBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
                Confirmar cancelamento
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={deleteErrorsOpen} onOpenChange={setDeleteErrorsOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir itens com erro?</AlertDialogTitle>
              <AlertDialogDescription>
                Os itens com erro serão removidos permanentemente da fila. Use quando quiser recomeçar do zero em vez de reenfileirar.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={queueBusy}>Voltar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); void handleDeleteErrors(); }}
                disabled={queueBusy}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {queueBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Excluir erros
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>


        <Dialog open={errorsOpen} onOpenChange={setErrorsOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Erros de sincronização com o Bling
              </DialogTitle>
              <DialogDescription>
                {(errors.data ?? []).length} item(ns) com falha. Mostrando os últimos 50, mais recentes primeiro.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[65vh] overflow-auto space-y-3 pr-1">
              {errors.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
                </div>
              ) : (errors.data ?? []).length === 0 ? (
                <div className="text-muted-foreground text-sm">Nenhum erro.</div>
              ) : (
                (errors.data as any[]).map((e) => {
                  const parsed = parseBlingError(e.erro);
                  const tipoLabel = labelTipo(e.tipo);
                  return (
                    <div key={e.id} className="rounded-lg border bg-card p-3 space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">
                            {e.product_nome ?? "Produto sem nome"}
                          </div>
                          <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2 mt-0.5">
                            {e.product_codigo ? (
                              <span className="font-mono">SKU: {e.product_codigo}</span>
                            ) : null}
                            {e.bling_product_id ? (
                              <span className="font-mono">ID Bling: {e.bling_product_id}</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="outline">{tipoLabel}</Badge>
                          {e.last_response_status ? (
                            <Badge variant="destructive">HTTP {e.last_response_status}</Badge>
                          ) : null}
                          {parsed.code ? (
                            <Badge variant="secondary">{parsed.code}</Badge>
                          ) : null}
                          <Badge variant="outline">{e.tentativas ?? 0} tent.</Badge>
                        </div>
                      </div>

                      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2 text-sm text-destructive">
                        {parsed.message || "Erro desconhecido"}
                      </div>

                      {parsed.fields && parsed.fields.length > 0 ? (
                        <div className="text-xs">
                          <div className="text-muted-foreground mb-1">Campos com problema:</div>
                          <ul className="list-disc pl-4 space-y-0.5">
                            {parsed.fields.map((f, i) => (
                              <li key={i}>
                                {f.field ? <span className="font-mono">{f.field}: </span> : null}
                                {f.message}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {e.valor_anterior != null ? (
                          <span>Anterior: <span className="font-mono">{String(e.valor_anterior)}</span></span>
                        ) : null}
                        {e.valor_novo != null ? (
                          <span>Novo: <span className="font-mono">{String(e.valor_novo)}</span></span>
                        ) : null}
                        <span className="ml-auto">
                          {e.updated_at ? new Date(e.updated_at).toLocaleString("pt-BR") : ""}
                        </span>
                      </div>

                      {parsed.raw && parsed.raw !== parsed.message ? (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            Ver resposta bruta
                          </summary>
                          <pre className="mt-1 whitespace-pre-wrap break-all bg-muted p-2 rounded font-mono text-[11px]">
                            {parsed.raw}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDeleteErrorsOpen(true)} disabled={queueBusy}
                className="border-destructive/50 text-destructive hover:bg-destructive/10">
                <Trash2 className="mr-2 h-4 w-4" /> Excluir todos
              </Button>
              <Button onClick={handleRetry}><RefreshCw className="mr-2 h-4 w-4" /> Reenfileirar todos</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <History className="h-5 w-5" /> Histórico de sincronização com o Bling
              </DialogTitle>
              <DialogDescription>
                Cada linha representa uma requisição enviada ao Bling. Mostrando as mais recentes.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Select value={historyStatus} onValueChange={(v) => { setHistoryPage(0); setHistoryStatus(v as any); }}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="concluido">Concluídos</SelectItem>
                  <SelectItem value="erro">Com erro</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground ml-auto">
                {history.data ? `${history.data.total.toLocaleString("pt-BR")} item(ns)` : ""}
              </div>
            </div>
            <div className="max-h-[60vh] overflow-auto border rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr className="text-left">
                    <th className="p-2">SKU</th>
                    <th className="p-2">Produto</th>
                    <th className="p-2">Tipo</th>
                    <th className="p-2">Status</th>
                    <th className="p-2 text-right">Anterior</th>
                    <th className="p-2 text-right">Novo</th>
                    <th className="p-2 text-right">Duração</th>
                    <th className="p-2">Processado</th>
                  </tr>
                </thead>
                <tbody>
                  {history.isLoading ? (
                    <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando...
                    </td></tr>
                  ) : (history.data?.items ?? []).length === 0 ? (
                    <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">Sem registros.</td></tr>
                  ) : (
                    (history.data!.items as any[]).map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="p-2 font-mono">{r.product_codigo ?? "—"}</td>
                        <td className="p-2 max-w-[240px] truncate">{r.product_nome ?? "—"}</td>
                        <td className="p-2">
                          <Badge variant="outline" className="text-[10px]">{labelTipo(r.tipo)}</Badge>
                          {r.deposito ? <div className="mt-1 text-[10px] text-muted-foreground whitespace-nowrap">Estoque: {r.deposito}</div> : null}
                        </td>
                        <td className="p-2">
                          {r.status === "erro" ? (
                            <Badge variant="destructive" className="text-[10px]">erro{r.last_response_status ? ` ${r.last_response_status}` : ""}</Badge>
                          ) : r.status === "concluido" ? (
                            <Badge variant="secondary" className="text-[10px]">ok</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                          )}
                        </td>
                        <td className="p-2 text-right font-mono text-muted-foreground">{r.valor_anterior != null ? String(r.valor_anterior) : ""}</td>
                        <td className="p-2 text-right font-mono max-w-[280px] truncate" title={r.erro ?? (r.valor_novo != null ? String(r.valor_novo) : undefined)}>{r.valor_novo != null ? String(r.valor_novo) : ""}</td>
                        <td className="p-2 text-right tabular-nums">{r.duration_ms != null ? `${r.duration_ms} ms` : ""}</td>
                        <td className="p-2 whitespace-nowrap">{r.processed_at ? new Date(r.processed_at).toLocaleString("pt-BR") : "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <DialogFooter className="justify-between sm:justify-between">
              <div className="text-xs text-muted-foreground">
                Página {historyPage + 1}
                {history.data ? ` de ${Math.max(1, Math.ceil(history.data.total / historyPageSize))}` : ""}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={historyPage === 0} onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm"
                  disabled={!history.data || (historyPage + 1) * historyPageSize >= history.data.total}
                  onClick={() => setHistoryPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function labelTipo(t: string): string {
  switch (t) {
    case "preco": return "Preço";
    case "estoque": return "Estoque";
    case "produto": return "Produto";
    case "criar": return "Criar";
    case "excluir": return "Excluir";
    case "inativar": return "Inativar";
    case "preco_loja": return "Preço loja";
    case "estoque_loja": return "Estoque loja";
    case "codigo_loja_planilha": return "ID na loja";
    case "vincular_loja": return "Vincular loja";
    case "desvincular_loja": return "Desvincular loja";
    case "campos_customizados": return "Campos customizados";
    default: return t;
  }
}


function parseBlingError(raw: string | null | undefined): {
  message: string;
  code: string | null;
  fields: Array<{ field: string | null; message: string }>;
  raw: string;
} {
  const text = (raw ?? "").toString();
  if (!text) return { message: "", code: null, fields: [], raw: "" };
  // Try to locate a JSON blob inside the error text
  const jsonStart = text.indexOf("{");
  let parsed: any = null;
  if (jsonStart >= 0) {
    try {
      parsed = JSON.parse(text.slice(jsonStart));
    } catch {
      parsed = null;
    }
  }
  if (!parsed) return { message: text, code: null, fields: [], raw: text };
  const err = parsed.error ?? parsed;
  const message: string = err?.message ?? err?.description ?? text;
  const code: string | null = err?.type ?? err?.code ?? null;
  const rawFields: any[] = Array.isArray(err?.fields)
    ? err.fields
    : Array.isArray(parsed?.fields)
      ? parsed.fields
      : [];
  const fields = rawFields.map((f) => ({
    field: f?.field ?? f?.name ?? f?.path ?? null,
    message: f?.message ?? f?.msg ?? JSON.stringify(f),
  }));
  return { message, code, fields, raw: text };
}
