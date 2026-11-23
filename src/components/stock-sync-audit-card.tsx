import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCcw, Boxes, FileSpreadsheet, FileText } from "lucide-react";
import {
  startStockSyncAudit,
  runStockAuditBatch,
  cancelStockAuditRun,
  getStockAuditRun,
  listStockAuditItems,
  listStockAuditRuns,
} from "@/lib/stock-audit.functions";

const STATUS_LABEL: Record<string, string> = {
  divergente: "Divergente",
  nao_encontrado: "Não encontrado no Bling",
  erro: "Erro na consulta",
  ok: "Batendo",
};

export function StockSyncAuditCard({ companyId }: { companyId: string | undefined }) {
  const qc = useQueryClient();
  const fnStart = useServerFn(startStockSyncAudit);
  const fnBatch = useServerFn(runStockAuditBatch);
  const fnCancel = useServerFn(cancelStockAuditRun);
  const fnGet = useServerFn(getStockAuditRun);
  const fnItems = useServerFn(listStockAuditItems);
  const fnRuns = useServerFn(listStockAuditRuns);

  const [runId, setRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const cancelRef = useRef(false);

  const runQ = useQuery({
    queryKey: ["stock-audit-run", runId],
    queryFn: () => fnGet({ data: { run_id: runId! } }),
    enabled: !!runId,
  });

  const itemsQ = useQuery({
    queryKey: ["stock-audit-items", runId],
    queryFn: () => fnItems({ data: { run_id: runId!, only_divergent: true, limit: 200 } }),
    enabled: !!runId && !isRunning,
  });

  const historyQ = useQuery({
    queryKey: ["stock-audit-runs", companyId],
    queryFn: () => fnRuns({ data: { company_id: companyId! } }),
    enabled: !!companyId,
  });

  async function driveLoop(id: string) {
    setIsRunning(true);
    cancelRef.current = false;
    try {
      while (!cancelRef.current) {
        const r = await fnBatch({ data: { run_id: id, batch_size: 100 } });
        await qc.invalidateQueries({ queryKey: ["stock-audit-run", id] });
        if (r.cancelled) break;
        if (r.done) {
          toast.success(
            `Auditoria de estoque concluída: ${r.divergent} divergências em ${r.checked} produtos.`,
          );
          break;
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na auditoria de estoque");
    } finally {
      setIsRunning(false);
      await qc.invalidateQueries({ queryKey: ["stock-audit-run", id] });
      await qc.invalidateQueries({ queryKey: ["stock-audit-items", id] });
      await qc.invalidateQueries({ queryKey: ["stock-audit-runs", companyId] });
    }
  }

  async function handleStart() {
    if (!companyId) return;
    try {
      const r = await fnStart({ data: { company_id: companyId, sample_pct: 10 } });
      if (!r.total) {
        toast.error("Nenhum produto elegível para amostra nesta empresa.");
        return;
      }
      setRunId(r.run_id);
      toast.info(`Conferindo ${r.total} produtos no Bling (10% da base).`);
      driveLoop(r.run_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao iniciar auditoria de estoque");
    }
  }

  async function handleCancel() {
    if (!runId) return;
    cancelRef.current = true;
    await fnCancel({ data: { run_id: runId } });
    setIsRunning(false);
    toast.info("Auditoria de estoque cancelada.");
  }

  async function fetchAllItems() {
    if (!runId) return [];
    const rows = (await fnItems({
      data: { run_id: runId, only_divergent: false, limit: 10000 },
    })) as any[];
    return rows.map((it) => ({
      Codigo: it.codigo ?? "",
      Produto: it.nome ?? "",
      Amostra: it.bucket === "zerado" ? "Zerado" : "Com estoque",
      "Estoque base": it.estoque_local ?? "",
      "Estoque Bling": it.estoque_bling ?? "",
      Diferenca: it.diferenca ?? "",
      Situacao: STATUS_LABEL[it.status] ?? it.status,
      Detalhe: it.detalhe ?? "",
    }));
  }

  async function handleExcel() {
    try {
      const rows = await fetchAllItems();
      if (!rows.length) return toast.error("Nenhum produto verificado para exportar.");
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Auditoria");
      XLSX.writeFile(wb, `auditoria-estoque-${runId}.xlsx`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar o Excel");
    }
  }

  async function handlePdf() {
    try {
      const rows = await fetchAllItems();
      if (!rows.length) return toast.error("Nenhum produto verificado para exportar.");
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF({ orientation: "landscape" });
      doc.setFontSize(14);
      doc.text("Auditoria de sincronização de estoque", 14, 14);
      doc.setFontSize(9);
      doc.text(
        `Gerado em ${new Date().toLocaleString("pt-BR")} · ${rows.length} produtos verificados`,
        14,
        20,
      );
      autoTable(doc, {
        startY: 26,
        styles: { fontSize: 7 },
        head: [Object.keys(rows[0])],
        body: rows.map((r) => Object.values(r).map((v) => String(v))),
      });
      doc.save(`auditoria-estoque-${runId}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar o PDF");
    }
  }

  const run = runQ.data as any;
  const pct = run && run.total_products > 0 ? (run.checked_products / run.total_products) * 100 : 0;
  const items = (itemsQ.data ?? []) as any[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Boxes className="h-5 w-5" /> Auditoria de sincronização de estoque
        </CardTitle>
        <CardDescription>
          Sorteia 10% dos produtos da empresa (com estoque e zerados) e compara o estoque da base com
          o saldo atual no Bling.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleStart} disabled={!companyId || isRunning}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${isRunning ? "animate-spin" : ""}`} />
            {isRunning ? "Conferindo..." : "Conferir 10% dos produtos"}
          </Button>
          {isRunning && (
            <Button variant="destructive" onClick={handleCancel}>
              Cancelar
            </Button>
          )}
          <Button variant="outline" onClick={handleExcel} disabled={!runId || isRunning}>
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Baixar Excel
          </Button>
          <Button variant="outline" onClick={handlePdf} disabled={!runId || isRunning}>
            <FileText className="mr-2 h-4 w-4" /> Baixar PDF
          </Button>
        </div>

        {run && (
          <div className="space-y-2">
            <Progress value={pct} />
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
              <Box label="Conferidos">
                {run.checked_products} / {run.total_products}
              </Box>
              <Box label="Batendo">{run.ok_count}</Box>
              <Box label="Divergentes">
                <span className="text-red-600">{run.divergent_count}</span>
              </Box>
              <Box label="Sem retorno">{run.missing_count}</Box>
              <Box label="Erros">{run.error_count}</Box>
            </div>
          </div>
        )}

        {!isRunning && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2">Código</th>
                  <th>Produto</th>
                  <th>Amostra</th>
                  <th>Base</th>
                  <th>Bling</th>
                  <th>Diferença</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="py-2">{it.codigo ?? "—"}</td>
                    <td className="max-w-[280px] truncate">{it.nome ?? "—"}</td>
                    <td>{it.bucket === "zerado" ? "Zerado" : "Com estoque"}</td>
                    <td>{it.estoque_local ?? "—"}</td>
                    <td>{it.estoque_bling ?? "—"}</td>
                    <td className="font-medium text-red-600">{it.diferenca ?? "—"}</td>
                    <td>
                      <Badge variant="secondary">{STATUS_LABEL[it.status] ?? it.status}</Badge>
                      {it.detalhe && (
                        <div className="text-xs text-muted-foreground">{it.detalhe}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {historyQ.data && (historyQ.data as any[]).length > 0 && (
          <div className="space-y-1 text-sm">
            <div className="text-xs uppercase text-muted-foreground">Execuções anteriores</div>
            {(historyQ.data as any[]).slice(0, 5).map((h) => (
              <button
                key={h.id}
                onClick={() => setRunId(h.id)}
                className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left hover:bg-muted/40"
              >
                <span>{new Date(h.created_at).toLocaleString("pt-BR")}</span>
                <span className="text-muted-foreground">
                  {h.checked_products}/{h.total_products} conferidos · {h.divergent_count} divergentes
                </span>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{children}</div>
    </div>
  );
}
