import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Upload, Trash2, Radio } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  importAnatelBatch,
  listAnatelProducts,
  clearAnatelProducts,
  getAnatelStats,
} from "@/lib/anatel.functions";
import { PageNumbers } from "@/components/page-numbers";
import { AnatelOfficialCard } from "@/components/anatel-official-card";


export const Route = createFileRoute("/_authenticated/anatel")({
  head: () => ({ meta: [{"title": "Anatel | Ajusta-Ê"}, {"name": "description", "content": "Consulte homologações e códigos Anatel dos produtos."}, {"property": "og:title", "content": "Anatel | Ajusta-Ê"}, {"property": "og:description", "content": "Consulte homologações e códigos Anatel dos produtos."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }), component: AnatelPage });

const HEADER_ALIASES: Record<string, string> = {
  "código do produto": "codigo",
  "codigo do produto": "codigo",
  "código": "codigo",
  "codigo": "codigo",
  "título": "titulo",
  "titulo": "titulo",
  "descrição comercial": "descricao_comercial",
  "descricao comercial": "descricao_comercial",
  "marca": "marca",
  "ean": "ean",
  "ncm": "ncm",
  "teste": "codigo_anatel",
  "código anatel": "codigo_anatel",
  "codigo anatel": "codigo_anatel",
  "anatel": "codigo_anatel",
};

type Row = {
  codigo: string;
  titulo?: string | null;
  descricao_comercial?: string | null;
  marca?: string | null;
  ean?: string | null;
  ncm?: string | null;
  codigo_anatel?: string | null;
};

function normalizeHeader(h: unknown): string | null {
  if (h == null) return null;
  const key = String(h).trim().toLowerCase();
  return HEADER_ALIASES[key] ?? null;
}

async function parseXlsx(file: File): Promise<Row[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const rows: Row[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: false });
    if (aoa.length < 2) continue;
    const headerRow = aoa[0] as unknown[];
    const map: Record<number, keyof Row> = {};
    headerRow.forEach((h, idx) => {
      const k = normalizeHeader(h);
      if (k) map[idx] = k as keyof Row;
    });
    if (map[Object.keys(map).findIndex(() => true) as unknown as number] == null && Object.keys(map).length === 0) continue;
    for (let i = 1; i < aoa.length; i++) {
      const r = aoa[i] as unknown[];
      if (!r || r.every((v) => v == null || String(v).trim() === "")) continue;
      const out: Row = { codigo: "" };
      for (const [idxStr, key] of Object.entries(map)) {
        const v = r[Number(idxStr)];
        (out as any)[key] = v == null ? null : String(v).trim();
      }
      if (!out.codigo) continue;
      rows.push(out);
    }
  }
  return rows;
}

function AnatelPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listAnatelProducts);
  const fetchStats = useServerFn(getAnatelStats);
  const doImport = useServerFn(importAnatelBatch);
  const doClear = useServerFn(clearAnatelProducts);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const stats = useQuery({
    queryKey: ["anatel-stats"],
    queryFn: () => fetchStats(),
  });

  const list = useQuery({
    queryKey: ["anatel-list", search, page],
    queryFn: () => fetchList({ data: { search, page, page_size: PAGE_SIZE } }),
  });

  const [importState, setImportState] = useState<{
    running: boolean;
    total: number;
    processed: number;
    upserted: number;
    fileName: string;
  } | null>(null);
  const cancelRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    cancelRef.current = false;
    const arr = Array.from(files);
    let totalRows = 0;
    const parsed: { name: string; rows: Row[] }[] = [];
    for (const f of arr) {
      try {
        const rows = await parseXlsx(f);
        parsed.push({ name: f.name, rows });
        totalRows += rows.length;
      } catch (e) {
        toast.error(`Falha ao ler ${f.name}: ${e instanceof Error ? e.message : "erro"}`);
      }
    }
    if (totalRows === 0) {
      toast.error("Nenhuma linha válida encontrada nos arquivos.");
      return;
    }
    setImportState({ running: true, total: totalRows, processed: 0, upserted: 0, fileName: parsed[0].name });
    let processed = 0;
    let upserted = 0;
    const BATCH = 300;
    try {
      for (const p of parsed) {
        setImportState((s) => (s ? { ...s, fileName: p.name } : s));
        for (let i = 0; i < p.rows.length; i += BATCH) {
          if (cancelRef.current) throw new Error("Cancelado pelo usuário.");
          const chunk = p.rows.slice(i, i + BATCH);
          const res = await doImport({ data: { rows: chunk } });
          processed += chunk.length;
          upserted += res.upserted;
          setImportState((s) => (s ? { ...s, processed, upserted } : s));
        }
      }
      toast.success(`Importação concluída: ${upserted} registros gravados.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na importação");
    } finally {
      setImportState(null);
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["anatel-stats"] });
      qc.invalidateQueries({ queryKey: ["anatel-list"] });
    }
  }

  async function handleClear() {
    try {
      const res = await doClear();
      toast.success(`${res.deleted} registros removidos.`);
      qc.invalidateQueries({ queryKey: ["anatel-stats"] });
      qc.invalidateQueries({ queryKey: ["anatel-list"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao limpar");
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Radio className="h-6 w-6" /> Base ANATEL
          </h1>
          <p className="text-sm text-muted-foreground">
            Base global de produtos ANATEL — compartilhada entre todas as empresas.
          </p>
        </div>
      </div>

      <AnatelOfficialCard />

      <Card>
        <CardHeader>
          <CardTitle>Importação de planilhas</CardTitle>
          <CardDescription>
            Aceita XLSX com as colunas: Código do Produto, Título, Descrição Comercial, Marca, EAN, NCM e TESTE (código ANATEL).
            Colunas ausentes ficam preenchidas com "COLUNA NAO EXISTENTE NA BASE DE DADOS ANATEL IMPORTADA".
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button disabled={!!importState} onClick={() => fileRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Selecionar planilhas
          </Button>
          <div className="text-sm text-muted-foreground">
            Total na base: <strong>{stats.data?.total ?? 0}</strong>
            {stats.data?.last_import_at ? ` · Última importação: ${new Date(stats.data.last_import_at).toLocaleString("pt-BR")}` : ""}
          </div>
          <div className="ml-auto">
            <Button variant="destructive" disabled={(stats.data?.total ?? 0) === 0 || !!importState} onClick={() => setConfirmClear(true)}>
              <Trash2 className="mr-2 h-4 w-4" /> Limpar base
            </Button>
          </div>

        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Produtos ANATEL</CardTitle>
            <CardDescription>Busca por código, título, marca, EAN ou código ANATEL.</CardDescription>
          </div>
          <div className="w-72">
            <Input placeholder="Buscar..." value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2">Código</th>
                  <th className="p-2">Título</th>
                  <th className="p-2">Marca</th>
                  <th className="p-2">EAN</th>
                  <th className="p-2">NCM</th>
                  <th className="p-2">Código ANATEL</th>
                </tr>
              </thead>
              <tbody>
                {list.isLoading ? (
                  <tr><td colSpan={6} className="p-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
                ) : (list.data?.rows ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Nenhum produto encontrado.</td></tr>
                ) : (list.data?.rows ?? []).map((r: any) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 font-mono text-xs">{r.codigo}</td>
                    <td className="p-2 max-w-md truncate" title={r.titulo}>{r.titulo}</td>
                    <td className="p-2">{r.marca}</td>
                    <td className="p-2 font-mono text-xs">{r.ean}</td>
                    <td className="p-2 font-mono text-xs">{r.ncm}</td>
                    <td className="p-2 font-mono text-xs">{r.codigo_anatel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {list.data ? `Mostrando ${(list.data.rows ?? []).length} de ${list.data.total}` : ""}
            </div>
            <PageNumbers page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onChange={setPage} />
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!importState} onOpenChange={() => { /* blocking */ }}>
        <DialogContent className="sm:max-w-md" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Importando base ANATEL</DialogTitle>
            <DialogDescription>
              Não feche esta janela. Arquivo atual: <strong>{importState?.fileName}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Progress value={importState ? Math.round((importState.processed / Math.max(1, importState.total)) * 100) : 0} />
            <div className="text-sm">
              Processados: <strong>{importState?.processed ?? 0}</strong> / {importState?.total ?? 0}
              <br />
              Gravados no banco: <strong>{importState?.upserted ?? 0}</strong>
            </div>
            <Button variant="destructive" size="sm" onClick={() => { cancelRef.current = true; }}>
              Cancelar importação
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar toda a base ANATEL desta empresa?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmClear(false); handleClear(); }}>Limpar tudo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}