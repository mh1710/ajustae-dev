import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, PlayCircle } from "lucide-react";
import { Loader2, XCircle, RotateCcw, AlertCircle, Cloud } from "lucide-react";
import { listMyCompanies } from "@/lib/companies.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import {
  createImportBatch,
  ingestSheetRows,
  markFileDone,
  classifyBatch,
  getImportBatch,
  listBatchRows,
  applyBatch,
  listImportBatches,
  deleteImportBatch,
  countIngestedRows,
} from "@/lib/imports.functions";
import {
  startProductSync,
  getActiveOrLatestSync,
  cancelSync,
  resumeSync,
  forceCancelSync,
  testBlingWorker,
} from "@/lib/bling-sync.functions";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/_authenticated/importacoes")({
  head: () => ({ meta: [{"title": "Importações | Ajusta-Ê"}, {"name": "description", "content": "Importe produtos e acompanhe o processamento dos dados."}, {"property": "og:title", "content": "Importações | Ajusta-Ê"}, {"property": "og:description", "content": "Importe produtos e acompanhe o processamento dos dados."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }), component: ImportacoesPage });

const CHUNK_SIZE = 250;
const ACTIVE_IMPORT_STATUSES = ["processando", "classificando", "aplicando", "aguardando_revisao"];

function fmtDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function BlockingOverlay({
  title,
  subtitle,
  percent,
  lines,
  indeterminate,
}: {
  title: string;
  subtitle?: string;
  percent?: number;
  lines: { label: string; value: string }[];
  indeterminate?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-[min(92vw,480px)] rounded-lg border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <div className="font-semibold">{title}</div>
            {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
          </div>
        </div>
        {indeterminate ? (
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse bg-primary" />
          </div>
        ) : (
          <Progress value={percent ?? 0} />
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          {lines.map((l) => (
            <div key={l.label} className="flex flex-col">
              <span className="text-xs text-muted-foreground">{l.label}</span>
              <span className="font-medium">{l.value}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Não feche esta aba nem navegue para outra página até o processo terminar.
        </p>
      </div>
    </div>
  );
}

function ImportacoesPage() {
  const qc = useQueryClient();
  const fetchCompanies = useServerFn(listMyCompanies);
  const fnCreateBatch = useServerFn(createImportBatch);
  const fnIngest = useServerFn(ingestSheetRows);
  const fnFileDone = useServerFn(markFileDone);
  const fnClassify = useServerFn(classifyBatch);
  const fnStatus = useServerFn(getImportBatch);
  const fnHistory = useServerFn(listImportBatches);
  const fnDelete = useServerFn(deleteImportBatch);
  const fnCountRows = useServerFn(countIngestedRows);

  const companies = useQuery({ queryKey: ["companies"], queryFn: () => fetchCompanies() });
  const [companyId, setCompanyId] = useSelectedCompany();
  useEffect(() => {
    if (!companyId && companies.data?.[0]) setCompanyId(companies.data[0].id);
  }, [companies.data, companyId]);

  const [batchId, setBatchId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState({
    started: 0,
    totalFiles: 0,
    processedFiles: 0,
    totalRows: 0,
    parsedRows: 0,
    currentFile: "",
    phase: "idle" as "idle" | "parsing" | "uploading" | "classifying",
  });
  const [uploading, setUploading] = useState(false);
  const [recoveringBatchId, setRecoveringBatchId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Bloqueia fechar/recarregar a aba enquanto há processo em andamento.
  useEffect(() => {
    if (!uploading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [uploading]);

  const status = useQuery({
    queryKey: ["import-batch", batchId],
    queryFn: () => fnStatus({ data: { batch_id: batchId! } }),
    enabled: !!batchId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "processando" || s === "classificando" || s === "aplicando" ? 1000 : false;
    },
  });

  const history = useQuery({
    queryKey: ["import-history", companyId],
    queryFn: () => fnHistory({ data: { company_id: companyId! } }),
    enabled: !!companyId,
    refetchInterval: (q) =>
      q.state.data?.some((b: any) => b.status === "processando" || b.status === "classificando" || b.status === "aplicando")
        ? 1000
        : false,
  });

  useEffect(() => {
    if (batchId || !history.data?.length) return;
    const active = history.data.find((b: any) => ACTIVE_IMPORT_STATUSES.includes(b.status));
    if (active) setBatchId(active.id);
  }, [batchId, history.data]);

  /** Envia um lote de linhas com retentativa; ignora o reenvio se ele já entrou (erro 520/timeout de borda). */
  async function ingestChunkWithRetry(args: {
    batch_id: string;
    company_id: string;
    file_name: string;
    base_row_number: number;
    rows: Record<string, string>[];
  }) {
    const lastRow = args.base_row_number + args.rows.length - 1;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fnIngest({ data: args });
        return;
      } catch (e) {
        // A borda pode devolver 520/timeout mesmo com a gravação concluída.
        const { count } = await fnCountRows({
          data: {
            batch_id: args.batch_id,
            file_name: args.file_name,
            from_row: args.base_row_number,
            to_row: lastRow,
          },
        }).catch(() => ({ count: 0 }));
        if (count >= args.rows.length) return;
        if (attempt === 4) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }

  async function runClassify(id: string, company: string) {
    // Classificação incremental: evita "upstream request timeout" e erro 520 em volumes grandes.
    // O lote encolhe automaticamente quando o banco está lento.
    let failures = 0;
    let limit = 500;
    for (let i = 0; i < 5000; i++) {
      try {
        const res = await fnClassify({ data: { batch_id: id, company_id: company, limit } });
        failures = 0;
        limit = Math.min(1000, limit + 100);
        qc.invalidateQueries({ queryKey: ["import-batch", id] });
        if (res.done) break;
      } catch (e) {
        failures++;
        if (failures >= 5) throw e;
        limit = Math.max(100, Math.floor(limit / 2));
        await new Promise((r) => setTimeout(r, 2000 * failures));
      }
    }
  }


  async function resumeClassify(id: string) {
    if (!companyId) return;
    setBatchId(id);
    setRecoveringBatchId(id);
    try {
      await runClassify(id, companyId);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["import-batch", id] }),
        qc.invalidateQueries({ queryKey: ["import-history", companyId] }),
      ]);
      toast.success("Importação recuperada. A revisão já está disponível.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao recuperar importação");
    } finally {
      setRecoveringBatchId(null);
    }
  }


  async function parseFile(file: File): Promise<Record<string, string>[]> {
    const name = file.name.toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "", raw: false });
    }
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        delimiter: ";",
        skipEmptyLines: "greedy",
        transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
        complete: (res) => resolve(res.data),
        error: (err) => reject(err),
      });
    });
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0 || !companyId) return;
    setUploading(true);
    setUploadProgress({
      started: Date.now(),
      totalFiles: files.length,
      processedFiles: 0,
      totalRows: 0,
      parsedRows: 0,
      currentFile: "",
      phase: "parsing",
    });
    try {
      const batch = await fnCreateBatch({
        data: { company_id: companyId, files: Array.from(files).map((f) => ({ name: f.name, size: f.size })) },
      });
      setBatchId(batch.id);

      // Fase 1: parse de todos os arquivos para saber o total de linhas.
      const parsed: { file: File; rows: Record<string, string>[] }[] = [];
      for (const file of Array.from(files)) {
        setUploadProgress((p) => ({ ...p, currentFile: file.name, phase: "parsing" }));
        const rows = await parseFile(file);
        parsed.push({ file, rows });
        setUploadProgress((p) => ({ ...p, parsedRows: p.parsedRows + rows.length }));
      }

      // Fase 2: envio em chunks.
      setUploadProgress((p) => ({ ...p, phase: "uploading", started: Date.now() }));
      for (const { file, rows } of parsed) {
        setUploadProgress((p) => ({ ...p, currentFile: file.name }));
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
          const chunk = rows.slice(i, i + CHUNK_SIZE);
          await ingestChunkWithRetry({
            batch_id: batch.id,
            company_id: companyId,
            file_name: file.name,
            base_row_number: i + 2, // linha 1 é o cabeçalho
            rows: chunk,
          });
          setUploadProgress((p) => ({ ...p, totalRows: p.totalRows + chunk.length }));
        }
        await fnFileDone({ data: { batch_id: batch.id, company_id: companyId } });
        setUploadProgress((p) => ({ ...p, processedFiles: p.processedFiles + 1 }));
      }

      setUploadProgress((p) => ({ ...p, phase: "classifying" }));
      await runClassify(batch.id, companyId);
      qc.invalidateQueries({ queryKey: ["import-batch", batch.id] });
      qc.invalidateQueries({ queryKey: ["import-history", companyId] });
      toast.success("Upload concluído. Revise abaixo antes de aplicar.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
      setUploadProgress((p) => ({ ...p, phase: "idle" }));
    }
  }

  const s = status.data;
  const elapsed = uploadProgress.started ? Date.now() - uploadProgress.started : 0;
  const rowsRate = elapsed > 0 ? uploadProgress.totalRows / (elapsed / 1000) : 0;
  const totalToUpload = uploadProgress.parsedRows;
  const uploadPct =
    totalToUpload > 0
      ? Math.min(100, (uploadProgress.totalRows / totalToUpload) * 100)
      : 0;
  const remainingRows = Math.max(0, totalToUpload - uploadProgress.totalRows);
  const etaMs = rowsRate > 0 ? (remainingRows / rowsRate) * 1000 : 0;
  const percent = uploadPct;

  // Estado do tempo ao vivo (força re-render a cada segundo enquanto processa).
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!uploading) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [uploading]);

  return (
    <div className="p-8 space-y-6">
      {uploading && (
        <BlockingOverlay
          title={
            uploadProgress.phase === "parsing"
              ? "Lendo planilhas..."
              : uploadProgress.phase === "uploading"
                ? "Enviando dados para o servidor..."
                : uploadProgress.phase === "classifying"
                  ? "Classificando produtos novos e existentes..."
                  : "Processando..."
          }
          subtitle={uploadProgress.currentFile || undefined}
          percent={percent}
          indeterminate={uploadProgress.phase === "parsing"}
          lines={[
            { label: "Arquivos", value: `${uploadProgress.processedFiles}/${uploadProgress.totalFiles}` },
            {
              label: "Linhas",
              value: `${uploadProgress.totalRows.toLocaleString("pt-BR")}${totalToUpload ? ` / ${totalToUpload.toLocaleString("pt-BR")}` : ""}`,
            },
            {
              label: "Classificados no banco",
              value:
                uploadProgress.phase === "classifying" && s
                  ? `${(s.classify_processed ?? 0).toLocaleString("pt-BR")} / ${(s.classify_total ?? totalToUpload).toLocaleString("pt-BR")}`
                  : "—",
            },
            { label: "Tempo", value: fmtDuration(elapsed) },
            {
              label: "Tempo restante",
              value:
                uploadProgress.phase === "uploading" && etaMs > 0
                  ? fmtDuration(etaMs)
                  : "—",
            },
          ]}
        />
      )}
      {recoveringBatchId && (
        <BlockingOverlay
          title="Recuperando importação..."
          subtitle="Finalizando a preparação das linhas já salvas no banco"
          indeterminate
          lines={[
            { label: "Importação", value: recoveringBatchId.slice(0, 8) },
            { label: "Status", value: "classificando" },
            { label: "Ação", value: "retomar revisão" },
            { label: "Tempo", value: "—" },
          ]}
        />
      )}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Importações</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Importe planilhas CSV/XLSX exportadas do Bling. O SKU (Código) é a chave principal.
          </p>
        </div>
        <div className="w-64">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger><SelectValue placeholder="Empresa..." /></SelectTrigger>
            <SelectContent>
              {companies.data?.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Nova importação</CardTitle>
          <CardDescription>Selecione um ou vários arquivos CSV/XLSX no layout do Bling.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <Button disabled={!companyId || uploading} onClick={() => fileRef.current?.click()}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            {uploading ? "Enviando..." : "Selecionar arquivos"}
          </Button>
          {(uploading || uploadProgress.totalFiles > 0) && (
            <div className="space-y-2">
              <Progress value={percent} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-muted-foreground">
                <div>Arquivos: {uploadProgress.processedFiles}/{uploadProgress.totalFiles}</div>
                <div>Linhas: {uploadProgress.totalRows.toLocaleString("pt-BR")}</div>
                <div>Tempo: {fmtDuration(elapsed)}</div>
                <div>Velocidade: {rowsRate.toFixed(0)} linhas/s</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {companyId && <BlingSyncCard companyId={companyId} />}

      {batchId && s && (
        <ReviewCard batchId={batchId} companyId={companyId!} batch={s} onResumeClassify={resumeClassify} />
      )}

      <Card>
        <CardHeader><CardTitle>Histórico</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr><th className="py-2">Quando</th><th>Status</th><th>Arquivos</th><th>Linhas</th><th>Novos</th><th>Atualizados</th><th>Ignorados</th><th></th></tr>
              </thead>
              <tbody>
                {history.data?.map((h) => (
                  <tr key={h.id} className="border-t">
                    <td className="py-2">{new Date(h.created_at).toLocaleString("pt-BR")}</td>
                    <td><Badge variant="secondary">{h.status}</Badge></td>
                    <td>{h.processed_files}/{h.total_files}</td>
                    <td>{h.total_rows}</td>
                    <td>{h.new_count}</td>
                    <td>{h.updated_count}</td>
                    <td>{h.ignored_count}</td>
                    <td className="py-2 text-right space-x-2">
                      {h.status === "aguardando_revisao" && (
                        <Button size="sm" variant="outline" onClick={() => { setBatchId(h.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                          Retomar revisão
                        </Button>
                      )}
                      {(h.status === "classificando" || h.status === "processando") && Number(h.total_rows ?? 0) > 0 && (
                        <Button size="sm" variant="outline" disabled={!!recoveringBatchId} onClick={() => resumeClassify(h.id)}>
                          Finalizar preparação
                        </Button>
                      )}
                      {h.status === "aplicando" && (
                        <Button size="sm" variant="outline" onClick={() => { setBatchId(h.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                          Ver aplicação
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={async () => {
                          if (!companyId) return;
                          if (!confirm(`Excluir esta importação? Isto remove todas as ${h.total_rows ?? 0} linhas de revisão. Produtos já aplicados na base não são afetados.`)) return;
                          try {
                            await fnDelete({ data: { batch_id: h.id, company_id: companyId } });
                            if (batchId === h.id) setBatchId(null);
                            qc.invalidateQueries({ queryKey: ["import-history", companyId] });
                            toast.success("Importação excluída.");
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Erro ao excluir");
                          }
                        }}
                      >
                        Excluir
                      </Button>
                    </td>
                  </tr>
                ))}
                {history.data && history.data.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Nenhuma importação ainda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReviewCard({
  batchId,
  companyId,
  batch,
  onResumeClassify,
}: {
  batchId: string;
  companyId: string;
  batch: any;
  onResumeClassify: (batchId: string) => void;
}) {
  const qc = useQueryClient();
  const fnList = useServerFn(listBatchRows);
  const fnApply = useServerFn(applyBatch);
  const fnStatus = useServerFn(getImportBatch);

  const [tab, setTab] = useState<"new" | "existing">("new");
  const [page, setPage] = useState(1);
  const [overrides, setOverrides] = useState<Record<string, "import" | "update_changed" | "update_all" | "ignore">>({});
  const [diffOpen, setDiffOpen] = useState<any | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyStarted, setApplyStarted] = useState(0);
  const [, setNow] = useState(0);

  useEffect(() => {
    if (!applying) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.clearInterval(tick);
    };
  }, [applying]);

  useEffect(() => {
    if (!applying) return;
    const id = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ["import-batch", batchId] });
      qc.invalidateQueries({ queryKey: ["import-history", companyId] });
    }, 1000);
    return () => window.clearInterval(id);
  }, [applying, batchId, companyId, qc]);

  const rows = useQuery({
    queryKey: ["batch-rows", batchId, tab, page],
    queryFn: () => fnList({ data: { batch_id: batchId, kind: tab, page, page_size: 50 } }),
    enabled: batch.status === "aguardando_revisao" || batch.status === "aplicada",
  });

  const canReview = batch.status === "aguardando_revisao" || batch.status === "aplicada";
  const classifyTotal = Number(batch.classify_total ?? batch.total_rows ?? 0);
  const classifyProcessed = Number(batch.classify_processed ?? 0);
  const applyTotal = Number(batch.apply_total ?? batch.total_rows ?? 0);
  const applyProcessed = Number(batch.apply_processed ?? 0);

  /** Espera o batch terminar no servidor (a borda pode cair antes do fim em volumes grandes). */
  async function waitForApplyFinish(maxMs: number) {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const b: any = await fnStatus({ data: { batch_id: batchId } });
        qc.setQueryData(["import-batch", batchId], b);
        if (b?.status === "aplicada") {
          return {
            imported: Number(b.new_count ?? 0),
            updated: Number(b.updated_count ?? 0),
            ignored: Number(b.ignored_count ?? 0),
          };
        }
      } catch {
        /* segue tentando */
      }
    }
    return null;
  }

  async function apply(defaults: { new: "import" | "ignore"; existing: "update_changed" | "update_all" | "ignore" }) {
    setApplying(true);
    setApplyStarted(Date.now());
    try {
      const rowOverrides = Object.entries(overrides).map(([id, action]) => ({ id, action }));
      let res: { imported: number; updated: number; ignored: number; duplicates?: number } | null = null;
      let lastError: unknown = null;
      // Até 3 tentativas: a operação é idempotente (linhas já aplicadas são puladas).
      for (let attempt = 0; attempt < 3 && !res; attempt++) {
        try {
          res = await fnApply({
            data: {
              batch_id: batchId,
              company_id: companyId,
              default_new_action: defaults.new,
              default_existing_action: defaults.existing,
              row_overrides: rowOverrides,
            },
          });
        } catch (e) {
          lastError = e;
          // A conexão pode cair (timeout/520) enquanto o banco continua aplicando.
          res = await waitForApplyFinish(4 * 60 * 1000);
        }
      }
      if (!res) throw lastError instanceof Error ? lastError : new Error("Erro ao aplicar");
      const dup = res.duplicates ?? 0;
      toast.success(
        `Aplicado: ${res.imported} novos, ${res.updated} atualizados, ${res.ignored} ignorados.` +
          (dup > 0 ? ` ${dup} linhas repetidas na planilha foram descartadas (ficou a última de cada código).` : ""),
      );
      qc.invalidateQueries({ queryKey: ["import-batch", batchId] });
      qc.invalidateQueries({ queryKey: ["import-history", companyId] });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao aplicar");
    } finally {
      setApplying(false);
    }
  }


  return (
    <Card>
      {applying && (
        <BlockingOverlay
          title="Aplicando alterações na base..."
          subtitle={`${(batch.apply_processed ?? 0).toLocaleString("pt-BR")} de ${(batch.apply_total ?? batch.total_rows ?? 0).toLocaleString("pt-BR")} linhas persistidas`}
          percent={
            batch.apply_total && batch.apply_total > 0
              ? Math.min(100, (100 * (batch.apply_processed ?? 0)) / batch.apply_total)
              : 0
          }
          indeterminate={!batch.apply_total}
          lines={[
            { label: "Persistidos", value: `${(batch.apply_processed ?? 0).toLocaleString("pt-BR")} / ${(batch.apply_total ?? batch.total_rows ?? 0).toLocaleString("pt-BR")}` },
            { label: "Novos importados", value: String(batch.new_count ?? 0) },
            { label: "Atualizados", value: String(batch.updated_count ?? 0) },
            { label: "Ignorados", value: String(batch.ignored_count ?? 0) },
            { label: "Tempo", value: fmtDuration(applyStarted ? Date.now() - applyStarted : 0) },
          ]}
        />
      )}
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>Revisão — {batch.total_rows} linhas</CardTitle>
            <CardDescription>
              {batch.new_count} novos · {batch.existing_count} já existentes · status: <Badge variant="secondary">{batch.status}</Badge>
            </CardDescription>
          </div>
          {(batch.status === "classificando" || batch.status === "processando") && Number(batch.total_rows ?? 0) > 0 && (
            <Button size="sm" variant="outline" onClick={() => onResumeClassify(batchId)}>
              Finalizar preparação
            </Button>
          )}
          {batch.status === "aplicando" && (
            <Button size="sm" variant="outline" disabled={applying} onClick={() => apply({ new: "import", existing: "update_changed" })}>
              Continuar aplicação
            </Button>
          )}
          {batch.status === "aguardando_revisao" && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={applying} onClick={() => apply({ new: "ignore", existing: "ignore" })} title="Não grava nada na base. Descarta esta importação.">
                Não importar nada
              </Button>
              <Button size="sm" variant="outline" disabled={applying} onClick={() => apply({ new: "import", existing: "update_changed" })} title="Cadastra os produtos novos e, nos que já existem, atualiza apenas os campos que mudaram.">
                Cadastrar novos + atualizar só o que mudou
              </Button>
              <Button size="sm" disabled={applying} onClick={() => apply({ new: "import", existing: "update_all" })} title="Cadastra os novos e sobrescreve todos os campos dos produtos existentes com os dados da planilha.">
                <PlayCircle className="mr-2 h-4 w-4" /> Cadastrar novos + sobrescrever tudo
              </Button>
            </div>
          )}

        </div>
      </CardHeader>
      <CardContent>
        {!canReview && (
          <div className="mb-4 space-y-3 rounded-md border bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">
                {batch.status === "aplicando" ? "Aplicando produtos no banco" : "Preparando revisão"}
              </span>
              <span className="text-muted-foreground">
                {batch.status === "aplicando"
                  ? `${applyProcessed.toLocaleString("pt-BR")} de ${applyTotal.toLocaleString("pt-BR")}`
                  : `${classifyProcessed.toLocaleString("pt-BR")} de ${classifyTotal.toLocaleString("pt-BR")}`}
              </span>
            </div>
            <Progress
              value={
                batch.status === "aplicando"
                  ? applyTotal > 0 ? Math.min(100, (applyProcessed * 100) / applyTotal) : 0
                  : classifyTotal > 0 ? Math.min(100, (classifyProcessed * 100) / classifyTotal) : 0
              }
            />
            <p className="text-xs text-muted-foreground">
              Se a página foi atualizada, use o botão acima para continuar até liberar a revisão.
            </p>
          </div>
        )}
        {canReview && (
          <>
            <div className="mb-4 rounded-md border bg-muted/30 p-4 text-sm">
              <p className="font-medium">Como funciona esta revisão</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                <li><strong>Novos</strong>: SKUs da planilha que ainda não existem na sua base. Se importados, serão criados como produtos novos.</li>
                <li><strong>Existentes</strong>: SKUs já cadastrados. Você escolhe se atualiza só os campos que mudaram ou se sobrescreve tudo com os dados da planilha.</li>
                <li><strong>Atualizar só campos alterados</strong>: mantém o que já está no sistema e grava apenas as diferenças encontradas (coluna “alterações”).</li>
                <li><strong>Sobrescrever todos os campos</strong>: substitui todos os campos do produto pelos valores da planilha, inclusive campos vazios.</li>
                <li><strong>Não importar / não alterar</strong>: a linha é descartada, nada é gravado.</li>
                <li>Se a planilha tiver o mesmo SKU repetido, apenas a <strong>última</strong> linha é aplicada; as demais são marcadas como duplicadas.</li>
                <li>Nada é gravado na base até você clicar em um dos botões de aplicar acima.</li>
              </ul>
            </div>
            <Tabs value={tab} onValueChange={(v) => { setTab(v as "new" | "existing"); setPage(1); }}>
              <TabsList>
                <TabsTrigger value="new">Novos ({batch.new_count})</TabsTrigger>
                <TabsTrigger value="existing">Existentes ({batch.existing_count})</TabsTrigger>
              </TabsList>

              <TabsContent value="new" className="mt-4">
                <RowTable
                  rows={rows.data?.rows ?? []}
                  kind="new"
                  overrides={overrides}
                  onOverride={(id, a) => setOverrides({ ...overrides, [id]: a })}
                  onDiff={setDiffOpen}
                />
              </TabsContent>
              <TabsContent value="existing" className="mt-4">
                <RowTable
                  rows={rows.data?.rows ?? []}
                  kind="existing"
                  overrides={overrides}
                  onOverride={(id, a) => setOverrides({ ...overrides, [id]: a })}
                  onDiff={setDiffOpen}
                />
              </TabsContent>
            </Tabs>
            <div className="mt-3 flex items-center justify-between text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <span>Página {page}</span>
              <Button variant="outline" size="sm" disabled={(rows.data?.rows.length ?? 0) < 50} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={!!diffOpen} onOpenChange={(o) => !o && setDiffOpen(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Comparação Sistema × Planilha</DialogTitle></DialogHeader>
          {diffOpen && (
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">Campo</th><th>Sistema</th><th>Planilha</th></tr>
                </thead>
                <tbody>
                  {(diffOpen.diff ?? []).map((d: any) => (
                    <tr key={d.field} className="border-t align-top">
                      <td className="py-2 pr-3 font-mono text-xs">{d.field}</td>
                      <td className="pr-3">{String(d.sistema ?? "—")}</td>
                      <td className="text-emerald-700 dark:text-emerald-400">{String(d.planilha ?? "—")}</td>
                    </tr>
                  ))}
                  {(!diffOpen.diff || diffOpen.diff.length === 0) && (
                    <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">Sem diferenças.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function RowTable({
  rows,
  kind,
  overrides,
  onOverride,
  onDiff,
}: {
  rows: any[];
  kind: "new" | "existing";
  overrides: Record<string, string>;
  onOverride: (id: string, a: any) => void;
  onDiff: (row: any) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase">
          <tr>
            <th className="px-3 py-2">SKU</th>
            <th className="px-3 py-2">Nome</th>
            <th className="px-3 py-2">Marca</th>
            <th className="px-3 py-2">Preço</th>
            <th className="px-3 py-2">GTIN</th>
            {kind === "existing" && <th className="px-3 py-2">Diferenças</th>}
            <th className="px-3 py-2">Ação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p = r.parsed;
            const diffCount = (r.diff ?? []).length;
            return (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{r.sku ?? "—"}</td>
                <td className="px-3 py-2 max-w-[260px] truncate">{p.nome ?? "—"}</td>
                <td className="px-3 py-2">{p.marca ?? "—"}</td>
                <td className="px-3 py-2">{p.preco != null ? Number(p.preco).toFixed(2) : "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{p.gtin ?? "—"}</td>
                {kind === "existing" && (
                  <td className="px-3 py-2">
                    <button className="underline-offset-2 hover:underline" onClick={() => onDiff(r)}>
                      {diffCount} {diffCount === 1 ? "campo" : "campos"}
                    </button>
                  </td>
                )}
                <td className="px-3 py-2">
                  <Select
                    value={overrides[r.id] ?? (kind === "new" ? "import" : "update_changed")}
                    onValueChange={(v) => onOverride(r.id, v)}
                  >
                    <SelectTrigger className="h-8 w-52"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {kind === "new" ? (
                        <>
                          <SelectItem value="import">Cadastrar produto novo</SelectItem>
                          <SelectItem value="ignore">Não importar</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="update_changed">Atualizar só campos alterados</SelectItem>
                          <SelectItem value="update_all">Sobrescrever todos os campos</SelectItem>
                          <SelectItem value="ignore">Não alterar</SelectItem>
                        </>
                      )}
                    </SelectContent>

                  </Select>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Sem linhas.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
const SYNC_ACTIVE_STATUSES = new Set([
  "pendente","catalogando","processando","pausada_por_limite",
  "pausada_por_erro","retomando","cancelando",
]);

function fmtSyncDuration(s?: number | null) {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m} min ${sec.toString().padStart(2, "0")} s` : `${sec} s`;
}

function BlingSyncCard({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getActiveOrLatestSync);
  const doStart = useServerFn(startProductSync);
  const doCancel = useServerFn(cancelSync);
  const doForceCancel = useServerFn(forceCancelSync);
  const doResume = useServerFn(resumeSync);
  const doTestWorker = useServerFn(testBlingWorker);

  const status = useQuery({
    queryKey: ["sync-status", companyId],
    queryFn: () => fetchStatus({ data: { company_id: companyId } }),
    refetchInterval: (q) => {
      const j = q.state.data?.job;
      return j && SYNC_ACTIVE_STATUSES.has(j.status) ? 2000 : false;
    },
  });
  const job = status.data?.job;
  const isActive = job && SYNC_ACTIVE_STATUSES.has(job.status);
  const cancelingTooLong =
    job?.status === "cancelando" &&
    !!job.last_activity_at &&
    Date.now() - new Date(job.last_activity_at).getTime() > 30_000;

  async function safe(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) toast.success(ok);
      qc.invalidateQueries({ queryKey: ["sync-status", companyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5" />
              Sincronizar produtos via API do Bling
            </CardTitle>
            <CardDescription>
              {job
                ? <>Última sincronização — status: <Badge variant="secondary">{job.status}</Badge></>
                : "Nenhuma sincronização executada ainda."}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {isActive && !job?.cancel_requested && (
              <Button variant="outline" size="sm" onClick={() => safe(() => doCancel({ data: { sync_job_id: job!.id } }), "Cancelamento solicitado.")}>
                <XCircle className="mr-2 h-4 w-4" /> Cancelar
              </Button>
            )}
            {cancelingTooLong && (
              <Button variant="destructive" size="sm" onClick={() => safe(() => doForceCancel({ data: { sync_job_id: job!.id } }), "Sincronização cancelada.")}>
                <XCircle className="mr-2 h-4 w-4" /> Forçar cancelamento
              </Button>
            )}
            {job?.status === "pausada_por_erro" && (
              <Button variant="outline" size="sm" onClick={() => safe(() => doResume({ data: { sync_job_id: job.id } }), "Retomando.")}>
                <RotateCcw className="mr-2 h-4 w-4" /> Retomar
              </Button>
            )}
            {isActive && (
              <Button variant="outline" size="sm" onClick={() => safe(async () => {
                const r = await doTestWorker({ data: { company_id: companyId } });
                toast.info(`Worker HTTP ${r.httpStatus}: ${r.message}`);
              })}>
                Testar worker
              </Button>
            )}
            {!isActive && (
              <Button size="sm" onClick={() => safe(async () => {
                const r = await doStart({ data: { company_id: companyId } });
                toast.success(r.resumed ? "Sincronização já em andamento." : "Sincronização iniciada.");
              })}>
                <PlayCircle className="mr-2 h-4 w-4" /> {job ? "Sincronizar novamente" : "Sincronizar produtos"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {job && (
        <CardContent className="space-y-4">
          {job.phase === "catalogacao" ? (
            (() => {
              const refTotal = status.data?.referenceTotal ?? null;
              const done = job.cataloged_items ?? 0;
              const pct = refTotal && refTotal > 0 ? Math.min(99, (done / refTotal) * 100) : null;
              const remaining = refTotal ? Math.max(0, refTotal - done) : null;
              const rate = job.elapsed_seconds ? done / Math.max(1, job.elapsed_seconds) : 0;
              const eta = remaining !== null && rate > 0 ? Math.round(remaining / rate) : null;
              return (
                <>
                  <Progress value={pct ?? undefined} />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <MiniInfo label="Produtos catalogados">
                      {done.toLocaleString("pt-BR")}
                      {refTotal ? ` / ~${refTotal.toLocaleString("pt-BR")}` : ""}
                    </MiniInfo>
                    <MiniInfo label="Faltam (estimado)">
                      {remaining !== null ? `~${remaining.toLocaleString("pt-BR")} produtos` : "Calculando..."}
                    </MiniInfo>
                    <MiniInfo label="Tempo decorrido">{fmtSyncDuration(job.elapsed_seconds)}</MiniInfo>
                    <MiniInfo label="Tempo restante">
                      {eta !== null ? fmtSyncDuration(eta) : "Calculando..."}
                    </MiniInfo>
                  </div>
                </>
              );
            })()
          ) : (
            <>
              <Progress value={Number(job.progress_percent ?? 0)} />
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <MiniInfo label="Produtos processados">
                  {(job.processed_items ?? 0).toLocaleString("pt-BR")} / {job.total_items?.toLocaleString("pt-BR") ?? "—"}
                </MiniInfo>
                <MiniInfo label="Faltam">
                  {job.total_items != null
                    ? `${Math.max(0, job.total_items - (job.processed_items ?? 0)).toLocaleString("pt-BR")} produtos`
                    : "—"}
                </MiniInfo>
                <MiniInfo label="Sucessos / Falhas">{job.successful_items} / {job.failed_items}</MiniInfo>
                <MiniInfo label="Tempo decorrido">{fmtSyncDuration(job.elapsed_seconds)}</MiniInfo>
                <MiniInfo label="Tempo restante">
                  {job.processed_items < 10 ? "Calculando..." : fmtSyncDuration(job.estimated_remaining_seconds)}
                </MiniInfo>
              </div>
            </>
          )}
          {job.pause_reason && (
            <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{job.pause_reason}</AlertDescription></Alert>
          )}
          {job.last_error_message && (
            <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{job.last_error_message}</AlertDescription></Alert>
          )}
          {isActive && (
            <p className="text-xs text-muted-foreground">A sincronização continua em execução no servidor mesmo se você fechar esta página.</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function MiniInfo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{children}</div>
    </div>
  );
}
