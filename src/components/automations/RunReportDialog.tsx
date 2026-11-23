import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Download, ArrowRight } from "lucide-react";
import {
  getAutomationRunReport,
  listAutomationChanges,
  exportAutomationChanges,
} from "@/lib/automations.functions";

const TIPO_LABEL: Record<string, string> = {
  preco_venda: "Preço de venda",
  preco_custo: "Preço de custo",
  estoque: "Estoque (fornecedor)",
  estoque_ml: "Estoque (Mercado Livre)",
  preco_loja: "Preço na multiloja",
  ativado: "Ativado",
  inativado: "Inativado",
};

const TIPOS = ["todos", "preco_venda", "preco_custo", "estoque", "estoque_ml", "preco_loja", "ativado", "inativado"];

const PAGE_SIZE = 50;

export function RunReportDialog({
  runId,
  open,
  onOpenChange,
}: {
  runId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [tipo, setTipo] = useState("todos");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const fetchReport = useServerFn(getAutomationRunReport);
  const fetchChanges = useServerFn(listAutomationChanges);
  const doExport = useServerFn(exportAutomationChanges);

  const report = useQuery({
    queryKey: ["automation-report", runId],
    queryFn: () => fetchReport({ data: { run_id: runId! } }),
    enabled: !!runId && open,
  });

  const changes = useQuery({
    queryKey: ["automation-changes", runId, tipo, search, page],
    queryFn: () =>
      fetchChanges({
        data: { run_id: runId!, tipo, search, page, page_size: PAGE_SIZE },
      }),
    enabled: !!runId && open,
  });

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((changes.data?.total ?? 0) / PAGE_SIZE)),
    [changes.data?.total],
  );

  async function handleExport() {
    if (!runId) return;
    setExporting(true);
    try {
      const res = await doExport({ data: { run_id: runId, tipo } });
      const blob = new Blob(["\ufeff" + res.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `relatorio-automacao-${runId.slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${res.count} alteração(ões) exportada(s).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar");
    } finally {
      setExporting(false);
    }
  }

  const resumo = report.data?.resumo ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Relatório da execução</DialogTitle>
          <DialogDescription>
            Todas as alterações aplicadas nesta automação, com valor antes e depois.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {report.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {Object.keys(resumo).length === 0 && !report.isLoading && (
            <p className="text-sm text-muted-foreground">
              Nenhuma alteração registrada nesta execução.
            </p>
          )}
          {Object.entries(resumo).map(([k, v]) => (
            <Badge key={k} variant="secondary">
              {TIPO_LABEL[k] ?? k}: {v}
            </Badge>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {TIPOS.filter((t) => t === "todos" || resumo[t]).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={tipo === t ? "default" : "outline"}
                onClick={() => {
                  setTipo(t);
                  setPage(1);
                }}
              >
                {t === "todos" ? "Todos" : TIPO_LABEL[t]}
              </Button>
            ))}
          </div>
          <Input
            className="h-9 w-[200px]"
            placeholder="Buscar SKU ou nome"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Exportar CSV
          </Button>
        </div>

        <div className="max-h-[45vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Alteração</TableHead>
                <TableHead>Loja</TableHead>
                <TableHead className="text-right">Antes → Depois</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changes.isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!changes.isLoading && (changes.data?.rows.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    Nada para exibir.
                  </TableCell>
                </TableRow>
              )}
              {(changes.data?.rows ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.sku ?? "—"}</TableCell>
                  <TableCell className="max-w-[240px] truncate text-sm">{r.nome ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{TIPO_LABEL[r.tipo] ?? r.tipo}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.loja_nome ?? r.loja_id ?? "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap">
                    <span className="text-muted-foreground">{r.valor_anterior ?? "—"}</span>
                    <ArrowRight className="mx-1 inline h-3 w-3" />
                    <span className="font-medium">{r.valor_novo ?? "—"}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {changes.data?.total ?? 0} alteração(ões)
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <span>
              {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
