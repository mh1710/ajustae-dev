import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { listMyCompanies } from "@/lib/companies.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import { cancelAuditRun, startAuditRun, runAuditBatch, getAuditRun, listAuditRuns, listAuditRunResults } from "@/lib/audit.functions";
import { Loader2, PlayCircle, FileSpreadsheet, FileText } from "lucide-react";
import { StockSyncAuditCard } from "@/components/stock-sync-audit-card";
import { useAccess } from "@/hooks/use-access";

export const Route = createFileRoute("/_authenticated/auditoria")({
  head: () => ({ meta: [{"title": "Auditoria | Ajusta-Ê"}, {"name": "description", "content": "Confira erros e avisos no cadastro dos produtos da empresa."}, {"property": "og:title", "content": "Auditoria | Ajusta-Ê"}, {"property": "og:description", "content": "Confira erros e avisos no cadastro dos produtos da empresa."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }), component: AuditoriaPage });

function AuditoriaPage() {
  const { access } = useAccess();
  const qc = useQueryClient();
  const fetchCompanies = useServerFn(listMyCompanies);
  const fnStart = useServerFn(startAuditRun);
  const fnBatch = useServerFn(runAuditBatch);
  const fnCancel = useServerFn(cancelAuditRun);
  const fnGet = useServerFn(getAuditRun);
  const fnList = useServerFn(listAuditRuns);
  const fnResults = useServerFn(listAuditRunResults);
  const [exporting, setExporting] = useState<string | null>(null);

  const companies = useQuery({ queryKey: ["companies"], queryFn: () => fetchCompanies() });
  const [companyId, setCompanyId] = useSelectedCompany();
  useEffect(() => { if (!companyId && companies.data?.[0]) setCompanyId(companies.data[0].id); }, [companies.data, companyId]);

  const [runId, setRunId] = useState<string | null>(null);
  const [liveRun, setLiveRun] = useState<any>(null);
  const running = useRef(false);
  const [isRunning, setIsRunning] = useState(false);
  const cancelRef = useRef(false);
  const allModeRef = useRef(false);
  const [allProgress, setAllProgress] = useState<{ index: number; total: number; nome: string } | null>(null);
  /** Pergunta de escopo antes de cada auditoria: todos os produtos ou apenas os ativos. */
  const [scopeAsk, setScopeAsk] = useState<null | "one" | "all">(null);
  const [skipImages, setSkipImages] = useState(false);
  const [onlyActive, setOnlyActive] = useState(true);

  const runQ = useQuery({
    queryKey: ["audit-run", runId],
    queryFn: () => fnGet({ data: { run_id: runId! } }),
    enabled: !!runId,
    refetchInterval: (q) => (q.state.data?.status === "processando" ? 1500 : false),
  });

  const history = useQuery({
    queryKey: ["audit-runs", companyId],
    queryFn: () => fnList({ data: { company_id: companyId! } }),
    enabled: !!companyId,
  });

  useEffect(() => {
    if (runId || running.current) return;
    const unfinished = history.data?.find((item: any) => item.status === "processando");
    if (!unfinished) return;
    setLiveRun(unfinished);
    setRunId(unfinished.id);
    driveLoop(unfinished.id);
  }, [history.data, runId]);

  useEffect(() => {
    if (allModeRef.current) return;
    if (!runId || !runQ.data || runQ.data.status === "processando") return;
    cancelRef.current = true;
    setIsRunning(false);
    setLiveRun(null);
    setRunId(null);
    qc.invalidateQueries({ queryKey: ["audit-runs", companyId] });
  }, [runId, runQ.data?.status, companyId, qc]);

  async function driveLoop(id: string) {
    if (running.current) return;
    running.current = true;
    setIsRunning(true);
    cancelRef.current = false;
    let firstBatch = true;
    let completed = false;
    try {
      while (true) {
        if (cancelRef.current) {
          break;
        }
        // O primeiro lote reage rapidamente. Os demais ficam abaixo do limite
        // seguro de payload/tempo do servidor para bases com dezenas de milhares.
        const r = await fnBatch({ data: { run_id: id, batch_size: firstBatch ? 25 : 150 } });
        firstBatch = false;
        if (cancelRef.current) break;
        setLiveRun((current: any) => ({
          ...(current ?? {}),
          id,
          status: r.done ? "concluida" : "processando",
          phase: "phase" in r ? r.phase : undefined,
          processed_products: r.processed,
          total_products: r.total,
          errors_count: r.errors,
          warnings_count: r.warnings,
          passed_count: r.passed,
        }));
        qc.invalidateQueries({ queryKey: ["audit-run", id] });
        if (r.cancelled) {
          cancelRef.current = true;
          break;
        }
        if (r.done) {
          completed = true;
          break;
        }
      }
      if (completed) toast.success("Auditoria concluída.", { id: `audit-done-${id}` });
    } catch (e) {
      // Não cancela automaticamente: o run continua "processando" e será
      // retomado automaticamente quando a página recarregar.
      toast.error(
        (e instanceof Error ? e.message : "Erro na auditoria") +
          " — a execução será retomada automaticamente.",
      );
    } finally {
      running.current = false;
      setIsRunning(false);
      await qc.invalidateQueries({ queryKey: ["audit-runs", companyId] });
      setRunId((current) => (current === id ? null : current));
      setLiveRun((current: any) => (current?.id === id ? null : current));
    }
  }

  async function handleStart(scopeOnlyActive: boolean, correctedOnly = false) {
    if (!companyId || isRunning || history.data?.some((item) => item.status === "processando")) return;
    try {
      const r = await fnStart({
        data: { company_id: companyId, product_ids: [], rule_ids: [], only_active: scopeOnlyActive, skip_images: skipImages, corrected_only: correctedOnly },
      });
      setLiveRun({
        id: r.run_id,
        status: "processando",
        processed_products: 0,
        total_products: r.total,
        errors_count: 0,
        warnings_count: 0,
        passed_count: 0,
      });
      setRunId(r.run_id);
      toast.info(`Auditando ${r.total} produtos...`);
      driveLoop(r.run_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  /** Audita, uma após a outra, todas as empresas da conta. */
  async function handleStartAll(scopeOnlyActive: boolean) {
    const list = companies.data ?? [];
    if (list.length === 0 || running.current) return;
    running.current = true;
    allModeRef.current = true;
    cancelRef.current = false;
    setIsRunning(true);
    try {
      for (let i = 0; i < list.length; i++) {
        if (cancelRef.current) break;
        const c = list[i];
        setAllProgress({ index: i + 1, total: list.length, nome: c.nome });
        const r = await fnStart({
          data: { company_id: c.id, product_ids: [], rule_ids: [], only_active: scopeOnlyActive, skip_images: skipImages },
        });
        setRunId(r.run_id);
        setLiveRun({
          id: r.run_id,
          status: "processando",
          processed_products: 0,
          total_products: r.total,
          errors_count: 0,
          warnings_count: 0,
          passed_count: 0,
        });
        let firstBatch = true;
        while (true) {
          if (cancelRef.current) break;
          const b = await fnBatch({ data: { run_id: r.run_id, batch_size: firstBatch ? 25 : 150 } });
          firstBatch = false;
          setLiveRun((current: any) => ({
            ...(current ?? {}),
            id: r.run_id,
            status: b.done ? "concluida" : "processando",
            phase: "phase" in b ? b.phase : undefined,
            processed_products: b.processed,
            total_products: b.total,
            errors_count: b.errors,
            warnings_count: b.warnings,
            passed_count: b.passed,
          }));
          if (b.cancelled) {
            cancelRef.current = true;
            break;
          }
          if (b.done) break;
        }
      }
      if (!cancelRef.current) toast.success("Auditoria de todas as empresas concluída.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na auditoria de todas as empresas");
    } finally {
      running.current = false;
      allModeRef.current = false;
      setIsRunning(false);
      setAllProgress(null);
      setRunId(null);
      setLiveRun(null);
      await qc.invalidateQueries({ queryKey: ["audit-runs", companyId] });
    }
  }

  async function handleCancel() {
    if (!runId) return;
    cancelRef.current = true;
    try {
      await fnCancel({ data: { run_id: runId } });
      await qc.invalidateQueries({ queryKey: ["audit-run", runId] });
      await qc.invalidateQueries({ queryKey: ["audit-runs", companyId] });
      setIsRunning(false);
      setLiveRun(null);
      setRunId(null);
      toast.info("Auditoria cancelada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível cancelar a auditoria");
    }
  }

  async function fetchRunIssues(id: string) {
    const all: any[] = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const r = (await fnResults({ data: { run_id: id, offset, limit: pageSize } })) as any;
      const items = r.items ?? [];
      all.push(...items);
      if (items.length < pageSize) break;
      offset += items.length;
    }

    type ExportIssue = {
      codigo?: string;
      produto?: string;
      regra?: string;
      categoria?: string;
      severidade?: string;
      mensagem?: string;
    };
    const grouped = new Map<string, { codigo: string; produto: string; issues: ExportIssue[] }>();
    for (const item of all) {
      const key = `${item.codigo ?? ""}\u0000${item.produto ?? ""}`;
      const current = grouped.get(key) ?? {
        codigo: item.codigo ?? "",
        produto: item.produto ?? "",
        issues: [] as ExportIssue[],
      };
      current.issues.push(item);
      grouped.set(key, current);
    }

    return [...grouped.values()].map((product) => ({
      Codigo: product.codigo,
      Produto: product.produto,
      "Total de problemas": product.issues.length,
      Problemas: product.issues
        .map((issue, index) => {
          const severity = issue.severidade === "error" ? "Erro" : "Aviso";
          return `${index + 1}. [${severity}] ${issue.regra ?? "Sem regra"} · ${issue.categoria ?? "Sem categoria"}: ${issue.mensagem ?? ""}`;
        })
        .join("\n"),
    }));
  }

  async function handleExport(id: string, format: "excel" | "pdf") {
    setExporting(`${id}:${format}`);
    try {
      const rows = await fetchRunIssues(id);
      if (!rows.length) {
        toast.info("Esta auditoria não encontrou erros nem avisos.");
        return;
      }
      if (format === "excel") {
        const XLSX = await import("xlsx");
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Auditoria");
        XLSX.writeFile(wb, `auditoria-${id}.xlsx`);
      } else {
        const { default: jsPDF } = await import("jspdf");
        const { default: autoTable } = await import("jspdf-autotable");
        const doc = new jsPDF({ orientation: "landscape" });
        doc.setFontSize(14);
        doc.text("Relatório de auditoria de produtos", 14, 14);
        doc.setFontSize(9);
        doc.text(
          `Gerado em ${new Date().toLocaleString("pt-BR")} · ${rows.reduce((total, row) => total + Number(row["Total de problemas"] ?? 0), 0)} problemas em ${rows.length} produtos`,
          14,
          20,
        );
        autoTable(doc, {
          startY: 26,
          styles: { fontSize: 7, cellWidth: "wrap", valign: "top" },
          columnStyles: { 3: { cellWidth: 170 } },
          head: [Object.keys(rows[0])],
          body: rows.map((r) => Object.values(r).map((v) => String(v))),
        });
        doc.save(`auditoria-${id}.pdf`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao exportar relatório");
    } finally {
      setExporting(null);
    }
  }

  const fetchedRun = runQ.data;
  const run = fetchedRun && liveRun?.id === fetchedRun.id
    ? {
        ...fetchedRun,
        processed_products: Math.max(fetchedRun.processed_products ?? 0, liveRun.processed_products ?? 0),
        errors_count: Math.max(fetchedRun.errors_count ?? 0, liveRun.errors_count ?? 0),
        warnings_count: Math.max(fetchedRun.warnings_count ?? 0, liveRun.warnings_count ?? 0),
        passed_count: Math.max(fetchedRun.passed_count ?? 0, liveRun.passed_count ?? 0),
      }
    : fetchedRun ?? liveRun;
  const imagePhase = run?.status === "processando" && (((run as any).image_scan_started && !(run as any).image_scan_done) || (!fetchedRun && liveRun?.phase === "imagens"));
  const checkedProducts = Math.min(run?.total_products ?? 0, Math.max(run?.processed_products ?? 0, (run as any)?.image_scan_checked ?? 0));
  const remainingProducts = Math.max(0, (run?.total_products ?? 0) - checkedProducts);
  const pct = run && run.total_products > 0 ? (checkedProducts / run.total_products) * 100 : 0;

  return (
    <div className="p-8 space-y-6">

      {/* Escopo da auditoria: todos os produtos ou apenas os ativos. */}
      <Dialog open={scopeAsk !== null} onOpenChange={(o) => { if (!o) setScopeAsk(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Quais produtos auditar?</DialogTitle>
            <DialogDescription>
              Você pode considerar todos os produtos ou apenas os que estão ativos no Bling.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setOnlyActive(true)}
              className={`w-full rounded-md border p-3 text-left text-sm ${onlyActive ? "border-primary bg-primary/5" : "border-border"}`}
            >
              <span className="font-medium">Apenas produtos ativos</span>
              <span className="block text-muted-foreground">Ignora os produtos inativos (recomendado).</span>
            </button>
            <button
              type="button"
              onClick={() => setOnlyActive(false)}
              className={`w-full rounded-md border p-3 text-left text-sm ${!onlyActive ? "border-primary bg-primary/5" : "border-border"}`}
            >
              <span className="font-medium">Todos os produtos</span>
              <span className="block text-muted-foreground">Inclui também os produtos inativos.</span>
            </button>
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={skipImages} onChange={(e) => setSkipImages(e.target.checked)} />
            <span><span className="font-medium">Auditoria rápida (sem conferir fotos)</span>
              <span className="block text-muted-foreground">Pula a verificação de imagem padrão e fotos inacessíveis.</span></span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScopeAsk(null)}>Cancelar</Button>
            <Button
              onClick={() => {
                const mode = scopeAsk;
                const scope = onlyActive;
                setScopeAsk(null);
                if (mode === "one") void handleStart(scope);
                else if (mode === "all") void handleStartAll(scope);
              }}
            >
              <PlayCircle className="mr-2 h-4 w-4" /> Iniciar auditoria
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Auditoria</h1>
          <p className="mt-1 text-sm text-muted-foreground">Executa as regras ativas contra todos os produtos.</p>
        </div>
        <div className="w-64">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger><SelectValue placeholder="Empresa..." /></SelectTrigger>
            <SelectContent>
              {companies.data?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nova auditoria</CardTitle>
          <CardDescription>Roda todas as regras ativas para todos os produtos da empresa.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => { setOnlyActive(true); setScopeAsk("one"); }}
              disabled={!companyId || isRunning || (run?.status === "processando")}
            >
              <PlayCircle className="mr-2 h-4 w-4" /> Executar auditoria
            </Button>
            <Button
              variant="outline"
              className="h-auto whitespace-normal text-left"
              onClick={() => void handleStart(false, true)}
              disabled={!companyId || isRunning || history.isLoading || history.data?.some((item) => item.status === "processando")}
              title="Auditar todas as correções pendentes desta empresa, mantendo os resultados dos demais produtos"
            >
              <PlayCircle className="mr-2 h-4 w-4 shrink-0" /> Auditar corrigidos recentemente
            </Button>
            <Button
              variant="outline"
              onClick={() => { setOnlyActive(true); setScopeAsk("all"); }}
              disabled={isRunning || !companies.data || companies.data.length === 0}
            >
              <PlayCircle className="mr-2 h-4 w-4" /> Auditar todas as empresas
            </Button>
          </div>
          {run && (
            <div className="space-y-2">
              <Progress value={pct} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <Info label={imagePhase ? "Fotos conferidas · produtos" : "Auditados"}>{checkedProducts.toLocaleString("pt-BR")} / {run.total_products.toLocaleString("pt-BR")}</Info>
                <Info label="Faltam">{remainingProducts.toLocaleString("pt-BR")}</Info>
                <Info label="Passou">{run.passed_count}</Info>
                <Info label="Avisos">{run.warnings_count}</Info>
                <Info label="Erros">{run.errors_count}</Info>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {!access.company_restricted && <StockSyncAuditCard companyId={companyId} />}

      <Card>
        <CardHeader><CardTitle>Histórico</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr><th className="py-2">Quando</th><th>Status</th><th>Produtos</th><th>Passou</th><th>Avisos</th><th>Erros</th><th>Duração</th><th>Relatório</th></tr>
              </thead>
              <tbody>
                {history.data?.map((h: any) => (
                  <tr key={h.id} className="border-t">
                    <td className="py-2">{new Date(h.created_at).toLocaleString("pt-BR")}</td>
                    <td><Badge variant="secondary">{h.status}</Badge></td>
                    <td>{h.processed_products}/{h.total_products}</td>
                    <td>{h.passed_count}</td>
                    <td className="text-amber-600">{h.warnings_count}</td>
                    <td className="text-red-600">{h.errors_count}</td>
                    <td>{h.duration_ms ? `${Math.round(h.duration_ms/1000)}s` : "—"}</td>
                    <td>
                      {h.status !== "processando" && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Baixar Excel"
                            disabled={exporting !== null}
                            onClick={() => handleExport(h.id, "excel")}
                          >
                            {exporting === `${h.id}:excel` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileSpreadsheet className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Baixar PDF"
                            disabled={exporting !== null}
                            onClick={() => handleExport(h.id, "pdf")}
                          >
                            {exporting === `${h.id}:pdf` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileText className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {history.data && history.data.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Nenhuma auditoria ainda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{children}</div>
    </div>
  );
}
