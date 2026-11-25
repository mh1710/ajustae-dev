import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { listMyCompanies } from "@/lib/companies.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import { exportProducts, exportMultistorePage } from "@/lib/exports.functions";
import { listBlingChannels } from "@/lib/bling-stores.functions";
import { buildMultistoreCsv, multistoreLines } from "@/lib/multistore-export";
import { useAccess } from "@/hooks/use-access";


export const Route = createFileRoute("/_authenticated/exportacoes")({
  head: () => ({ meta: [{"title": "Exportações | Ajusta-Ê"}, {"name": "description", "content": "Exporte os dados do catálogo para os canais de venda."}, {"property": "og:title", "content": "Exportações | Ajusta-Ê"}, {"property": "og:description", "content": "Exporte os dados do catálogo para os canais de venda."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }), component: ExportPage });

function ExportPage() {
  const fetchCompanies = useServerFn(listMyCompanies);
  const fnExport = useServerFn(exportProducts);

  const companies = useQuery({ queryKey: ["companies"], queryFn: () => fetchCompanies() });
  const [companyId, setCompanyId] = useSelectedCompany();
  useEffect(() => { if (!companyId && companies.data?.[0]) setCompanyId(companies.data[0].id); }, [companies.data, companyId]);

  const [filter, setFilter] = useState<"all" | "with_errors" | "without_errors" | "dirty">("all");
  const [splitMode, setSplitMode] = useState<"single" | "1000">("single");
  const [busy, setBusy] = useState(false);
  const { access } = useAccess();

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function handleExport() {
    if (!companyId) return;
    if (!access.can_download_sheets) {
      toast.error("Seu usuário não tem permissão para baixar planilhas.");
      return;
    }
    setBusy(true);

    setProgress({ done: 0, total: 0 });
    try {
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const files: { name: string; content: string }[] = [];
      const parts: string[] = []; // p/ modo "single"
      let bucketParts: string[] = []; // acumulador p/ modo "1000"
      let bucketCount = 0;
      let offset = 0;
      let total = 0;
      let fileIdx = 0;
      let totalCount = 0;
      const flushBucket = () => {
        if (bucketCount === 0) return;
        fileIdx++;
        files.push({
          name: `Produtos_${timestamp}_${String(fileIdx).padStart(3, "0")}.csv`,
          content: bucketParts.join(""),
        });
        bucketParts = [];
        bucketCount = 0;
      };
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const includeHeader = splitMode === "1000" ? bucketCount === 0 : offset === 0;
        const r = await fnExport({
          data: {
            company_id: companyId,
            filter,
            product_ids: [],
            offset,
            limit: 500,
            include_header: includeHeader,
          },
        });
        if (r.total > total) total = r.total;
        totalCount += r.count;
        setProgress({ done: totalCount, total });
        if (r.csv && r.count > 0) {
          if (splitMode === "single") {
            parts.push(r.csv);
          } else {
            bucketParts.push(r.csv);
            bucketCount += r.count;
            if (bucketCount >= 1000) flushBucket();
          }
        }
        if (r.next_offset == null) break;
        offset = r.next_offset;
      }
      if (splitMode === "1000") flushBucket();


      if (totalCount === 0) {
        toast.info("Nenhum produto encontrado para exportar.");
        return;
      }

      if (splitMode === "single") {
        downloadBlob(new Blob(parts, { type: "text/csv;charset=utf-8" }), `Produtos_Bling_${timestamp}.csv`);
        toast.success(`Exportado ${totalCount.toLocaleString("pt-BR")} produto(s) em 1 arquivo.`);
      } else if (files.length === 1) {
        downloadBlob(new Blob([files[0].content], { type: "text/csv;charset=utf-8" }), files[0].name);
        toast.success(`Exportado ${totalCount.toLocaleString("pt-BR")} produto(s) em 1 arquivo.`);
      } else {
        const zip = new JSZip();
        for (const f of files) zip.file(f.name, f.content);
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, `Produtos_Bling_${timestamp}.zip`);
        toast.success(`Exportado ${totalCount.toLocaleString("pt-BR")} produto(s) em ${files.length} arquivos (ZIP).`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao exportar.");
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(null), 1000);
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Exportações</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gera CSVs no layout do Bling, incluindo o ID do produto no Bling como primeira coluna.
          </p>
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
          <CardTitle>Exportar produtos</CardTitle>
          <CardDescription>Escolha o filtro, o modo de divisão e baixe.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-full md:w-96"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os produtos</SelectItem>
              <SelectItem value="with_errors">Somente com erros de auditoria</SelectItem>
              <SelectItem value="without_errors">Somente aprovados (sem erros)</SelectItem>
              <SelectItem value="dirty">Somente alterados desde a última importação</SelectItem>
            </SelectContent>
          </Select>
          <Select value={splitMode} onValueChange={(v) => setSplitMode(v as "single" | "1000")}>
            <SelectTrigger className="w-full md:w-96"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="single">Planilha única (todos os produtos em 1 arquivo)</SelectItem>
              <SelectItem value="1000">Dividir a cada 1000 produtos (ZIP)</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleExport} disabled={!companyId || busy || !access.can_download_sheets}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {busy ? "Gerando..." : "Baixar"}
          </Button>
          {!access.can_download_sheets && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              Seu usuário não tem permissão para baixar planilhas. Peça a liberação a um administrador.
            </div>
          )}

          {progress && (
            <div className="text-sm text-muted-foreground">
              {progress.done.toLocaleString("pt-BR")}
              {progress.total > 0 ? ` de ${progress.total.toLocaleString("pt-BR")}` : ""} produto(s) processado(s)…
            </div>
          )}
        </CardContent>
      </Card>

      {companyId && <MultistoreExportCard companyId={companyId} canDownload={access.can_download_sheets} />}
    </div>
  );
}

