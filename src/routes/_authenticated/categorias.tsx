import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FolderTree, Loader2, Pause, Play, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PageNumbers } from "@/components/page-numbers";
import { OfficialCategoryBrowser } from "@/components/official-category-browser";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import { listMyCompanies } from "@/lib/companies.functions";
import { listProductCategories, startCategoryJob, getCategoryJob, controlCategoryJob, listCategoryJobItems, reviewCategoryJobItems, searchOfficialCategories, chooseCategorySuggestion } from "@/lib/categories.functions";

export const Route = createFileRoute("/_authenticated/categorias")({
  head: () => ({ meta: [
    { title: "Categorias de produtos | Ajusta-Ê" },
    { name: "description", content: "Categorias do Mercado Livre para os produtos de cada empresa, com revisão antes de salvar." },
    { property: "og:title", content: "Categorias de produtos | Ajusta-Ê" },
    { property: "og:description", content: "Consulte e revise as categorias dos produtos no Mercado Livre." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: CategoriesPage,
});

const MATCH: Record<string, string> = { ean: "Pelo EAN", titulo: "Pelo título", categoria: "Classificador do ML", ia: "IA (categoria do ML)" };

function CategoriesPage() {
  const qc = useQueryClient();
  const companiesFn = useServerFn(listMyCompanies);
  const listFn = useServerFn(listProductCategories);
  const startFn = useServerFn(startCategoryJob);
  const jobFn = useServerFn(getCategoryJob);
  const controlFn = useServerFn(controlCategoryJob);
  const itemsFn = useServerFn(listCategoryJobItems);
  const reviewFn = useServerFn(reviewCategoryJobItems);
  const searchCategoriesFn = useServerFn(searchOfficialCategories);
  const chooseFn = useServerFn(chooseCategorySuggestion);
  const companies = useQuery({ queryKey: ["companies"], queryFn: () => companiesFn() });
  const [companyId, setCompanyId] = useSelectedCompany();
  useEffect(() => { if (!companyId && companies.data?.[0]) setCompanyId(companies.data[0].id); }, [companyId, companies.data, setCompanyId]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [useAi, setUseAi] = useState(true);
  const [manualProduct, setManualProduct] = useState<{id:string;nome:string}|null>(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<{id:string;path:string}[]>([]);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showCategoryList, setShowCategoryList] = useState(false);
  const [reviewKind, setReviewKind] = useState<"revisar" | "sem">("revisar");
  const [reviewPage, setReviewPage] = useState(0);
  const [approved, setApproved] = useState<string[]>([]);
  useEffect(() => { setPage(0); setSelected([]); }, [companyId, query, onlyMissing]);

  const listing = useQuery({ queryKey: ["product-categories", companyId, query, page, onlyMissing],
    queryFn: () => listFn({ data: { company_id: companyId ?? "", search: query, page, only_missing: onlyMissing } }), enabled: !!companyId });
  const job = useQuery({ queryKey: ["category-job", companyId], queryFn: () => jobFn({ data: { company_id: companyId ?? "" } }),
    enabled: !!companyId, refetchInterval: (q) => q.state.data?.status === "executando" ? 3000 : false });
  const j = job.data;
  const items = useQuery({ queryKey: ["category-items", j?.id, reviewKind, reviewPage, j?.done_count],
    queryFn: () => { if(!j || !companyId) throw new Error("Selecione a empresa."); return itemsFn({ data: { company_id: companyId, job_id: j.id, kind: reviewKind, page: reviewPage } }); }, enabled: !!j?.id && !!companyId });
  const rows = listing.data?.rows ?? [];
  const running = j?.status === "executando" || j?.status === "pausado";

  useEffect(() => { setApproved([]); setReviewPage(0); setManualProduct(null); }, [companyId,j?.id]);

  async function start(all: boolean) {
    if (!companyId) return;
    setBusy(true);
    try {
      await startFn({ data: { company_id: companyId, product_ids: all ? null : selected, search: query, only_missing: onlyMissing, use_ai: useAi } });
      toast.success("Categorização iniciada. Acompanhe o progresso abaixo.");
      setSelected([]); setApproved([]); setReviewPage(0);
      await qc.invalidateQueries({ queryKey: ["category-job", companyId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao iniciar."); }
    finally { setBusy(false); }
  }
  async function control(action: "pause" | "resume" | "cancel") {
    if (!companyId || !j) return;
    try { await controlFn({ data: { company_id: companyId, job_id: j.id, action } }); await job.refetch(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha."); }
  }
  async function review(action: "save" | "discard", ids: string[]) {
    if (!companyId || !j) return;
    setBusy(true);
    try {
      const r = await reviewFn({ data: { company_id: companyId, job_id: j.id, action, product_ids: ids } });
      toast.success(action === "save" ? `${r.count} categoria(s) salva(s).` : `${r.count} sugestão(ões) descartada(s).`);
      setApproved([]);
      await Promise.all([job.refetch(), items.refetch(), qc.invalidateQueries({ queryKey: ["product-categories", companyId] })]);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha."); }
    finally { setBusy(false); }
  }
  async function searchCategories() {
    if(!companyId || categorySearch.trim().length<2) return;
    setBusy(true);
    try {setCategoryOptions(await searchCategoriesFn({data:{company_id:companyId,search:categorySearch.trim()}}));}
    catch(e) {toast.error(e instanceof Error?e.message:"Falha na busca.");} finally {setBusy(false);}
  }
  async function choose(id:string) {
    if(!companyId || !j || !manualProduct) return;
    setBusy(true);
    try {
      await chooseFn({data:{company_id:companyId,job_id:j.id,product_id:manualProduct.id,category_id:id}});
      setManualProduct(null); await Promise.all([job.refetch(),items.refetch()]);
      toast.success("Categoria escolhida. Revise antes de salvar.");
    } catch(e) {toast.error(e instanceof Error?e.message:"Falha ao escolher.");} finally {setBusy(false);}
  }
  const pct = j?.total ? Math.round((j.done_count / j.total) * 100) : 0;
  const reviewRows = (items.data?.rows ?? []) as any[];

  return <div className="space-y-6 p-4 md:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="flex items-center gap-2 text-3xl font-bold"><FolderTree className="h-7 w-7" /> Categorias</h1>
        <p className="text-sm text-muted-foreground">Mercado Livre · Magalu: aguardando conexão autorizada</p></div>
      <Select value={companyId} onValueChange={setCompanyId}><SelectTrigger className="w-56"><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
        <SelectContent>{companies.data?.map((c) => <SelectItem value={c.id} key={c.id}>{c.nome}</SelectItem>)}</SelectContent></Select>
    </div>

    <div><Button variant="outline" onClick={() => setShowCategoryList(v => !v)} aria-expanded={showCategoryList}><FolderTree className="mr-2 h-4 w-4" />{showCategoryList ? "Ocultar lista de categorias" : "Ver lista de categorias do ML"}</Button></div>
    {showCategoryList && companyId && <OfficialCategoryBrowser key={companyId} companyId={companyId} />}

    <div className="flex flex-wrap items-center gap-3">
      <form className="flex min-w-52 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }}>
        <Input aria-label="Buscar SKU ou nome" placeholder="Buscar SKU ou nome" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button type="submit" variant="outline" aria-label="Buscar"><Search className="h-4 w-4" /></Button>
      </form>
      <div className="flex items-center gap-2"><Switch id="missing" checked={onlyMissing} onCheckedChange={setOnlyMissing} /><Label htmlFor="missing">Só sem categoria</Label></div>
      <div className="flex items-center gap-2"><Switch id="ai" checked={useAi} onCheckedChange={setUseAi} /><Label htmlFor="ai">Usar IA quando não achar</Label></div>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button disabled={!selected.length || busy || running || !!j?.to_review} onClick={() => start(false)}><Sparkles className="mr-2 h-4 w-4" />Categorizar selecionados ({selected.length})</Button>
      <Button variant="outline" disabled={busy || running || !!j?.to_review || !listing.data?.total} onClick={() => start(true)}>Categorizar todos do filtro ({listing.data?.total ?? 0})</Button>
      {!!j?.to_review && <span className="self-center text-sm text-muted-foreground">Revise as sugestões pendentes antes de iniciar outra busca.</span>}
      {selected.length > 0 && <Button variant="ghost" onClick={() => setSelected([])}>Limpar seleção</Button>}
    </div>

    {job.isError && <p className="text-destructive">Não foi possível carregar o progresso.</p>}
    {j && <section className="space-y-3 border-y border-border py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">Categorização {j.status === "executando" ? "em andamento" : j.status === "pausado" ? "pausada" : j.status === "concluido" ? "concluída" : j.status === "cancelado" ? "cancelada" : "com erro"}
          {j.use_ai && <Badge variant="outline" className="ml-2">com IA</Badge>}</div>
        <div className="flex gap-2">
          {j.status === "executando" && <Button size="sm" variant="outline" onClick={() => control("pause")}><Pause className="mr-1 h-4 w-4" />Pausar</Button>}
          {(j.status === "erro" || (j.status === "pausado" && !["access","configuration","refusal"].includes(j.blocked_reason ?? ""))) && <Button size="sm" variant="outline" onClick={() => control("resume")}><Play className="mr-1 h-4 w-4" />Retomar</Button>}
          {(running || j.status === "erro") && <Button size="sm" variant="outline" onClick={() => control("cancel")}><X className="mr-1 h-4 w-4" />Cancelar</Button>}
        </div>
      </div>
      <Progress value={pct} />
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>{j.done_count} de {j.total} ({pct}%)</span><span>Encontradas: {j.found_count}</span>
        <span>Sem categoria: {j.done_count - j.found_count - j.error_count}</span><span>Erros: {j.error_count}</span>
        <span>Aguardando revisão: {j.to_review}</span>
      </div>
      {j.last_error && <p className="text-sm text-destructive">{j.last_error}</p>}
    </section>}

    {listing.isError && <p className="text-destructive">Não foi possível carregar os produtos.</p>}
    <div className="overflow-x-auto border-b border-border">
      <table className="w-full text-sm"><thead className="border-b border-border text-left text-muted-foreground"><tr>
        <th className="w-10 p-3"><Checkbox aria-label="Selecionar página" checked={rows.length > 0 && rows.every((r) => selected.includes(r.id))}
          onCheckedChange={(v) => setSelected((old) => v ? [...new Set([...old, ...rows.map((r) => r.id)])] : old.filter((id) => !rows.some((r) => r.id === id)))} /></th>
        <th className="p-3">Produto</th><th className="p-3">EAN</th><th className="p-3">Categoria do Mercado Livre</th>
      </tr></thead><tbody>{rows.map((row) => {
        const match = Array.isArray(row.product_ml_categories) ? row.product_ml_categories[0] : row.product_ml_categories;
        return <tr key={row.id} className="border-b border-border align-top"><td className="p-3"><Checkbox aria-label={`Selecionar ${row.codigo ?? row.nome}`} checked={selected.includes(row.id)} onCheckedChange={(v) => setSelected((old) => v ? [...old, row.id] : old.filter((id) => id !== row.id))} /></td>
          <td className="p-3"><div className="font-medium">{row.codigo ?? "—"}</div><div className="max-w-md text-muted-foreground">{row.nome}</div></td>
          <td className="p-3">{row.gtin ?? "—"}</td><td className="p-3">{match?.ml_category_path ?? <span className="text-muted-foreground">Não atribuída</span>}
            {match && <div className="text-xs text-muted-foreground">{match.ml_category_id} · {MATCH[match.match_by] ?? match.match_by}</div>}</td></tr>;
      })}</tbody></table>
      {!listing.isLoading && rows.length === 0 && <p className="p-6 text-center text-muted-foreground">Nenhum produto encontrado.</p>}
    </div>
    <PageNumbers page={page + 1} pageSize={30} total={listing.data?.total ?? 0} onChange={(value) => setPage(value - 1)} />

    {j && <section className="space-y-4 border-t border-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button variant={reviewKind === "revisar" ? "default" : "outline"} onClick={() => { setReviewKind("revisar"); setReviewPage(0); }}>Revisar ({j.to_review})</Button>
          <Button variant={reviewKind === "sem" ? "default" : "outline"} onClick={() => { setReviewKind("sem"); setReviewPage(0); }}>Não encontrados ({j.done_count - j.found_count})</Button>
        </div>
        {reviewKind === "revisar" && <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setApproved(reviewRows.map((r) => r.product_id))}>Marcar página</Button>
          <Button disabled={!approved.length || busy} onClick={() => review("save", approved)}>Salvar marcadas ({approved.length})</Button>
          <Button variant="outline" disabled={!approved.length || busy} onClick={() => review("discard", approved)}>Descartar marcadas</Button>
        </div>}
      </div>
      {items.isError && <p className="text-destructive">Não foi possível carregar as sugestões.</p>}
      {items.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
      {reviewRows.map((s) => <div key={s.product_id} className="flex items-start gap-3 border-b border-border py-3">
        {reviewKind === "revisar" && <Checkbox className="mt-1" aria-label={`Aplicar categoria de ${s.bling_products?.codigo}`} checked={approved.includes(s.product_id)}
          onCheckedChange={(v) => setApproved((old) => v ? [...old, s.product_id] : old.filter((id) => id !== s.product_id))} />}
        <div className="min-w-0 flex-1"><div className="font-medium">{s.bling_products?.codigo} · {s.nome_busca}</div>
          <div className="text-xs text-muted-foreground">Nome usado: {s.nome_origem === "fornecedor" ? "catálogo do fornecedor" : "cadastro do produto"}</div>
          {s.category_id ? <><div className="mt-1">{s.category_path} <Badge variant="outline">{s.category_id}</Badge></div>
            <div className="text-xs text-muted-foreground">{MATCH[s.match_by] ?? s.match_by}{s.ml_product_title ? ` · ${s.ml_product_title}` : ""}</div></>
            : <div className="text-sm text-destructive">{s.erro}</div>}</div>
        {reviewKind === "sem" && <Button size="sm" variant="outline" disabled={busy} onClick={() => {setManualProduct({id:s.product_id,nome:s.nome_busca || s.bling_products?.nome || ""});setCategorySearch("");setCategoryOptions([]);}}>Escolher categoria</Button>}
      </div>)}
      {!items.isLoading && !reviewRows.length && <p className="text-sm text-muted-foreground">Nada aqui por enquanto.</p>}
      <PageNumbers page={reviewPage + 1} pageSize={50} total={items.data?.total ?? 0} onChange={(v) => { setReviewPage(v - 1); setApproved([]); }} />
    </section>}
    <Dialog open={!!manualProduct} onOpenChange={(open)=>{if(!open)setManualProduct(null);}}>
      <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Escolher categoria do Mercado Livre</DialogTitle><DialogDescription>{manualProduct?.nome}</DialogDescription></DialogHeader>
        <form className="flex gap-2" onSubmit={(e)=>{e.preventDefault();searchCategories();}}>
          <Input aria-label="Buscar categoria oficial" placeholder="Microfones, roteadores, cabos…" value={categorySearch} onChange={(e)=>setCategorySearch(e.target.value)}/>
          <Button type="submit" disabled={busy || categorySearch.trim().length<2} aria-label="Buscar categorias oficiais"><Search className="h-4 w-4"/></Button>
        </form>
        <div className="max-h-96 space-y-2 overflow-y-auto">{categoryOptions.map(c=><Button key={c.id} variant="outline" disabled={busy} className="h-auto w-full justify-start whitespace-normal py-3 text-left" onClick={()=>choose(c.id)}>{c.path} · {c.id}</Button>)}</div>
      </DialogContent>
    </Dialog>
  </div>;
}
