import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, StopCircle, Star, Trash2, Pause, Play } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { listMyCompanies } from "@/lib/companies.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import {
  startBlingStoresSync, getBlingStoresProgress, listAllStoreLinks, listDistinctStores,
  cancelBlingStoresSync, resumeBlingStoresSync, listBlingChannels, setStoreMarketplace,
  deleteStoreLinks, pauseBlingStoresSync, unpauseBlingStoresSync,
} from "@/lib/bling-stores.functions";
import { listMarketplaces } from "@/lib/marketplaces.functions";
import { getPricingSettings, setDefaultMarketplace } from "@/lib/pricing.functions";
import { PageNumbers } from "@/components/page-numbers";
import { PricingPolicyAlert } from "@/components/pricing-policy-alert";
import { StoreSyncErrorsCard } from "@/components/store-sync-errors-card";


export const Route = createFileRoute("/_authenticated/multilojas")({
  head: () => ({ meta: [{"title": "Multilojas | Ajusta-Ê"}, {"name": "description", "content": "Acompanhe os vínculos dos produtos com cada loja."}, {"property": "og:title", "content": "Multilojas | Ajusta-Ê"}, {"property": "og:description", "content": "Acompanhe os vínculos dos produtos com cada loja."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }),
  component: MultilojasPage,
});

function MultilojasPage() {
  const qc = useQueryClient();
  const fetchCompanies = useServerFn(listMyCompanies);
  const doStart = useServerFn(startBlingStoresSync);
  const fetchProgress = useServerFn(getBlingStoresProgress);
  const fetchLinks = useServerFn(listAllStoreLinks);
  const fetchDistinct = useServerFn(listDistinctStores);
  const doCancel = useServerFn(cancelBlingStoresSync);
  const doResume = useServerFn(resumeBlingStoresSync);
  const fetchChannels = useServerFn(listBlingChannels);
  const fetchMarketplaces = useServerFn(listMarketplaces);
  const fnSetMkt = useServerFn(setStoreMarketplace);
  const fetchPricing = useServerFn(getPricingSettings);
  const fnSetDefaultMkt = useServerFn(setDefaultMarketplace);
  const fnDeleteLinks = useServerFn(deleteStoreLinks);
  const doPause = useServerFn(pauseBlingStoresSync);
  const doUnpause = useServerFn(unpauseBlingStoresSync);
  const [deleting, setDeleting] = useState(false);
  const [pausing, setPausing] = useState(false);

  const companies = useQuery({ queryKey: ["companies"], queryFn: () => fetchCompanies() });
  const [companyId, setCompanyId] = useSelectedCompany();
  useEffect(() => {
    if (!companyId && companies.data?.length) setCompanyId(companies.data[0].id);
  }, [companies.data, companyId]);

  const [search, setSearch] = useState("");
  const [storeId, setStoreId] = useState<string>("all");
  const [linked, setLinked] = useState<string>("all");
  const [unmatched, setUnmatched] = useState<string>("all");
  const [page, setPage] = useState(1);
  const perPage = 50;

  const progress = useQuery({
    queryKey: ["stores-progress", companyId],
    queryFn: () => fetchProgress({ data: { company_id: companyId! } }),
    enabled: !!companyId,
    refetchInterval: (q) => {
      const st = (q.state.data as any)?.job?.status;
      return st === "pendente" || st === "processando" || st === "cancelando" ? 2000 : false;
    },
  });

  const stores = useQuery({
    queryKey: ["distinct-stores", companyId],
    queryFn: () => fetchDistinct({ data: { company_id: companyId! } }),
    enabled: !!companyId,
  });

  const channels = useQuery({
    queryKey: ["bling-channels", companyId],
    queryFn: () => fetchChannels({ data: { company_id: companyId! } }),
    enabled: !!companyId,
  });

  const marketplaces = useQuery({
    queryKey: ["marketplaces", companyId],
    queryFn: () => companyId ? fetchMarketplaces({ data: { company_id: companyId } }) : Promise.resolve([]),
    enabled: !!companyId,
  });

  const pricing = useQuery({
    queryKey: ["pricing-settings", companyId],
    queryFn: () => fetchPricing({ data: { company_id: companyId! } }),
    enabled: !!companyId,
  });

  async function handleSetDefaultMarketplace(marketplace_id: string | null) {
    if (!companyId) return;
    try {
      await fnSetDefaultMkt({ data: { company_id: companyId, marketplace_id } });
      await qc.invalidateQueries({ queryKey: ["pricing-settings", companyId] });
      toast.success("Marketplace padrão do ERP atualizado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    }
  }


  async function handleSetMarketplace(bling_store_id: string, marketplace_id: string | null, is_default: boolean) {
    if (!companyId) return;
    try {
      await fnSetMkt({ data: { company_id: companyId, bling_store_id, marketplace_id, is_default } });
      await qc.invalidateQueries({ queryKey: ["bling-channels", companyId] });
      toast.success("Loja atualizada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    }
  }

  const list = useQuery({
    queryKey: ["all-store-links", companyId, search, storeId, linked, unmatched, page],
    queryFn: () => fetchLinks({
      data: {
        company_id: companyId!,
        search: search || undefined,
        bling_store_id: storeId === "all" ? undefined : storeId,
        only_active: linked === "active" ? true : undefined,
        only_unmatched: unmatched === "yes" ? true : undefined,
        page, per_page: perPage,
      },
    }),
    enabled: !!companyId,
  });

  async function handleFullSync() {
    if (!companyId) return;
    try {
      const r = await doStart({ data: { company_id: companyId, scope: "full" } });
      if (r.already_running) toast.info("Já existe uma sincronização em andamento.");
      else toast.success("Sincronização iniciada.");
      qc.invalidateQueries({ queryKey: ["stores-progress", companyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro.");
    }
  }

  async function handleMissingSync() {
    if (!companyId) return;
    try {
      const r = await doStart({ data: { company_id: companyId, scope: "missing" } });
      if (r.already_running) toast.info("Já existe uma sincronização em andamento.");
      else toast.success("Reprocessando apenas produtos sem vínculo.");
      qc.invalidateQueries({ queryKey: ["stores-progress", companyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro.");
    }
  }

  async function handleCancel() {
    if (!companyId) return;
    if (!confirm("Cancelar a sincronização? Ela será encerrada de vez e recomeçará do zero na próxima vez.")) return;
    try {
      const r = await doCancel({ data: { company_id: companyId, ...(job?.id ? { job_id: job.id } : {}) } });
      // Para o polling imediatamente refletindo o job como cancelado.
      qc.setQueryData(["stores-progress", companyId], (old: any) =>
        old?.job ? { ...old, job: { ...old.job, status: "cancelada", finished_at: new Date().toISOString() } } : old,
      );
      toast.success(`Sincronização cancelada (${r.cancelled}).`);
      qc.invalidateQueries({ queryKey: ["stores-progress", companyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro.");
    }
  }

  async function handlePause() {
    if (!companyId) return;
    setPausing(true);
    try {
      await doPause({ data: { company_id: companyId, ...(job?.id ? { job_id: job.id } : {}) } });
      qc.setQueryData(["stores-progress", companyId], (old: any) =>
        old?.job ? { ...old, job: { ...old.job, status: "pausada" } } : old,
      );
      toast.success("Sincronização pausada. Você pode retomar quando quiser.");
      qc.invalidateQueries({ queryKey: ["stores-progress", companyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao pausar.");
    } finally {
      setPausing(false);
    }
  }

  async function handleUnpause() {
    if (!companyId) return;
    setPausing(true);
    try {
      await doUnpause({ data: { company_id: companyId, ...(job?.id ? { job_id: job.id } : {}) } });
      toast.success("Sincronização retomada de onde parou.");
      qc.invalidateQueries({ queryKey: ["stores-progress", companyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao retomar.");
    } finally {
      setPausing(false);
    }
  }




  async function handleDeleteLinks() {
    if (!companyId) return;
    const scoped = storeId !== "all";
    const label = scoped
      ? `os vínculos da loja selecionada`
      : `TODOS os vínculos de multilojas desta empresa`;
    if (!window.confirm(`Excluir ${label}? Isso apaga apenas os vínculos locais — você pode sincronizar tudo de novo depois.`)) return;
    setDeleting(true);
    try {
      const r = await fnDeleteLinks({
        data: { company_id: companyId, bling_store_id: scoped ? storeId : undefined },
      });
      toast.success(`${r.deleted.toLocaleString("pt-BR")} vínculo(s) excluído(s).`);
      setPage(1);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["all-store-links", companyId] }),
        qc.invalidateQueries({ queryKey: ["distinct-stores", companyId] }),
        qc.invalidateQueries({ queryKey: ["stores-progress", companyId] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir vínculos.");
    } finally {
      setDeleting(false);
    }
  }



  const job = (progress.data as any)?.job;
  const totals = (progress.data as any)?.totals ?? {};
  const isRunning = job && (job.status === "pendente" || job.status === "processando" || job.status === "cancelando");
  const isPausedJob = job?.status === "pausada";
  const paginasProcessadas = Number(job?.paginas_processadas ?? 0);
  const totalPaginas = Number(job?.total_paginas ?? 0);
  const totalLinks = Number(totals.total_links ?? 0);
  const produtosVerificados = Number(job?.produtos_verificados ?? 0);
  const produtosRestantes = Number(job?.produtos_restantes ?? 0);
  // Progresso confiável = baseado em páginas do Bling (uma página só é contada uma vez concluída).
  const pageProgressReliable = totalPaginas > 0 && paginasProcessadas <= totalPaginas;
  const percent = pageProgressReliable ? Math.round((paginasProcessadas / totalPaginas) * 100) : 0;

  useEffect(() => {
    if (!companyId || !job?.id || job.status === "cancelando") return;
    if (job.status !== "pendente" && job.status !== "processando") return;
    const key = `bling-stores-resume:${job.id}:${job.proxima_pagina ?? 1}:${job.paginas_processadas ?? 0}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    doResume({ data: { company_id: companyId, job_id: job.id } }).catch(() => undefined);
  }, [companyId, doResume, job?.id, job?.paginas_processadas, job?.proxima_pagina, job?.status]);


  return (
    <div className="p-6 space-y-4">
      <PricingPolicyAlert companyId={companyId} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Multilojas</h1>
          <p className="text-sm text-muted-foreground">Vínculos entre produtos internos e lojas no Bling.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setPage(1); }}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Empresa" /></SelectTrigger>
            <SelectContent>
              {(companies.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isRunning ? (
            <>
              <Button variant="secondary" onClick={handlePause} disabled={pausing}>
                {pausing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pause className="mr-2 h-4 w-4" />}
                Pausar
              </Button>
              <Button variant="destructive" onClick={handleCancel}>
                <StopCircle className="mr-2 h-4 w-4" /> Cancelar sincronização
              </Button>
            </>
          ) : isPausedJob ? (
            <>
              <Button onClick={handleUnpause} disabled={pausing}>
                {pausing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Retomar sincronização
              </Button>
              <Button variant="destructive" onClick={handleCancel}>
                <StopCircle className="mr-2 h-4 w-4" /> Cancelar sincronização
              </Button>
            </>
          ) : (
            <>
              <Button onClick={handleFullSync} disabled={!companyId}>
                <RefreshCw className="mr-2 h-4 w-4" /> Sincronizar Multilojas
              </Button>
              <Button variant="secondary" onClick={handleMissingSync} disabled={!companyId}>
                <RefreshCw className="mr-2 h-4 w-4" /> Reprocessar sem vínculo
              </Button>
            </>
          )}
          <Button
            variant="outline"
            onClick={handleDeleteLinks}
            disabled={!companyId || deleting || isRunning || isPausedJob}
          >
            {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            {storeId === "all" ? "Excluir todos os vínculos" : "Excluir vínculos da loja"}
          </Button>
        </div>
      </div>

      {isPausedJob && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-medium flex items-center gap-2"><Pause className="h-4 w-4" /> Sincronização pausada</div>
              <div className="text-xs text-muted-foreground">
                Parou na página {Number(job?.proxima_pagina ?? 1)} · {paginasProcessadas} páginas processadas.
                Ao retomar, continua exatamente daqui.
              </div>
            </div>
            <Button onClick={handleUnpause} disabled={pausing}>
              {pausing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Retomar
            </Button>
          </CardContent>
        </Card>
      )}

      {isRunning && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {job.status === "cancelando" ? "Cancelando..." : "Sincronizando lojas..."}
              </span>
              <span className="text-muted-foreground">
                {pageProgressReliable
                  ? `Página ${paginasProcessadas} de ${totalPaginas} (${percent}%)`
                  : `${paginasProcessadas} páginas processadas`}
              </span>
            </div>
            {pageProgressReliable
              ? <Progress value={percent} />
              : <Progress value={undefined as unknown as number} className="animate-pulse" />}
            <div className="text-xs text-muted-foreground">
              {totalLinks.toLocaleString("pt-BR")} vínculos salvos no banco · Erros: {job.erros ?? 0}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-1">
              <StatCard label="Produtos verificados" value={produtosVerificados} small />
              <StatCard label="Produtos restantes (estimado)" value={produtosRestantes} small />
              <StatCard label="Vínculos encontrados" value={job.vinculos_encontrados ?? 0} small />
            </div>

          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatCard label="Produtos no banco" value={totals.total_products ?? 0} />
        <StatCard label="Produtos com vínculo" value={totals.products_with_stores ?? 0} />
        <StatCard label="Produtos sem vínculo" value={totals.products_without_stores ?? 0} />
        <StatCard label="Verificados na última sincronização" value={totals.last_run_checked_products ?? 0} />
        <StatCard label="Total de vínculos" value={totals.total_links ?? 0} />
        <StatCard label="Vínculos ativos" value={totals.active_links ?? 0} />
        <StatCard label="Vínculos inativos" value={totals.inactive_links ?? 0} />
        <StatCard label="Produtos não relacionados" value={totals.unmatched ?? 0} />
        <StatCard label="Lojas diferentes" value={totals.distinct_stores ?? 0} />
        <StatCard
          label="Última sincronização"
          value={totals.last_imported ? new Date(totals.last_imported).toLocaleString("pt-BR") : "—"}
          small
        />
        {job && !isRunning && (
          <StatCard label={`Último job: ${job.status}`} value={`${paginasProcessadas} páginas`} small />
        )}

      </div>


      {job?.last_error && (
        <div className="text-xs text-destructive">{job.last_error}</div>
      )}

      <StoreSyncErrorsCard companyId={companyId ?? null} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Marketplace padrão do ERP</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Usado para calcular o preço de venda no Bling quando <strong>nenhuma loja</strong> está marcada como padrão
            abaixo (ou quando ainda não há lojas sincronizadas). A comissão deste marketplace entra na fórmula da
            Política de Precificação.
          </p>
          <div className="max-w-md">
            <Select
              value={pricing.data?.default_marketplace_id ?? "none"}
              onValueChange={(v) => handleSetDefaultMarketplace(v === "none" ? null : v)}
              disabled={!companyId || pricing.isLoading}
            >
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Nenhum —</SelectItem>
                {(marketplaces.data ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.nome} ({m.taxa_percent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Lojas e marketplaces</CardTitle>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="default">
              {(channels.data ?? []).filter((c: any) => Number(c.situacao) === 1).length} ativas
            </Badge>
            <Badge variant="secondary">
              {(channels.data ?? []).filter((c: any) => Number(c.situacao) !== 1).length} inativas
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {channels.isLoading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : (channels.data ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Nenhuma loja encontrada. Sincronize primeiro para descobrir os canais do Bling.
            </div>
          ) : (
            <div className="overflow-x-auto rounded border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase">
                  <tr>
                    <th className="px-2 py-2">Loja</th>
                    <th className="px-2 py-2">Tipo</th>
                    <th className="px-2 py-2 w-28">Situação</th>
                    <th className="px-2 py-2 w-64">Marketplace</th>
                    <th className="px-2 py-2 text-center w-32">Padrão do ERP</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(channels.data ?? []).map((c: any) => (
                    <tr key={c.bling_store_id} className="hover:bg-muted/30">
                      <td className="px-2 py-2">
                        <div className="font-medium">{c.descricao ?? c.bling_store_id}</div>
                        <div className="text-xs text-muted-foreground font-mono">{c.bling_store_id}</div>
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant="outline">{c.tipo ?? "—"}</Badge>
                      </td>
                      <td className="px-2 py-2">
                        {Number(c.situacao) === 1 ? (
                          <Badge variant="default">Ativa</Badge>
                        ) : Number(c.situacao) === 2 ? (
                          <Badge variant="secondary">Inativa</Badge>
                        ) : (
                          <Badge variant="outline">—</Badge>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <Select
                          value={c.marketplace_id ?? "none"}
                          onValueChange={(v) =>
                            handleSetMarketplace(
                              c.bling_store_id,
                              v === "none" ? null : v,
                              !!c.is_default,
                            )
                          }
                        >
                          <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— Não vinculado —</SelectItem>
                            {(marketplaces.data ?? []).map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.nome} ({m.taxa_percent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <Button
                          size="sm"
                          variant={c.is_default ? "default" : "ghost"}
                          onClick={() =>
                            handleSetMarketplace(
                              c.bling_store_id,
                              c.marketplace_id ?? null,
                              !c.is_default,
                            )
                          }
                          title={c.is_default ? "Loja padrão do ERP" : "Definir como padrão"}
                        >
                          <Star className={`h-4 w-4 ${c.is_default ? "fill-current" : ""}`} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="p-2 text-xs text-muted-foreground border-t">
                A loja marcada como <strong>padrão</strong> é aquela cujo marketplace o Bling usa para herdar as taxas
                que compõem o preço de venda do produto.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vínculos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">

          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Input placeholder="Buscar..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            <Select value={storeId} onValueChange={(v) => { setStoreId(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as lojas</SelectItem>
                {(stores.data ?? []).map((s: any) => (
                  <SelectItem key={s.bling_store_id} value={s.bling_store_id}>
                    {s.store_name ?? s.bling_store_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={linked} onValueChange={(v) => { setLinked(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Ativos + inativos</SelectItem>
                <SelectItem value="active">Somente ativos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={unmatched} onValueChange={(v) => { setUnmatched(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="yes">Só produtos não relacionados</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto rounded border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase">
                <tr>
                  <th className="px-2 py-2">Produto</th>
                  <th className="px-2 py-2">SKU</th>
                  <th className="px-2 py-2">Loja</th>
                  <th className="px-2 py-2">Cód. loja</th>
                  <th className="px-2 py-2 text-right">Preço</th>
                  <th className="px-2 py-2 text-right">Promo</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Última importação</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.isLoading && <tr><td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">Carregando...</td></tr>}
                {!list.isLoading && (list.data?.rows.length ?? 0) === 0 && (
                  <tr><td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">Nenhum vínculo encontrado.</td></tr>
                )}
                {list.data?.rows.map((r: any) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-2 py-2">{r.bling_products?.nome ?? <span className="text-muted-foreground">não relacionado</span>}</td>
                    <td className="px-2 py-2 font-mono text-xs">{r.bling_products?.codigo ?? "—"}</td>
                    <td className="px-2 py-2">{r.store_name ?? r.bling_store_id}</td>
                    <td className="px-2 py-2 font-mono text-xs">{r.store_product_code ?? "—"}</td>
                    <td className="px-2 py-2 text-right">{r.current_price != null ? Number(r.current_price).toFixed(2) : "—"}</td>
                    <td className="px-2 py-2 text-right">{r.current_promotional_price != null ? Number(r.current_promotional_price).toFixed(2) : "—"}</td>
                    <td className="px-2 py-2">
                      <Badge variant={r.is_linked ? "default" : "secondary"}>{r.is_linked ? "ativo" : "inativo"}</Badge>
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {r.last_imported_at ? new Date(r.last_imported_at).toLocaleString("pt-BR") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PageNumbers
            page={page}
            pageSize={perPage}
            total={list.data?.total ?? 0}
            onChange={setPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={small ? "text-sm font-medium mt-1" : "text-xl font-semibold mt-1"}>{value}</div>
      </CardContent>
    </Card>
  );
}
