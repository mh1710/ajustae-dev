import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Play, Square, Download, Trash2, Wand2, MousePointerClick, Eye } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import {
  listTransformSessions,
  startTransformSession,
  finishTransformSession,
  deleteTransformSession,
  getTransformSessionProductIds,
  listTransformSessionProducts,
} from "@/lib/transform-sessions.functions";
import { exportProducts } from "@/lib/exports.functions";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Props {
  companyId: string | undefined;
  onSelectIds: (ids: string[]) => void;
}

export function AssistedTransformCard({ companyId, onSelectIds }: Props) {
  const qc = useQueryClient();
  const fnList = useServerFn(listTransformSessions);
  const fnStart = useServerFn(startTransformSession);
  const fnFinish = useServerFn(finishTransformSession);
  const fnDelete = useServerFn(deleteTransformSession);
  const fnIds = useServerFn(getTransformSessionProductIds);
  const fnProducts = useServerFn(listTransformSessionProducts);
  const fnExport = useServerFn(exportProducts);

  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [changesSid, setChangesSid] = useState<string | null>(null);

  const changes = useQuery({
    queryKey: ["transform-session-products", changesSid],
    queryFn: () => fnProducts({ data: { session_id: changesSid! } }),
    enabled: !!changesSid,
  });

  const sessions = useQuery({
    queryKey: ["transform-sessions", companyId],
    queryFn: () => fnList({ data: { company_id: companyId! } }),
    enabled: !!companyId,
  });

  const active = sessions.data?.find((s) => s.status === "active") ?? null;

  async function handleStart() {
    if (!companyId) return;
    setBusy("start");
    try {
      await fnStart({ data: { company_id: companyId, name: name.trim() || undefined } });
      setName("");
      qc.invalidateQueries({ queryKey: ["transform-sessions", companyId] });
      toast.success("Transformação assistida iniciada. Todas as alterações serão registradas.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao iniciar.");
    } finally { setBusy(null); }
  }

  async function handleFinish(sid: string) {
    setBusy(sid);
    try {
      await fnFinish({ data: { session_id: sid, status: "finished" } });
      qc.invalidateQueries({ queryKey: ["transform-sessions", companyId] });
      toast.success("Transformação assistida finalizada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao finalizar.");
    } finally { setBusy(null); }
  }

  async function handleDelete(sid: string) {
    if (!confirm("Excluir esta transformação? O histórico será perdido.")) return;
    setBusy(sid);
    try {
      await fnDelete({ data: { session_id: sid } });
      qc.invalidateQueries({ queryKey: ["transform-sessions", companyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir.");
    } finally { setBusy(null); }
  }

  async function handleSelect(sid: string) {
    setBusy(sid);
    try {
      const r = await fnIds({ data: { session_id: sid } });
      if (r.ids.length === 0) { toast.info("Nenhum produto foi alterado nesta transformação."); return; }
      onSelectIds(r.ids);
      toast.success(`${r.ids.length.toLocaleString("pt-BR")} produto(s) da transformação marcados.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar produtos.");
    } finally { setBusy(null); }
  }

  async function handleDownloadCsv(sid: string) {
    if (!companyId) return;
    setBusy(sid);
    try {
      const r = await fnIds({ data: { session_id: sid } });
      if (r.ids.length === 0) { toast.info("Nenhum produto foi alterado nesta transformação."); return; }
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const zip = r.ids.length > 1000 ? new JSZip() : null;
      const parts: string[] = [];
      const requestSize = 100;
      for (let start = 0; start < r.ids.length; start += requestSize) {
        const productIds = r.ids.slice(start, start + requestSize);
        const res = await fnExport({
          data: {
            company_id: companyId,
            filter: "selected",
            product_ids: productIds,
            total_override: r.ids.length,
            next_offset_override: start + productIds.length < r.ids.length ? start + productIds.length : null,
            offset: start,
            limit: requestSize,
            include_header: zip ? start % 1000 === 0 : start === 0,
          },
        });
        if (res.csv && res.count > 0) {
          if (zip) {
            const idx = Math.floor(start / 1000) + 1;
            const name = `Transformacao_${timestamp}_${String(idx).padStart(3, "0")}.csv`;
            const cur = zip.file(name);
            if (cur) zip.file(name, (await cur.async("string")) + res.csv);
            else zip.file(name, res.csv);
          } else parts.push(res.csv);
        }
      }
      if (zip) {
        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
        downloadBlob(blob, `Transformacao_${timestamp}.zip`);
      } else {
        downloadBlob(new Blob(parts, { type: "text/csv;charset=utf-8" }), `Transformacao_${timestamp}.csv`);
      }
      toast.success(`CSV com ${r.ids.length.toLocaleString("pt-BR")} produto(s) gerado.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar CSV.");
    } finally { setBusy(null); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Wand2 className="h-5 w-5" /> Transformação Assistida</CardTitle>
        <CardDescription>
          Inicie uma sessão, aplique alterações nos produtos e depois filtre/exporte apenas o que foi modificado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {active ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
            <div className="text-sm">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-600">Em andamento</Badge>
                <span className="font-medium">{active.name}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Iniciada em {new Date(active.started_at).toLocaleString("pt-BR")}
              </div>
            </div>
            <Button size="sm" disabled={busy === active.id} onClick={() => handleFinish(active.id)}>
              {busy === active.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
              Finalizar transformação
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              placeholder="Nome (opcional) — ex: Ajuste de preços 07/2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="sm:max-w-md"
            />
            <Button disabled={!companyId || busy === "start"} onClick={handleStart}>
              {busy === "start" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Iniciar transformação assistida
            </Button>
          </div>
        )}

        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">Início</th>
                <th className="px-3 py-2">Fim</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {sessions.isLoading && (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Carregando…</td></tr>
              )}
              {sessions.data?.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                  Nenhuma transformação registrada ainda.
                </td></tr>
              )}
              {sessions.data?.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2 text-xs">{new Date(s.started_at).toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2 text-xs">
                    {s.finished_at ? new Date(s.finished_at).toLocaleString("pt-BR") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {s.status === "active" && <Badge className="bg-emerald-600">Ativa</Badge>}
                    {s.status === "finished" && <Badge variant="secondary">Finalizada</Badge>}
                    {s.status === "cancelled" && <Badge variant="outline">Cancelada</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => setChangesSid(s.id)}>
                        <Eye className="mr-1 h-3.5 w-3.5" /> Ver alterações
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => handleSelect(s.id)}>
                        {busy === s.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <MousePointerClick className="mr-1 h-3.5 w-3.5" />}
                        Marcar produtos
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => handleDownloadCsv(s.id)}>
                        <Download className="mr-1 h-3.5 w-3.5" /> CSV
                      </Button>
                      {s.status === "active" && (
                        <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => handleFinish(s.id)}>
                          <Square className="mr-1 h-3.5 w-3.5" /> Finalizar
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={busy === s.id} onClick={() => handleDelete(s.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Dialog open={!!changesSid} onOpenChange={(o) => !o && setChangesSid(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" /> Produtos alterados nesta transformação
              </DialogTitle>
              <DialogDescription>
                {changes.data
                  ? `${changes.data.length.toLocaleString("pt-BR")} produto(s) tiveram alguma alteração dentro da janela desta sessão.`
                  : "Carregando..."}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[65vh] overflow-auto border rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr className="text-left">
                    <th className="p-2">SKU</th>
                    <th className="p-2">Produto</th>
                    <th className="p-2 text-right">Preço</th>
                    <th className="p-2 text-right">Estoque</th>
                    <th className="p-2">Situação</th>
                    <th className="p-2">Alterado em</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.isLoading ? (
                    <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando...
                    </td></tr>
                  ) : (changes.data ?? []).length === 0 ? (
                    <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">
                      Nenhum produto foi alterado nesta janela.
                    </td></tr>
                  ) : (
                    (changes.data ?? []).map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="p-2 font-mono">{p.codigo ?? "—"}</td>
                        <td className="p-2 max-w-[320px] truncate">{p.nome ?? "—"}</td>
                        <td className="p-2 text-right font-mono">{p.preco != null ? Number(p.preco).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</td>
                        <td className="p-2 text-right font-mono">{p.estoque != null ? Number(p.estoque).toLocaleString("pt-BR") : "—"}</td>
                        <td className="p-2">{p.situacao ?? "—"}</td>
                        <td className="p-2 whitespace-nowrap">{new Date(p.updated_at).toLocaleString("pt-BR")}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
