import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, History, MousePointerClick, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  listTransformSessions,
  listTransformSessionProducts,
} from "@/lib/transform-sessions.functions";
import { resolveProductIdsBySkus } from "@/lib/products-tools.functions";

interface Props {
  companyId: string | undefined;
  onSelectIds: (ids: string[]) => void;
}

type LogRow = { sku: string; nome: string; fornecedor: string; status: string };

/** Parser simples de CSV com suporte a campos entre aspas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (c === "\r") continue;
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const UNCHANGED = new Set(["inalterado", "nao_encontrado", "não_encontrado", "erro", ""]);

export function TransformLogDialog({ companyId, onSelectIds }: Props) {
  const fnList = useServerFn(listTransformSessions);
  const fnProducts = useServerFn(listTransformSessionProducts);
  const fnResolve = useServerFn(resolveProductIdsBySkus);

  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [q, setQ] = useState("");

  const [logRows, setLogRows] = useState<LogRow[]>([]);
  const [logName, setLogName] = useState<string | null>(null);
  const [logStatus, setLogStatus] = useState<string>("changed");
  const [logQ, setLogQ] = useState("");
  const [resolving, setResolving] = useState(false);

  const sessions = useQuery({
    queryKey: ["transform-sessions", companyId],
    queryFn: () => fnList({ data: { company_id: companyId! } }),
    enabled: !!companyId && open,
  });

  const changed = useQuery({
    queryKey: ["transform-session-products", sessionId],
    queryFn: () => fnProducts({ data: { session_id: sessionId! } }),
    enabled: !!sessionId,
  });

  const rows = useMemo(() => {
    const list = changed.data ?? [];
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (p) =>
        (p.codigo ?? "").toLowerCase().includes(term) ||
        (p.nome ?? "").toLowerCase().includes(term),
    );
  }, [changed.data, q]);

  const statusOptions = useMemo(() => {
    const s = new Set(logRows.map((r) => r.status).filter(Boolean));
    return Array.from(s).sort();
  }, [logRows]);

  const logFiltered = useMemo(() => {
    const term = logQ.trim().toLowerCase();
    return logRows.filter((r) => {
      if (logStatus === "changed" ? UNCHANGED.has(r.status) : logStatus !== "all" && r.status !== logStatus) return false;
      if (!term) return true;
      return r.sku.toLowerCase().includes(term) || r.nome.toLowerCase().includes(term);
    });
  }, [logRows, logStatus, logQ]);

  async function handleFile(file: File) {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) { toast.error("Arquivo vazio ou inválido."); return; }
    const header = parsed[0].map((h) => h.trim().toLowerCase());
    const iSku = header.indexOf("sku");
    const iNome = header.indexOf("nome");
    const iForn = header.indexOf("fornecedor");
    const iStatus = header.indexOf("status");
    if (iSku < 0 || iStatus < 0) {
      toast.error("O CSV precisa ter as colunas 'sku' e 'status'.");
      return;
    }
    const out: LogRow[] = [];
    for (let i = 1; i < parsed.length; i++) {
      const r = parsed[i];
      const sku = (r[iSku] ?? "").trim();
      if (!sku) continue;
      out.push({
        sku,
        nome: (iNome >= 0 ? r[iNome] ?? "" : "").trim(),
        fornecedor: (iForn >= 0 ? r[iForn] ?? "" : "").trim(),
        status: (r[iStatus] ?? "").trim().toLowerCase(),
      });
    }
    setLogRows(out);
    setLogName(file.name);
    setLogStatus("changed");
    toast.success(`${out.length.toLocaleString("pt-BR")} linha(s) carregadas do log.`);
  }

  function markInList() {
    const ids = (changed.data ?? []).map((p) => p.id);
    if (ids.length === 0) {
      toast.info("Nenhum produto foi alterado nesta transformação.");
      return;
    }
    onSelectIds(ids);
    setOpen(false);
    toast.success(`${ids.length.toLocaleString("pt-BR")} produto(s) alterados marcados na lista.`);
  }

  async function markLogInList() {
    if (!companyId) return;
    const skus = Array.from(new Set(logFiltered.map((r) => r.sku)));
    if (skus.length === 0) { toast.info("Nenhum produto no filtro atual."); return; }
    setResolving(true);
    try {
      const ids: string[] = [];
      let missing = 0;
      for (let i = 0; i < skus.length; i += 1000) {
        const r = await fnResolve({ data: { company_id: companyId, skus: skus.slice(i, i + 1000) } });
        ids.push(...r.ids);
        missing += r.missing.length;
      }
      if (ids.length === 0) { toast.error("Nenhum SKU do log foi encontrado nesta empresa."); return; }
      onSelectIds(ids);
      setOpen(false);
      toast.success(
        `${ids.length.toLocaleString("pt-BR")} produto(s) marcados na lista${missing ? ` (${missing.toLocaleString("pt-BR")} SKU(s) não encontrados)` : ""}.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao localizar os produtos do log.");
    } finally {
      setResolving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!companyId}>
          <History className="mr-2 h-4 w-4" /> Log de transformação
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Log de transformação
          </DialogTitle>
          <DialogDescription>
            Escolha uma transformação registrada ou importe um CSV de log (ex.: sincronização de fornecedor) para filtrar
            somente os produtos que tiveram alguma alteração.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="sessoes">
          <TabsList>
            <TabsTrigger value="sessoes">Transformações registradas</TabsTrigger>
            <TabsTrigger value="csv">Importar log (CSV)</TabsTrigger>
          </TabsList>

          <TabsContent value="sessoes" className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={sessionId} onValueChange={setSessionId}>
                <SelectTrigger className="sm:max-w-md">
                  <SelectValue placeholder={sessions.isLoading ? "Carregando..." : "Selecione a transformação..."} />
                </SelectTrigger>
                <SelectContent>
                  {(sessions.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} — {new Date(s.started_at).toLocaleString("pt-BR")}
                      {s.status === "active" ? " (ativa)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Buscar por SKU ou nome..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="sm:max-w-xs"
                disabled={!sessionId}
              />
              <Button onClick={markInList} disabled={!sessionId || changed.isLoading}>
                <MousePointerClick className="mr-2 h-4 w-4" /> Filtrar na lista
              </Button>
            </div>

            {sessionId && (
              <div className="text-xs text-muted-foreground">
                {changed.isLoading ? (
                  "Carregando alterações..."
                ) : (
                  <>
                    <Badge variant="secondary" className="mr-2">
                      {(changed.data ?? []).length.toLocaleString("pt-BR")} produto(s) alterados
                    </Badge>
                    exibindo {rows.length.toLocaleString("pt-BR")}
                  </>
                )}
              </div>
            )}

            <div className="max-h-[55vh] overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left">
                    <th className="p-2">SKU</th>
                    <th className="p-2">Produto</th>
                    <th className="p-2 text-right">Preço</th>
                    <th className="p-2 text-right">Estoque</th>
                    <th className="p-2">Situação</th>
                    <th className="p-2">Multilojas</th>
                    <th className="p-2">Alterado em</th>
                  </tr>
                </thead>
                <tbody>
                  {!sessionId ? (
                    <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">Selecione uma transformação acima.</td></tr>
                  ) : changed.isLoading ? (
                    <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">
                      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando...
                    </td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">Nenhum produto alterado encontrado.</td></tr>
                  ) : (
                    rows.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="p-2 font-mono">{p.codigo ?? "—"}</td>
                        <td className="max-w-[320px] truncate p-2">{p.nome ?? "—"}</td>
                        <td className="p-2 text-right font-mono">
                          {p.preco != null
                            ? Number(p.preco).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : "—"}
                        </td>
                        <td className="p-2 text-right font-mono">
                          {p.estoque != null ? Number(p.estoque).toLocaleString("pt-BR") : "—"}
                        </td>
                        <td className="p-2">{p.situacao ?? "—"}</td>
                        <td className="p-2">
                          {Number(p.lojas_alteradas ?? 0) > 0 ? (
                            <Badge variant="secondary">
                              {Number(p.lojas_alteradas)} {Number(p.lojas_alteradas) === 1 ? "loja alterada" : "lojas alteradas"}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap p-2">{new Date(p.updated_at).toLocaleString("pt-BR")}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="csv" className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                type="file"
                accept=".csv,text/csv"
                className="sm:max-w-xs"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
              />
              <Select value={logStatus} onValueChange={setLogStatus}>
                <SelectTrigger className="sm:max-w-[260px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="changed">Somente alterados</SelectItem>
                  <SelectItem value="all">Todos os status</SelectItem>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Buscar SKU ou nome..."
                value={logQ}
                onChange={(e) => setLogQ(e.target.value)}
                className="sm:max-w-xs"
                disabled={logRows.length === 0}
              />
              <Button onClick={markLogInList} disabled={logFiltered.length === 0 || resolving}>
                {resolving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MousePointerClick className="mr-2 h-4 w-4" />}
                Filtrar na lista
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {logName ? (
                <>
                  <Badge variant="outline"><Upload className="mr-1 h-3 w-3" />{logName}</Badge>
                  <Badge variant="secondary">{logRows.length.toLocaleString("pt-BR")} linha(s)</Badge>
                  <span>exibindo {logFiltered.length.toLocaleString("pt-BR")}</span>
                </>
              ) : (
                <span>Selecione o CSV do log (colunas sku, nome, fornecedor, status).</span>
              )}
            </div>

            <div className="max-h-[55vh] overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left">
                    <th className="p-2">SKU</th>
                    <th className="p-2">Produto</th>
                    <th className="p-2">Fornecedor</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logFiltered.length === 0 ? (
                    <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">
                      {logRows.length === 0 ? "Nenhum log carregado." : "Nenhuma linha no filtro atual."}
                    </td></tr>
                  ) : (
                    logFiltered.slice(0, 500).map((r, i) => (
                      <tr key={`${r.sku}-${i}`} className="border-t">
                        <td className="p-2 font-mono">{r.sku}</td>
                        <td className="max-w-[340px] truncate p-2">{r.nome || "—"}</td>
                        <td className="p-2">{r.fornecedor || "—"}</td>
                        <td className="p-2">{r.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {logFiltered.length > 500 && (
              <p className="text-xs text-muted-foreground">
                Exibindo as 500 primeiras linhas — "Filtrar na lista" usa todas as {logFiltered.length.toLocaleString("pt-BR")}.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