function MultistoreExportCard({ companyId, canDownload }: { companyId: string; canDownload: boolean }) {
  const fetchChannels = useServerFn(listBlingChannels);
  const fnPage = useServerFn(exportMultistorePage);
  const stores = useQuery({
    queryKey: ["bling-channels", companyId],
    queryFn: () => fetchChannels({ data: { company_id: companyId } }),
  });
  const [storeId, setStoreId] = useState("");
  const [scope, setScope] = useState<"linked" | "all">("linked");
  const [splitMode, setSplitMode] = useState<"single" | "1000">("single");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => { setStoreId(""); }, [companyId]);

  async function handleExport() {
    if (!storeId) return;
    if (!canDownload) {
      toast.error("Seu usuário não tem permissão para baixar planilhas.");
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: 0 });
    try {
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const lines: string[] = [];
      let storeName = "";
      let offset = 0;
      let total = 0;
      let fallback = 0;
      let noPrice = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // Partes de 500 mantêm cada consulta bem abaixo do limite de tempo do
        // banco; os arquivos continuam sendo divididos a cada 1000 produtos.
        const req = { data: { company_id: companyId, bling_store_id: storeId, scope, offset, limit: 500 } };
        const r = await fnPage(req).catch(() => fnPage(req));
        storeName = r.store_name;
        total = r.total;
        lines.push(...multistoreLines(r.rows, r.store_id, r.store_name));
        for (const row of r.rows) {
          if (row.fonte !== "regra") {
            if (row.preco == null) noPrice++;
            else fallback++;
          }
        }
        setProgress({ done: lines.length, total });
        if (r.next_offset == null) break;
        offset = r.next_offset;
      }
      if (lines.length === 0) {
        toast.info("Nenhum produto encontrado nesta multiloja.");
        return;
      }
      const slug = storeName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || storeId;
      const base = `vinculo_produtos_multiloja_${slug}_${timestamp}`;
      if (splitMode === "single" || lines.length <= 1000) {
        downloadBlob(new Blob([buildMultistoreCsv(lines)], { type: "text/csv;charset=utf-8" }), `${base}.csv`);
      } else {
        const zip = new JSZip();
        for (let i = 0; i < lines.length; i += 1000) {
          zip.file(`${base}_${String(i / 1000 + 1).padStart(3, "0")}.csv`, buildMultistoreCsv(lines.slice(i, i + 1000)));
        }
        downloadBlob(await zip.generateAsync({ type: "blob" }), `${base}.zip`);
      }
      const parts = Math.ceil(lines.length / 1000);
      toast.success(
        `Exportado ${lines.length.toLocaleString("pt-BR")} produto(s)` +
          (splitMode === "1000" && parts > 1 ? ` em ${parts} arquivos (ZIP).` : " em 1 arquivo."),
        {
          description: fallback || noPrice
            ? `${fallback.toLocaleString("pt-BR")} sem custo de fornecedor usaram o preço atual${noPrice ? `; ${noPrice.toLocaleString("pt-BR")} ficaram sem preço` : ""}.`
            : undefined,
        },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao exportar.");
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(null), 1000);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vínculo multiloja</CardTitle>
        <CardDescription>
          Planilha para importar no Bling com os produtos da multiloja, preço pela política de precificação
          (taxa do marketplace da loja) e preço promocional 5% menor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={storeId} onValueChange={setStoreId} disabled={stores.isLoading}>
          <SelectTrigger className="w-full md:w-96">
            <SelectValue placeholder={stores.isLoading ? "Carregando multilojas..." : "Escolha a multiloja..."} />
          </SelectTrigger>
          <SelectContent>
            {(stores.data ?? []).map((s: any) => (
              <SelectItem key={s.bling_store_id} value={String(s.bling_store_id)}>
                {s.descricao || s.bling_store_id}{s.tipo ? ` (${s.tipo})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {stores.data && stores.data.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma multiloja sincronizada nesta empresa. Sincronize em Multilojas.</p>
        )}
        <Select value={scope} onValueChange={(v) => setScope(v as "linked" | "all")}>
          <SelectTrigger className="w-full md:w-96"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="linked">Somente produtos já vinculados a esta loja</SelectItem>
            <SelectItem value="all">Todos os produtos da empresa</SelectItem>
          </SelectContent>
        </Select>
        <Select value={splitMode} onValueChange={(v) => setSplitMode(v as "single" | "1000")}>
          <SelectTrigger className="w-full md:w-96"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="single">Planilha completa (1 arquivo)</SelectItem>
            <SelectItem value="1000">Dividir a cada 1000 produtos (ZIP)</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={handleExport} disabled={!storeId || busy || !canDownload}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          {busy ? "Gerando..." : "Baixar planilha multiloja"}
        </Button>
        {progress && (
          <div className="text-sm text-muted-foreground">
            {progress.done.toLocaleString("pt-BR")}
            {progress.total > 0 ? ` de ${progress.total.toLocaleString("pt-BR")}` : ""} produto(s) processado(s)…
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
