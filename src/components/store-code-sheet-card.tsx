import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { listDistinctStores } from "@/lib/bling-stores.functions";
import { applyStoreCodeSheet, previewStoreCodeSheet } from "@/lib/bling-push.functions";

type Row = { sku: string; bling_store_id: string; codigo: string };

type Preview = {
  total: number;
  ok: number;
  ja_atualizado: number;
  sku_nao_encontrado: number;
  loja_nao_vinculada: number;
  sem_bling_id: number;
  sem_preco: number;
  dados_invalidos: number;
  amostra: Array<{
    linha: number;
    sku: string;
    bling_store_id: string;
    store_name: string | null;
    codigo_atual: string | null;
    codigo_novo: string;
    status: string;
  }>;
};

const STATUS_LABEL: Record<string, string> = {
  ok: "será atualizado",
  ja_atualizado: "já está assim",
  sku_nao_encontrado: "SKU não encontrado",
  loja_nao_vinculada: "produto não vinculado nessa loja",
  sem_bling_id: "produto sem ID no Bling",
  sem_preco: "sem preço na loja",
  dados_invalidos: "linha incompleta",
};

function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of Object.keys(obj)) {
    const norm = k
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    if (keys.includes(norm)) {
      const v = obj[k];
      if (v === null || v === undefined) return "";
      return String(v).trim();
    }
  }
  return "";
}

