import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, RefreshCw, Truck, ExternalLink, Download, Percent, Tags, Plus, Trash2 } from "lucide-react";
import { listPrefixMap, upsertPrefixMap, deletePrefixMap } from "@/lib/prefix-map.functions";
import {
  listSuppliers,
  updateSupplier,
  listSupplierProducts,
  getSupplierGapStats,
  listSupplierGapProducts,
  exportSupplierProducts,
} from "@/lib/suppliers.functions";
import { listMyCompanies } from "@/lib/companies.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import { PageNumbers } from "@/components/page-numbers";
import { SupplierFeesModal, type SupplierFees } from "@/components/supplier-fees-modal";
import { MercadoLivreTab } from "@/components/mercadolivre-tab";
import { MlProspectTab } from "@/components/ml-prospect-tab";
import { SupplierCatalogImportTab } from "@/components/supplier-catalog-import-tab";
import { BlingSuppliersTab } from "@/components/bling-suppliers-tab";
import { SupplierSheetImport } from "@/components/supplier-sheet-import";


export const Route = createFileRoute("/_authenticated/fornecedores")({
  head: () => ({
    meta: [
      { title: "Fornecedores e Garimpo | Ajustta-Ê" },
      {
        name: "description",
        content: "Fornecedores, produtos alternativos e garimpo no Mercado Livre.",
      },
      { property: "og:title", content: "Fornecedores e Garimpo | Ajustta-Ê" },
      {
        property: "og:description",
        content: "Fornecedores, produtos alternativos e garimpo no Mercado Livre.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FornecedoresPage,
});

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return "—"; }
}

type ViewKind = "all" | "missing" | "inactive";

function toCsv(rows: any[]): string {
  if (rows.length === 0) return "";
  const cols = [
    "codigo", "titulo", "marca", "categoria", "codigobarras", "ncm",
    "qt_estoque", "preco_pr", "peso", "altura", "largura", "comprimento", "tempo_garantia", "foto",
  ];
  const header = cols.join(";");
  const lines = rows.map((r) => {
    const precos = (r.precos ?? {}) as Record<string, number | null>;
    const preco = precos.PR ?? precos.base ?? precos.dropshipping ?? precos.crossdocking ?? null;
    const vals: (string | number | null)[] = [
      r.codigo, r.titulo, r.marca, r.categoria, r.codigobarras, r.ncm,
      r.qt_estoque, preco, r.peso, r.altura, r.largura, r.comprimento, r.tempo_garantia, r.foto,
    ];
    return vals
      .map((v) => {
        if (v === null || v === undefined) return "";
        const s = String(v).replace(/"/g, '""');
        return /[;"\n\r]/.test(s) ? `"${s}"` : s;
      })
      .join(";");
  });
  return "\uFEFF" + [header, ...lines].join("\n");
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

function FornecedoresPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listSuppliers);
  const doUpdate = useServerFn(updateSupplier);
  const doExport = useServerFn(exportSupplierProducts);
  const fetchProducts = useServerFn(listSupplierProducts);
  const fetchGapStats = useServerFn(getSupplierGapStats);
  const fetchGap = useServerFn(listSupplierGapProducts);
  const fetchCompanies = useServerFn(listMyCompanies);

  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => fetchList() });
  const companies = useQuery({ queryKey: ["companies"], queryFn: () => fetchCompanies() });

  const [companyId, setCompanyId] = useSelectedCompany();
  useEffect(() => {
    if (!companyId && companies.data && companies.data.length > 0) setCompanyId(companies.data[0].id);
  }, [companies.data, companyId]);

  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewKind>("all");
  const [topTab, setTopTab] = useState<"suppliers" | "ml" | "garimpo" | "bling" | "novos">("suppliers");

  // Retorno da autorização do Mercado Livre
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ml = params.get("ml");
    if (!ml) return;
    const msg = params.get("msg") ?? "";
    if (ml === "ok") toast.success(msg || "Mercado Livre conectado.");
    else toast.error(msg || "Falha ao conectar o Mercado Livre.");
    setTopTab("ml");
    window.history.replaceState({}, "", window.location.pathname);
  }, []);



  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [feesFor, setFeesFor] = useState<SupplierFees | null>(null);
  const PAGE_SIZE = 50;

  useEffect(() => {
    if (!selectedId && suppliers.data && suppliers.data.length > 0) setSelectedId(suppliers.data[0].id);
  }, [suppliers.data, selectedId]);
  useEffect(() => { setPage(1); }, [selectedId, search, view, companyId]);

  const selected = useMemo(
    () => suppliers.data?.find((s) => s.id === selectedId) ?? null,
    [suppliers.data, selectedId],
  );

  const productsAll = useQuery({
    queryKey: ["supplier-products", selectedId, search, page],
    queryFn: () => fetchProducts({ data: { fornecedor_id: selectedId!, search: search || undefined, page, page_size: PAGE_SIZE } }),
    enabled: !!selectedId && view === "all",
  });

  const productsGap = useQuery({
    queryKey: ["supplier-gap", selectedId, companyId, view, search, page],
    queryFn: () => fetchGap({ data: { fornecedor_id: selectedId!, company_id: companyId!, kind: view as "missing" | "inactive", search: search || undefined, page, page_size: PAGE_SIZE } }),
    enabled: !!selectedId && !!companyId && view !== "all",
  });

  async function handleUpdate(codigo: string, supplierRowId?: string) {
    setUpdatingId(supplierRowId ?? codigo);
    try {
      const r = await doUpdate({ data: { codigo } });
      if (r.done === false) {
        toast.success(`Leitura em andamento: página ${r.page} de ${r.lastPage} (${r.total} produtos). Continua sozinha a cada minuto.`);
      } else {
        toast.success(`Fornecedor atualizado: ${r.total} produtos.`);
      }
      await qc.invalidateQueries({ queryKey: ["suppliers"] });
      await qc.invalidateQueries({ queryKey: ["supplier-products"] });
      await qc.invalidateQueries({ queryKey: ["supplier-gap"] });
      await qc.invalidateQueries({ queryKey: ["supplier-gap-stats"] });
    } catch (e) {
      toast.error(`Falha na atualização: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setUpdatingId(null); }
  }

  async function handleDownloadAll() {
    if (!selected) return;
    setDownloading(true);
    try {
      const rows = await doExport({ data: { fornecedor_id: selected.id } });
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Produtos");
      const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `fornecedor-${selected.codigo}-produtos.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast.success(`${rows.length} produtos exportados.`);
    } catch (e) {
      toast.error(`Falha no download: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setDownloading(false); }
  }

  async function handleDownload() {
    if (!selectedId || !companyId || view === "all") return;
    setDownloading(true);
    try {
      const r = await fetchGap({ data: { fornecedor_id: selectedId, company_id: companyId, kind: view, all: true } });
      const csv = toCsv(r.rows as any[]);
      const label = view === "missing" ? "faltando" : "inativos";
      downloadCsv(`fornecedor-${r.supplierCodigo}-${label}.csv`, csv);
      toast.success(`${r.rows.length} produtos exportados.`);
    } catch (e) {
      toast.error(`Falha no download: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setDownloading(false); }
  }

  const activeQ = view === "all" ? productsAll : productsGap;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Truck className="h-6 w-6" /> Fornecedores
          </h1>
          <p className="text-sm text-muted-foreground">
            Base global de fornecedores — compartilhada entre todas as empresas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Comparar com empresa:</span>
          <Select value={companyId ?? ""} onValueChange={(v) => setCompanyId(v || undefined)}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Selecionar empresa" /></SelectTrigger>
            <SelectContent>
              {companies.data?.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <Tabs value={topTab} onValueChange={(v) => setTopTab(v as "suppliers" | "ml" | "garimpo" | "bling" | "novos")}>
        <TabsList>
          <TabsTrigger value="suppliers">Fornecedores</TabsTrigger>
          <TabsTrigger value="novos">Novos do fornecedor</TabsTrigger>
          <TabsTrigger value="bling">Fornecedores no Bling</TabsTrigger>
          <TabsTrigger value="ml">Mercado Livre</TabsTrigger>
          <TabsTrigger value="garimpo">Garimpo de produtos</TabsTrigger>
        </TabsList>
      </Tabs>

      {topTab === "bling" && <BlingSuppliersTab companyId={companyId ?? null} />}
      {topTab === "ml" && <MercadoLivreTab companyId={companyId} />}
      {topTab === "garimpo" && <MlProspectTab companyId={companyId ?? null} />}
      {topTab === "novos" && <SupplierCatalogImportTab companyId={companyId ?? null} />}

      <div className={topTab !== "suppliers" ? "hidden" : "space-y-6"}>
      {suppliers.isLoading ? (

        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando fornecedores…</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {suppliers.data?.map((s) => (
            <SupplierCard
              key={s.id}
              supplier={s}
              companyId={companyId}
              selected={selectedId === s.id}
              onSelect={() => setSelectedId(s.id)}
              onUpdate={() => handleUpdate(s.codigo, s.id)}
              onEditFees={() => setFeesFor(s as unknown as SupplierFees)}
              updating={updatingId === s.id}
              fetchGapStats={fetchGapStats}
            />
          ))}
        </div>
      )}

      <SupplierFeesModal
        supplier={feesFor}
        open={!!feesFor}
        onOpenChange={(v) => { if (!v) setFeesFor(null); }}
      />

      <PrefixMapCard />

      {selected && companyId && (
        <SupplierSheetImport
          companyId={companyId}
          supplier={selected}
          suppliers={suppliers.data ?? []}
          onSupplierChange={(id) => setSelectedId(id)}
          onComplete={() => {
            qc.invalidateQueries({ queryKey: ["supplier-gap"] });
            qc.invalidateQueries({ queryKey: ["supplier-products"] });
          }}
        />
      )}

      {selected && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle>Produtos de {selected.nome}</CardTitle>
                <CardDescription>
                  {view === "all" && `${(productsAll.data?.count ?? 0).toLocaleString("pt-BR")} produtos disponíveis.`}
                  {view === "missing" && `${(productsGap.data?.count ?? 0).toLocaleString("pt-BR")} produtos no fornecedor que não existem na empresa.`}
                  {view === "inactive" && `${(productsGap.data?.count ?? 0).toLocaleString("pt-BR")} produtos que existem na empresa mas estão inativos.`}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={selectedId ?? ""} onValueChange={(v) => setSelectedId(v || null)}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.data?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Buscar por título, código ou EAN…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-72"
                />
                {view === "all" && (
                  <Button size="sm" variant="secondary" onClick={handleDownloadAll} disabled={downloading || !selected}>
                    {downloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    Baixar planilha do fornecedor
                  </Button>
                )}
                {view !== "all" && (
                  <Button size="sm" variant="secondary" onClick={handleDownload} disabled={downloading || !companyId}>
                    {downloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    Baixar CSV
                  </Button>
                )}
              </div>
            </div>
            <Tabs value={view} onValueChange={(v) => setView(v as ViewKind)} className="mt-3">
              <TabsList>
                <TabsTrigger value="all">Todos</TabsTrigger>
                <TabsTrigger value="missing" disabled={!companyId}>Faltando na empresa</TabsTrigger>
                <TabsTrigger value="inactive" disabled={!companyId}>Inativos na empresa</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {activeQ.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
            ) : !activeQ.data || (activeQ.data.rows as any[]).length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {view === "all" ? "Nenhum produto. Clique em \"Atualizar fornecedor\" para importar." : "Nenhum produto nesta categoria."}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="px-3 py-2 font-medium">Código</th>
                        <th className="px-3 py-2 font-medium">Título</th>
                        <th className="px-3 py-2 font-medium">Marca</th>
                        <th className="px-3 py-2 font-medium">EAN</th>
                        <th className="px-3 py-2 font-medium text-right">Estoque</th>
                        <th className="px-3 py-2 font-medium text-right">Custo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeQ.data.rows as any[]).map((p) => {
                        const precos = (p.precos as Record<string, number | null> | null) ?? null;
                        const preco = precos?.PR ?? precos?.base ?? precos?.dropshipping ?? precos?.crossdocking ?? null;
                        return (
                          <tr key={p.id} className="border-t">
                            <td className="px-3 py-2 font-mono text-xs">{p.codigo}</td>
                            <td className="px-3 py-2">{p.titulo}</td>
                            <td className="px-3 py-2">{p.marca ?? "—"}</td>
                            <td className="px-3 py-2 font-mono text-xs">{p.codigobarras ?? "—"}</td>
                            <td className="px-3 py-2 text-right">{p.qt_estoque ?? 0}</td>
                            <td className="px-3 py-2 text-right">
                              {preco != null ? preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <PageNumbers page={page} pageSize={PAGE_SIZE} total={activeQ.data.count} onChange={setPage} />
              </div>
            )}
          </CardContent>
        </Card>
      )}
      </div>
    </div>

  );
}

function PrefixMapCard() {
  const qc = useQueryClient();
  const fetchMap = useServerFn(listPrefixMap);
  const doUpsert = useServerFn(upsertPrefixMap);
  const doDelete = useServerFn(deletePrefixMap);
  const q = useQuery({ queryKey: ["prefix-map"], queryFn: () => fetchMap() });
  const [prefix, setPrefix] = useState("");
  const [supplier, setSupplier] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    const p = prefix.trim().toUpperCase();
    if (!p || !supplier) return;
    setSaving(true);
    try {
      await doUpsert({ data: { prefix: p, supplier_codigo: supplier } });
      toast.success(`Prefixo ${p} mapeado. Vale para precificação, auditoria e automações.`);
      setPrefix("");
      await qc.invalidateQueries({ queryKey: ["prefix-map"] });
    } catch (e) {
      toast.error(`Falha ao salvar: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  }

  async function handleDelete(p: string) {
    if (!window.confirm(`Remover o prefixo ${p} do mapa?`)) return;
    try {
      await doDelete({ data: { prefix: p } });
      toast.success(`Prefixo ${p} removido.`);
      await qc.invalidateQueries({ queryKey: ["prefix-map"] });
    } catch (e) {
      toast.error(`Falha ao remover: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const supplierName = (codigo: string) => q.data?.suppliers.find((s) => s.codigo === codigo)?.nome ?? codigo;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Tags className="h-5 w-5" /> Mapa de prefixos de SKU</CardTitle>
        <CardDescription>
          Define de qual fornecedor é cada SKU pelas letras iniciais. Usado pela precificação, auditoria, automações de estoque e envios ao Bling.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando mapa…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm max-w-lg">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Prefixo</th>
                  <th className="px-3 py-2 font-medium">Fornecedor</th>
                  <th className="px-3 py-2 font-medium w-16" />
                </tr>
              </thead>
              <tbody>
                {q.data?.map.map((m) => (
                  <tr key={m.prefix} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{m.prefix}</td>
                    <td className="px-3 py-2">{supplierName(m.supplier_codigo)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="icon" variant="ghost" onClick={() => handleDelete(m.prefix)} title="Remover">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {q.data && q.data.map.length === 0 && (
                  <tr><td colSpan={3} className="px-3 py-4 text-sm text-muted-foreground">Nenhum prefixo mapeado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Prefixo (ex.: BK)"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toUpperCase())}
            className="w-40 font-mono"
          />
          <Select value={supplier} onValueChange={setSupplier}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
            <SelectContent>
              {q.data?.suppliers.map((s) => (
                <SelectItem key={s.codigo} value={s.codigo}>{s.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={handleAdd} disabled={saving || !prefix.trim() || !supplier}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Adicionar prefixo
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SupplierCard({
  supplier: s,
  companyId,
  selected,
  onSelect,
  onUpdate,
  onEditFees,
  updating,
  fetchGapStats,
}: {
  supplier: any;
  companyId: string | undefined;
  selected: boolean;
  onSelect: () => void;
  onUpdate: () => void;
  onEditFees: () => void;
  updating: boolean;
  fetchGapStats: (args: { data: { fornecedor_id: string; company_id: string } }) => Promise<{ total: number; missing: number; inactive: number }>;
}) {
  const stats = useQuery({
    queryKey: ["supplier-gap-stats", s.id, companyId],
    queryFn: () => fetchGapStats({ data: { fornecedor_id: s.id, company_id: companyId! } }),
    enabled: !!companyId && (s.product_count ?? 0) > 0,
  });
  const isMl = s.codigo === "mercadolivre";
  return (
    <Card className={selected ? "ring-2 ring-primary" : ""}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg">{s.nome}</CardTitle>
            <CardDescription>
              {isMl ? "Produtos importados pelo garimpo do Mercado Livre" : `Código: ${s.codigo}`}
            </CardDescription>
          </div>
          <Badge variant={s.last_sync_status === "ok" ? "default" : s.last_sync_status === "erro" ? "destructive" : "secondary"}>
            {isMl ? "garimpo" : (s.last_sync_status ?? "não sincronizado")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><div className="text-muted-foreground text-xs">{isMl ? "Produtos importados" : "Produtos"}</div><div className="font-medium">{s.product_count ?? 0}</div></div>
          <div><div className="text-muted-foreground text-xs">Última atualização</div><div className="font-medium">{fmtDate(s.last_sync_at)}</div></div>
        </div>
        {companyId && !isMl && (
          <div className="flex flex-wrap gap-2 pt-1">
            {stats.isLoading ? (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Calculando cobertura…
              </span>
            ) : stats.data ? (
              <>
                <Badge variant="outline" className="text-amber-700 border-amber-300">
                  Faltando na empresa: {stats.data.missing.toLocaleString("pt-BR")}
                </Badge>
                <Badge variant="outline" className="text-slate-700 border-slate-300">
                  Inativos na empresa: {stats.data.inactive.toLocaleString("pt-BR")}
                </Badge>
              </>
            ) : null}
          </div>
        )}
        {s.source_url && (
          <a href={s.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ExternalLink className="h-3 w-3" /> Fonte de dados
          </a>
        )}
        {s.last_sync_error && (
          <div className="text-xs text-destructive break-words">Erro: {s.last_sync_error}</div>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button size="sm" variant="secondary" onClick={onSelect}>Ver produtos</Button>
          <Button size="sm" variant="outline" onClick={onEditFees}>
            <Percent className="h-4 w-4 mr-2" /> Taxas e Configurações
          </Button>
          {!isMl && (
            <Button size="sm" onClick={onUpdate} disabled={updating}>
              {updating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Atualizar fornecedor
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
