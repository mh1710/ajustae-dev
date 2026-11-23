import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plug, Loader2, PlugZap, PowerOff, AlertCircle, CheckCircle2 } from "lucide-react";
import { listMyCompanies } from "@/lib/companies.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import {
  listBlingIntegrations,
  blingAuthStart,
  blingTestConnection,
  blingDisconnect,
  listBlingOAuthApps,
  getBlingCredentials,
  getBlingRuntimeEnvironment,
  saveBlingCredentials,
} from "@/lib/bling.functions";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { createCdnIntegrationSignature, revokeCdnIntegrationSignature, createCdnIntegrationSignaturesBulk, revokeCdnIntegrationSignaturesBulk, propagateAllCdnImages, startCdnImagePropagationJob, listCdnImagePropagationJobs, cancelCdnImagePropagationJob, resumeCdnImagePropagationJob, retryCdnImagePropagationJob, listCdnPropagationReport } from "@/lib/cdn-portal.functions";
import { useAccess } from "@/hooks/use-access";
import { CompanyCatalogStatus } from "@/components/company-catalog-status";

const searchSchema = z.object({
  bling: z.enum(["ok", "err"]).optional(),
  msg: z.string().optional(),
  company: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/integracoes")({
  head: () => ({ meta: [{"title": "Integrações | Ajusta-Ê"}, {"name": "description", "content": "Acompanhe o estado da integração da empresa com o Bling."}, {"property": "og:title", "content": "Integrações | Ajusta-Ê"}, {"property": "og:description", "content": "Acompanhe o estado da integração da empresa com o Bling."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }),
  validateSearch: (s) => searchSchema.parse(s),
  component: IntegracoesPage,
});

function IntegracoesPage() {
  const { access } = useAccess();
  const readOnly = access.company_restricted;
  const { bling, msg, company } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const fetchCompanies = useServerFn(listMyCompanies);
  const fetchIntegrations = useServerFn(listBlingIntegrations);
  const startAuth = useServerFn(blingAuthStart);
  const testConn = useServerFn(blingTestConnection);
  const disconnect = useServerFn(blingDisconnect);
  const fetchApps = useServerFn(listBlingOAuthApps);
  const fetchCreds = useServerFn(getBlingCredentials);
  const fetchRuntimeEnvironment = useServerFn(getBlingRuntimeEnvironment);
  const saveCreds = useServerFn(saveBlingCredentials);
  const createCdn = useServerFn(createCdnIntegrationSignature);
  const revokeCdn = useServerFn(revokeCdnIntegrationSignature);
  const createCdnBulk = useServerFn(createCdnIntegrationSignaturesBulk);
  const revokeCdnBulk = useServerFn(revokeCdnIntegrationSignaturesBulk);
  const propagateAll = useServerFn(propagateAllCdnImages);
  const startGlobalPropagation = useServerFn(startCdnImagePropagationJob);
  const fetchImageJobs = useServerFn(listCdnImagePropagationJobs);
  const cancelImageJob = useServerFn(cancelCdnImagePropagationJob);
  const resumeImageJob = useServerFn(resumeCdnImagePropagationJob);
  const retryImageJob = useServerFn(retryCdnImagePropagationJob);
  const fetchImageReport = useServerFn(listCdnPropagationReport);

  const companies = useQuery({ queryKey: ["companies"], queryFn: () => fetchCompanies() });
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: () => fetchIntegrations() });
  const runtimeEnvironment = useQuery({
    queryKey: ["bling-runtime-environment"],
    queryFn: () => fetchRuntimeEnvironment(),
  });

  const [selected, setSelected] = useSelectedCompany();
  const [busy, setBusy] = useState(false);
  const [appId, setAppId] = useState<string | undefined>();
  const [manualId, setManualId] = useState("");
  const [manualSecret, setManualSecret] = useState("");
  const [cdnBusy, setCdnBusy] = useState(false);
  const [propagatingImages, setPropagatingImages] = useState(false);
  const [selectedCdn, setSelectedCdn] = useState<Set<string>>(new Set());
  const [bulkCdnBusy, setBulkCdnBusy] = useState(false);
  const [globalPropagationBusy, setGlobalPropagationBusy] = useState(false);
  const [resumingImageJobId, setResumingImageJobId] = useState<string | null>(null);
  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState<"todos" | "atualizado" | "sem_imagem" | "ja_cdn" | "sem_integracao" | "erro" | "cancelado">("todos");
  const [reportPage, setReportPage] = useState(0);
  const [reportSearch, setReportSearch] = useState("");

  const imageJobs = useQuery({
    queryKey: ["cdn-image-jobs"],
    queryFn: () => fetchImageJobs({ data: {} }),
    enabled: !readOnly,
    refetchInterval: (query) => (query.state.data as any[] | undefined)?.some((job) => ["inventario", "preparando", "processando"].includes(job.status)) ? 3000 : false,
  });
  const imageReport = useQuery({
    queryKey: ["cdn-image-report", reportJobId, reportStatus, reportPage, reportSearch],
    queryFn: () => fetchImageReport({ data: { job_id: reportJobId!, status: reportStatus, page: reportPage, page_size: 50, search: reportSearch } }),
    enabled: !!reportJobId,
    refetchInterval: () => (imageJobs.data as any[] | undefined)?.some((job) => job.id === reportJobId && ["inventario", "preparando", "processando"].includes(job.status)) ? 3000 : false,
  });
  const reportJob = (imageJobs.data as any[] | undefined)?.find((job) => job.id === reportJobId);

  const apps = useQuery({ queryKey: ["bling-apps"], queryFn: () => fetchApps(), enabled: !readOnly });
  const creds = useQuery({
    queryKey: ["bling-creds", selected],
    queryFn: () => fetchCreds({ data: { company_id: selected! } }),
    enabled: !!selected && !readOnly,
  });
  async function handleCreateCdn() {
    if (!selected || !integration) return;
    setCdnBusy(true);
    try {
      const result = await createCdn({ data: { company_id: selected, integration_id: integration.id } });
      await qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.success(`Assinatura criada: ${result.base_url}/${result.signature}/imagens/...`);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setCdnBusy(false); }
  }

  async function handleRevokeCdn() {
    if (!selected || !integration?.cdn_signature) return;
    setCdnBusy(true);
    try {
      await revokeCdn({ data: { company_id: selected, integration_id: integration.id, signature: integration.cdn_signature } });
      await qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("Assinatura revogada.");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setCdnBusy(false); }
  }

  async function handlePropagateAllImages() {
    if (!selected) return;
    if (!window.confirm("Gerar assinatura se necessário e atualizar as imagens de todos os produtos desta empresa?")) return;
    setPropagatingImages(true);
    try {
      const result = await propagateAll({ data: { company_id: selected } });
      toast.success("Propagação iniciada. O processamento continuará em segundo plano.");
      setReportJobId((result as any).id);
      await qc.invalidateQueries({ queryKey: ["cdn-image-jobs"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setPropagatingImages(false); }
  }

  function toggleCdnSelection(id: string) {
    setSelectedCdn((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function handleBulkCreateCdn() {
    const items = (integrations.data ?? []).filter((item: any) => selectedCdn.has(item.id)).map((item: any) => ({ company_id: item.company_id, integration_id: item.id }));
    if (!items.length) return;
    setBulkCdnBusy(true);
    try { const result = await createCdnBulk({ data: { items } }); toast.success(`${result.processed} assinatura(s) gerada(s).`); setSelectedCdn(new Set()); await qc.invalidateQueries({ queryKey: ["integrations"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBulkCdnBusy(false); }
  }

  async function handleBulkRevokeCdn() {
    const items = (integrations.data ?? []).filter((item: any) => selectedCdn.has(item.id) && item.cdn_signature_active && item.cdn_signature).map((item: any) => ({ company_id: item.company_id, integration_id: item.id, signature: item.cdn_signature }));
    if (!items.length) return;
    if (!window.confirm(`Revogar ${items.length} assinatura(s) selecionada(s)?`)) return;
    setBulkCdnBusy(true);
    try { const result = await revokeCdnBulk({ data: { items } }); toast.success(`${result.processed} assinatura(s) revogada(s).`); setSelectedCdn(new Set()); await qc.invalidateQueries({ queryKey: ["integrations"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBulkCdnBusy(false); }
  }

  async function handleGlobalPropagation() {
    if (!window.confirm("Inventariar o R2 e propagar imagens para todos os produtos das empresas administradas?")) return;
    setGlobalPropagationBusy(true);
    try {
      const job = await startGlobalPropagation({ data: { product_ids: [] } });
      toast.success("Inventário e propagação iniciados. Você pode fechar esta página sem interromper o job.");
      setReportJobId((job as any).id);
      await qc.invalidateQueries({ queryKey: ["cdn-image-jobs"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setGlobalPropagationBusy(false); }
  }

  async function handleCancelImageJob(jobId: string) {
    if (!window.confirm("Cancelar esta propagação? Os produtos já atualizados não serão revertidos.")) return;
    try {
      await cancelImageJob({ data: { job_id: jobId } });
      await qc.invalidateQueries({ queryKey: ["cdn-image-jobs"] });
      toast.success("Propagação cancelada.");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  async function handleRetryImageJob(jobId: string) {
    try {
      await retryImageJob({ data: { job_id: jobId } });
      await qc.invalidateQueries({ queryKey: ["cdn-image-jobs"] });
      toast.success("Propagação reiniciada a partir do inventário do R2.");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  async function handleResumeImageJob(jobId: string) {
    setResumingImageJobId(jobId);
    try {
      const result = await resumeImageJob({ data: { job_id: jobId } });
      await qc.invalidateQueries({ queryKey: ["cdn-image-jobs"] });
      await qc.invalidateQueries({ queryKey: ["cdn-image-report", jobId] });
      toast.success(result.busy ? "A propagação já está processando um lote." : "Propagação retomada.");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setResumingImageJobId(null); }
  }

  async function handleSaveCreds(useApp: boolean) {
    if (!selected) return;
    setBusy(true);
    try {
      await saveCreds({
        data: useApp
          ? { company_id: selected, app_id: appId! }
          : { company_id: selected, client_id: manualId, client_secret: manualSecret },
      });
      toast.success("Credenciais salvas.");
      setManualId("");
      setManualSecret("");
      qc.invalidateQueries({ queryKey: ["bling-creds", selected] });
      qc.invalidateQueries({ queryKey: ["integrations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar credenciais.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (company) {
      setSelected(company);
      return;
    }
    if (!selected && companies.data && companies.data.length > 0) {
      setSelected(companies.data[0].id);
    }
  }, [companies.data, selected, company, setSelected]);

  useEffect(() => {
    if (bling === "ok" && msg) toast.success(msg);
    if (bling === "err" && msg) toast.error(msg);
    if (bling) {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      navigate({ to: "/integracoes", replace: true });
    }
  }, [bling, msg, qc, navigate]);

  const integration = integrations.data?.find((i) => i.company_id === selected);

  async function handleConnect() {
    if (!selected) return;
    setBusy(true);
    try {
      const { url } = await startAuth({ data: { company_id: selected } });
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao iniciar conexão.");
      setBusy(false);
    }
  }

  async function handleTest() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await testConn({ data: { company_id: selected } });
      if (res.success) {
        toast.success("message" in res && res.message ? res.message : "Conexão OK!");
      } else {
        toast.error(("error" in res && res.error) || "Falha no teste.");
      }
      qc.invalidateQueries({ queryKey: ["integrations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }


  async function handleDisconnect() {
    if (!selected) return;
    if (!confirm("Desconectar o Bling desta empresa?")) return;
    setBusy(true);
    try {
      await disconnect({ data: { company_id: selected } });
      toast.success("Desconectado.");
      qc.invalidateQueries({ queryKey: ["integrations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  const statusBadge = (status?: string) => {
    if (status === "conectada")
      return <Badge className="bg-emerald-600 hover:bg-emerald-700">Conectada</Badge>;
    if (status === "requer_reconexao")
      return <Badge variant="destructive">Reconectar</Badge>;
    if (status === "erro") return <Badge variant="destructive">Erro</Badge>;
    return <Badge variant="secondary">Desconectada</Badge>;
  };

  const problemas = (integrations.data ?? []).filter(
    (i) => i.status === "erro" || i.status === "requer_reconexao" || i.last_error,
  );
  const nomeEmpresa = (id: string) =>
    companies.data?.find((c) => c.id === id)?.nome ?? id;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Integrações</h1>
        <p className="mt-1 text-sm text-muted-foreground">Conecte serviços externos às suas empresas.</p>
      </div>

      {runtimeEnvironment.data?.mode === "local_test" && (
        <Alert className="mb-6 max-w-2xl border-amber-500 bg-amber-500/10">
          <AlertCircle className="h-4 w-4 text-amber-700" />
          <AlertDescription>
            <div className="font-medium text-amber-800 dark:text-amber-300">
              Ambiente local de teste com escrita habilitada
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Credenciais, tokens, filas e renovações pertencem ao projeto Supabase de teste
              {runtimeEnvironment.data.project_id
                ? ` (${runtimeEnvironment.data.project_id})`
                : ""}. As ações podem criar e alterar produtos nos Blings autorizados.
            </div>
          </AlertDescription>
        </Alert>
      )}

      {problemas.length > 0 && (
        <Alert variant="destructive" className="mb-6 max-w-2xl">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-medium">
              {problemas.length} empresa(s) com problema na conexão com o Bling:
            </div>
            <ul className="mt-2 space-y-1 text-xs">
              {problemas.map((i) => (
                <li key={i.company_id}>
                  <button
                    type="button"
                    className="font-medium underline underline-offset-2"
                    onClick={() => setSelected(i.company_id)}
                  >
                    {nomeEmpresa(i.company_id)}
                  </button>
                  {" — "}
                  {i.last_error ?? (i.status === "requer_reconexao" ? "Reconecte esta empresa." : i.status)}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {companies.data && companies.data.length === 0 ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Cadastre uma empresa antes de configurar integrações.
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="max-w-2xl">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                  <Plug className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle>Bling</CardTitle>
                  <CardDescription>ERP e emissor de notas.</CardDescription>
                </div>
              </div>
              {statusBadge(integration?.status)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Empresa</label>
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {companies.data?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!readOnly && <div className="space-y-3 rounded-md border p-4">
              <div>
                <div className="text-sm font-medium">Credenciais do app Bling</div>
                <p className="text-xs text-muted-foreground">
                  Client ID e Client Secret usados na autorização desta empresa.
                </p>
              </div>

              <div className="text-xs">
                {creds.data?.client_id ? (
                  <span className="text-muted-foreground">
                    Atual: <span className="font-mono">{creds.data.client_id}</span> · secret{" "}
                    <span className="font-mono">{creds.data.client_secret_masked}</span>
                    {creds.data.oauth_app_nome ? ` · ${creds.data.oauth_app_nome}` : ""}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Nenhuma credencial cadastrada.</span>
                )}
              </div>

              {runtimeEnvironment.isSuccess && runtimeEnvironment.data.mode !== "local_test" && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[220px] flex-1 space-y-1">
                    <label className="text-xs font-medium">App cadastrado</label>
                    <Select value={appId} onValueChange={setAppId}>
                      <SelectTrigger><SelectValue placeholder="Selecione o app..." /></SelectTrigger>
                      <SelectContent>
                        {apps.data?.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={!selected || !appId || busy}
                    onClick={() => handleSaveCreds(true)}
                  >
                    Usar este app
                  </Button>
                </div>
              )}

              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[200px] flex-1 space-y-1">
                  <label className="text-xs font-medium">Client ID</label>
                  <Input value={manualId} onChange={(e) => setManualId(e.target.value)} placeholder="Client ID" />
                </div>
                <div className="min-w-[200px] flex-1 space-y-1">
                  <label className="text-xs font-medium">Client Secret</label>
                  <Input
                    type="password"
                    value={manualSecret}
                    onChange={(e) => setManualSecret(e.target.value)}
                    placeholder="Client Secret"
                  />
                </div>
                <Button
                  variant="secondary"
                  disabled={!selected || busy || manualId.length < 10 || manualSecret.length < 10}
                  onClick={() => handleSaveCreds(false)}
                >
                  {runtimeEnvironment.data?.mode === "local_test"
                    ? "Salvar para teste local"
                    : "Salvar"}
                </Button>
              </div>
            </div>}

            {!readOnly && <div className="space-y-3 rounded-md border p-4">
              <div>
                <div className="text-sm font-medium">CDN de imagens R2</div>
                <p className="text-xs text-muted-foreground">
                  A assinatura é criada e revogada pelo portal e sincronizada automaticamente com o Cloudflare KV.
                </p>
              </div>
              {(integration as any)?.cdn_signature_active && (integration as any)?.cdn_signature ? (
                <div className="rounded bg-muted p-2 font-mono text-xs break-all">
                  {(import.meta as any).env?.VITE_CDN_BASE_URL ?? "CDN_BASE_URL"}/{(integration as any).cdn_signature}/imagens/...
                </div>
              ) : <div className="text-xs text-muted-foreground">Nenhuma assinatura ativa.</div>}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={handleCreateCdn} disabled={!integration || cdnBusy}>
                  {cdnBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Gerar assinatura
                </Button>
                <Button variant="outline" onClick={handleRevokeCdn} disabled={cdnBusy || !(integration as any)?.cdn_signature_active}>
                  Revogar
                </Button>
                <Button variant="outline" onClick={handlePropagateAllImages} disabled={propagatingImages || !selected}>
                  {propagatingImages ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Propagar imagens de todos os produtos
                </Button>
              </div>
            </div>}

            <div className="grid grid-cols-2 gap-4 rounded-md border bg-muted/30 p-4 text-sm">
              <div>
                <div className="text-muted-foreground">Última sincronização</div>
                <div className="mt-1 font-medium">
                  {integration?.last_sync_at
                    ? new Date(integration.last_sync_at).toLocaleString("pt-BR")
                    : "Nunca"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Expira em</div>
                <div className="mt-1 font-medium">
                  {integration?.token_expires_at
                    ? new Date(integration.token_expires_at).toLocaleString("pt-BR")
                    : "—"}
                </div>
              </div>
            </div>

            {integration?.last_error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{integration.last_error}</AlertDescription>
              </Alert>
            )}
            {integration?.status === "conectada" && !integration.last_error && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>Integração ativa.</AlertDescription>
              </Alert>
            )}

            {!readOnly && <div className="flex flex-wrap gap-2">
              <Button onClick={handleConnect} disabled={!selected || busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                Conectar ao Bling
              </Button>
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={!selected || busy || (!creds.data?.client_id && integration?.status !== "conectada")}
              >
                {integration?.status === "conectada" ? "Testar conexão" : "Testar credenciais"}
              </Button>

              <Button variant="ghost" onClick={handleDisconnect} disabled={!selected || busy || integration?.status === "desconectada"}>
                <PowerOff className="mr-2 h-4 w-4" /> Desconectar
              </Button>
            </div>}
          </CardContent>
        </Card>
      )}
      {!readOnly && <Card>
        <CardHeader>
          <CardTitle>Gerenciamento de assinaturas CDN</CardTitle>
          <CardDescription>Visão geral das assinaturas por empresa e ações administrativas.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={handleBulkCreateCdn} disabled={bulkCdnBusy || selectedCdn.size === 0}>
              Gerar selecionadas ({selectedCdn.size})
            </Button>
            <Button size="sm" variant="outline" onClick={handleBulkRevokeCdn} disabled={bulkCdnBusy || selectedCdn.size === 0}>
              Revogar selecionadas ({selectedCdn.size})
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedCdn(new Set((integrations.data ?? []).map((item: any) => item.id)))} disabled={bulkCdnBusy || !(integrations.data?.length)}>
              Selecionar todas
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedCdn(new Set())} disabled={bulkCdnBusy || selectedCdn.size === 0}>
              Limpar seleção
            </Button>
            <Button size="sm" onClick={handleGlobalPropagation} disabled={globalPropagationBusy}>
              {globalPropagationBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Propagar todas as empresas
            </Button>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left"><tr><th className="px-3 py-2">Selecionar</th><th className="px-3 py-2">Empresa</th><th className="px-3 py-2">Assinatura</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Atualizada em</th></tr></thead>
              <tbody>{(integrations.data ?? []).map((item: any) => (
                <tr key={item.id} className="border-t"><td className="px-3 py-2"><input type="checkbox" checked={selectedCdn.has(item.id)} onChange={() => toggleCdnSelection(item.id)} /></td><td className="px-3 py-2">{companies.data?.find((c) => c.id === item.company_id)?.nome ?? item.company_id}</td><td className="px-3 py-2 font-mono text-xs">{item.cdn_signature ?? "—"}</td><td className="px-3 py-2"><Badge variant={item.cdn_signature_active ? "secondary" : "outline"}>{item.cdn_signature_active ? "Ativa" : "Sem assinatura"}</Badge></td><td className="px-3 py-2">{item.cdn_signature_updated_at ? new Date(item.cdn_signature_updated_at).toLocaleString("pt-BR") : "—"}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </CardContent>
      </Card>}
      {!readOnly && <Card>
        <CardHeader>
          <CardTitle>Propagações de imagens</CardTitle>
          <CardDescription>Jobs retomáveis com inventário completo do R2 e resultado individual de cada produto.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left"><tr><th className="px-3 py-2">Início</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Progresso</th><th className="px-3 py-2">Atualizados</th><th className="px-3 py-2">Sem imagem</th><th className="px-3 py-2">Já CDN</th><th className="px-3 py-2">Erros</th><th className="px-3 py-2">Ações</th></tr></thead>
              <tbody>
                {(imageJobs.data ?? []).map((job: any) => (
                  <tr key={job.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(job.created_at).toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-2"><Badge variant={job.status === "erro" ? "destructive" : job.status === "concluido" ? "secondary" : "outline"}>{job.status}</Badge>{job.last_error && <div className="mt-1 max-w-sm text-xs text-destructive">{job.last_error}</div>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{job.status === "inventario" ? `Catalogando R2 · ${job.inventory_scanned} imagens` : `${job.processed_products}/${job.total_products}`}</td>
                    <td className="px-3 py-2">{job.updated_products}</td><td className="px-3 py-2">{job.no_image_products}</td><td className="px-3 py-2">{job.already_cdn_products}</td><td className="px-3 py-2">{job.error_products}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><Button size="sm" variant="outline" onClick={() => { setReportJobId(job.id); setReportPage(0); }}>Ver produtos</Button>{job.status === "erro" && <Button size="sm" variant="secondary" onClick={() => handleRetryImageJob(job.id)}>Tentar novamente</Button>}{["inventario", "preparando", "processando"].includes(job.status) && <Button size="sm" variant="secondary" disabled={resumingImageJobId === job.id} onClick={() => handleResumeImageJob(job.id)}>{resumingImageJobId === job.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Continuar agora</Button>}{["inventario", "preparando", "processando"].includes(job.status) && <Button size="sm" variant="ghost" onClick={() => handleCancelImageJob(job.id)}>Cancelar</Button>}</td>
                  </tr>
                ))}
                {!imageJobs.isLoading && !(imageJobs.data?.length) && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Nenhuma propagação executada.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>}
      <CompanyCatalogStatus companyId={selected} />
      <Dialog open={!!reportJobId} onOpenChange={(open) => { if (!open) setReportJobId(null); }}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader><DialogTitle>Relatório da propagação</DialogTitle><DialogDescription>Todos os produtos processados, os códigos usados no cruzamento e o motivo do resultado.</DialogDescription></DialogHeader>
          {reportJob?.status === "inventario" && <Alert><Loader2 className="h-4 w-4 animate-spin" /><AlertDescription>O R2 ainda está sendo catalogado ({reportJob.inventory_scanned} imagens). A lista de produtos será criada automaticamente assim que o inventário terminar.</AlertDescription></Alert>}
          {reportJob?.status === "preparando" && <Alert><Loader2 className="h-4 w-4 animate-spin" /><AlertDescription>Inventário concluído. O portal está montando a fila com todos os produtos das empresas selecionadas.</AlertDescription></Alert>}
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-xs" placeholder="Buscar SKU ou código do fornecedor" value={reportSearch} onChange={(e) => { setReportSearch(e.target.value); setReportPage(0); }} />
            <Select value={reportStatus} onValueChange={(value: any) => { setReportStatus(value); setReportPage(0); }}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos</SelectItem><SelectItem value="atualizado">Atualizados</SelectItem><SelectItem value="sem_imagem">Sem imagem</SelectItem><SelectItem value="ja_cdn">Já estavam no CDN</SelectItem><SelectItem value="sem_integracao">Sem integração</SelectItem><SelectItem value="erro">Erros</SelectItem><SelectItem value="cancelado">Cancelados</SelectItem></SelectContent></Select>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border">
            <table className="w-full text-xs"><thead className="sticky top-0 bg-muted text-left"><tr><th className="px-2 py-2">SKU</th><th className="px-2 py-2">Cód. fornecedor</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Bases procuradas</th><th className="px-2 py-2">Imagens</th><th className="px-2 py-2">Motivo</th></tr></thead><tbody>
              {(imageReport.data?.items ?? []).map((item: any) => <tr key={item.id} className="border-t align-top"><td className="px-2 py-2 font-mono">{item.codigo ?? "—"}</td><td className="px-2 py-2 font-mono">{item.cod_fornecedor ?? "—"}</td><td className="px-2 py-2"><Badge variant={item.status === "erro" ? "destructive" : "outline"}>{item.status}</Badge></td><td className="px-2 py-2 max-w-56 break-all">{(item.candidate_bases ?? []).join(", ") || "—"}</td><td className="px-2 py-2">{(item.image_keys ?? []).length}</td><td className="px-2 py-2 max-w-80">{item.error || item.reason || "—"}</td></tr>)}
              {!imageReport.isLoading && !(imageReport.data?.items?.length) && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">{reportJob?.status === "inventario" ? "Aguardando a conclusão do inventário do R2." : reportJob?.status === "preparando" ? "Montando a fila de produtos." : "Nenhum produto neste filtro."}</td></tr>}
            </tbody></table>
          </div>
          <div className="flex items-center justify-between text-sm"><span>{imageReport.data?.total ?? 0} produto(s)</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={reportPage === 0} onClick={() => setReportPage((page) => Math.max(0, page - 1))}>Anterior</Button><Button size="sm" variant="outline" disabled={!imageReport.data || (reportPage + 1) * imageReport.data.page_size >= imageReport.data.total} onClick={() => setReportPage((page) => page + 1)}>Próxima</Button></div></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