export function StoreCodeSheetCard({ companyId }: { companyId: string | undefined }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [updateMode, setUpdateMode] = useState<"new" | "all">("new");
  const [busy, setBusy] = useState<"modelo" | "ler" | "aplicar" | null>(null);

  const doPreview = useServerFn(previewStoreCodeSheet);
  const doApply = useServerFn(applyStoreCodeSheet);

  const stores = useQuery({
    queryKey: ["distinct-stores", companyId],
    enabled: !!companyId,
    queryFn: () => listDistinctStores({ data: { company_id: companyId! } }),
  });

  function downloadModel() {
    setBusy("modelo");
    try {
      const wb = XLSX.utils.book_new();
      const modelo = XLSX.utils.aoa_to_sheet([
        ["SKU", "ID da Loja", "Novo ID na Loja"],
        ["EXEMPLO123", (stores.data?.[0]?.bling_store_id ?? "000000"), "COD-ANUNCIO-1"],
      ]);
      modelo["!cols"] = [{ wch: 20 }, { wch: 16 }, { wch: 28 }];
      XLSX.utils.book_append_sheet(wb, modelo, "Modelo");

      const lojas = XLSX.utils.aoa_to_sheet([
        ["ID da Loja", "Nome da loja", "Canal"],
        ...(stores.data ?? []).map((s: any) => [
          s.bling_store_id,
          s.store_name ?? "",
          s.store_type ?? "",
        ]),
      ]);
      lojas["!cols"] = [{ wch: 16 }, { wch: 40 }, { wch: 24 }];
      XLSX.utils.book_append_sheet(wb, lojas, "Lojas");

      XLSX.writeFile(wb, "modelo-id-na-loja.xlsx");
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File) {
    if (!companyId) return;
    setBusy("ler");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName =
        wb.SheetNames.find((n) => n.trim().toLowerCase() === "modelo") ?? wb.SheetNames[0];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName!]!, {
        defval: "",
      });
      const parsed: Row[] = json
        .map((r) => ({
          sku: pick(r, ["sku", "codigo", "codigo do produto"]),
          bling_store_id: pick(r, ["id da loja", "id loja", "loja", "bling_store_id"]),
          codigo: pick(r, ["novo id na loja", "id na loja", "codigo na loja", "novo codigo"]),
        }))
        .filter((r) => r.sku || r.bling_store_id || r.codigo);

      if (parsed.length === 0) {
        toast.error("A planilha não tem linhas preenchidas.");
        return;
      }
      if (parsed.length > 20000) {
        toast.error("Limite de 20.000 linhas por planilha.");
        return;
      }
      setRows(parsed);
      const res = await doPreview({ data: { company_id: companyId, rows: parsed } });
      setUpdateMode("new");
      setPreview(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler a planilha.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function confirm() {
    if (!companyId || rows.length === 0) return;
    setBusy("aplicar");
    try {
      const r = await doApply({
        data: { company_id: companyId, rows, force_existing: updateMode === "all" },
      });
      toast.success(
        `${r.enqueued.toLocaleString("pt-BR")} anúncio(s) enfileirados para atualização no Bling.` +
          (r.existing_enqueued
            ? ` ${r.existing_enqueued.toLocaleString("pt-BR")} já constavam como corretos na base.`
            : "") +
          (r.skipped ? ` ${r.skipped.toLocaleString("pt-BR")} linha(s) ignorada(s).` : ""),
      );
      setPreview(null);
      setRows([]);
      qc.invalidateQueries({ queryKey: ["bling-push-progress"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao aplicar a planilha.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-4">
      <div className="font-medium">Atualizar ID na loja por planilha</div>
      <p className="text-xs text-muted-foreground">
        Baixe o modelo, preencha <strong>SKU</strong>, <strong>ID da Loja</strong> e{" "}
        <strong>Novo ID na Loja</strong> e importe. Vamos conferir quantos SKUs casaram e pedir sua
        confirmação antes de gravar aqui e enviar ao Bling. Este é o único caminho que altera o ID na
        loja.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={downloadModel} disabled={!companyId || busy === "modelo"}>
          <Download className="mr-2 h-4 w-4" />
          Baixar planilha modelo
        </Button>
        <Button onClick={() => fileRef.current?.click()} disabled={!companyId || !!busy}>
          {busy === "ler" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Importar planilha preenchida
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Conferir planilha</DialogTitle>
            <DialogDescription>
              {preview
                ? `${preview.total.toLocaleString("pt-BR")} linha(s) lidas · ${preview.ok.toLocaleString("pt-BR")} serão atualizadas.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {preview ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge>{preview.ok} serão atualizadas</Badge>
                {preview.ja_atualizado > 0 && (
                  <Badge variant="secondary">{preview.ja_atualizado} já estão assim</Badge>
                )}
                {preview.sku_nao_encontrado > 0 && (
                  <Badge variant="destructive">{preview.sku_nao_encontrado} SKU não encontrado</Badge>
                )}
                {preview.loja_nao_vinculada > 0 && (
                  <Badge variant="destructive">
                    {preview.loja_nao_vinculada} sem vínculo nessa loja
                  </Badge>
                )}
                {preview.sem_bling_id > 0 && (
                  <Badge variant="destructive">{preview.sem_bling_id} sem ID no Bling</Badge>
                )}
                {preview.sem_preco > 0 && (
                  <Badge variant="destructive">{preview.sem_preco} sem preço</Badge>
                )}
                {preview.dados_invalidos > 0 && (
                  <Badge variant="destructive">{preview.dados_invalidos} linhas incompletas</Badge>
                )}
              </div>

              {preview.ja_atualizado > 0 && (
                <RadioGroup
                  value={updateMode}
                  onValueChange={(value) => setUpdateMode(value as "new" | "all")}
                  className="rounded-md border p-3"
                >
                  <label className="flex cursor-pointer items-start gap-3">
                    <RadioGroupItem value="new" className="mt-0.5" />
                    <span>
                      <span className="block font-medium">Atualizar apenas os novos</span>
                      <span className="text-xs text-muted-foreground">
                        Envia {preview.ok.toLocaleString("pt-BR")} anúncio(s) que ainda estão diferentes.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3">
                    <RadioGroupItem value="all" className="mt-0.5" />
                    <span>
                      <span className="block font-medium">Atualizar todos mesmo assim</span>
                      <span className="text-xs text-muted-foreground">
                        Reenvia também {preview.ja_atualizado.toLocaleString("pt-BR")} anúncio(s) que já
                        constam como corretos na base.
                      </span>
                    </span>
                  </label>
                </RadioGroup>
              )}

              <div className="max-h-[320px] overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="p-2 text-left">Linha</th>
                      <th className="p-2 text-left">SKU</th>
                      <th className="p-2 text-left">Loja</th>
                      <th className="p-2 text-left">ID na loja atual</th>
                      <th className="p-2 text-left">Novo</th>
                      <th className="p-2 text-left">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.amostra.map((r) => (
                      <tr key={`${r.linha}-${r.sku}-${r.bling_store_id}`} className="border-t">
                        <td className="p-2">{r.linha}</td>
                        <td className="p-2">{r.sku}</td>
                        <td className="p-2">{r.store_name ?? r.bling_store_id}</td>
                        <td className="p-2">{r.codigo_atual ?? "—"}</td>
                        <td className="p-2">{r.codigo_novo}</td>
                        <td className="p-2">
                          {r.status === "ok" ? (
                            <Badge>{STATUS_LABEL[r.status]}</Badge>
                          ) : (
                            <Badge variant={r.status === "ja_atualizado" ? "secondary" : "destructive"}>
                              {STATUS_LABEL[r.status] ?? r.status}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.total > preview.amostra.length && (
                <p className="text-xs text-muted-foreground">
                  Mostrando as primeiras {preview.amostra.length} linhas.
                </p>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)} disabled={busy === "aplicar"}>
              Cancelar
            </Button>
            <Button
              onClick={() => void confirm()}
              disabled={
                !preview ||
                (preview.ok === 0 && (updateMode !== "all" || preview.ja_atualizado === 0)) ||
                busy === "aplicar"
              }
            >
              {busy === "aplicar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar e atualizar{" "}
              {preview
                ? preview.ok + (updateMode === "all" ? preview.ja_atualizado : 0)
                : 0}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
