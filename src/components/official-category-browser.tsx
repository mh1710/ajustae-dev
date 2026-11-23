import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, Loader2 } from "lucide-react";
import { listOfficialCategories } from "@/lib/categories.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageNumbers } from "@/components/page-numbers";

export function OfficialCategoryBrowser({ companyId }: { companyId: string }) {
  const listFn = useServerFn(listOfficialCategories);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [root, setRoot] = useState("all");
  const [page, setPage] = useState(0);
  const listing = useQuery({ queryKey: ["official-category-list", companyId, query, root, page], queryFn: () => listFn({ data: { company_id: companyId, search: query, root: root === "all" ? "" : root, page } }), enabled: !!companyId });
  return <section className="space-y-4 border-y border-border py-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">Lista oficial do Mercado Livre</h2>
      {listing.data && <Badge variant="outline">{listing.data.count.toLocaleString("pt-BR")} categorias</Badge>}
    </div>
    <div className="flex flex-wrap gap-3">
      <form className="flex min-w-52 flex-1 gap-2" onSubmit={e => { e.preventDefault(); setQuery(search.trim()); setPage(0); }}>
        <Input aria-label="Pesquisar na lista de categorias" placeholder="Nome ou código da categoria" value={search} onChange={e => setSearch(e.target.value)} />
        <Button type="submit" variant="outline" aria-label="Pesquisar lista de categorias"><Search className="h-4 w-4" /></Button>
      </form>
      <Select value={root} onValueChange={v => { setRoot(v); setPage(0); }}>
        <SelectTrigger className="w-full sm:w-72" aria-label="Departamento"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">Todos os departamentos</SelectItem>{listing.data?.roots.map(r => <SelectItem key={r.id} value={r.id}>{r.path}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    {listing.isLoading && <Loader2 aria-label="Carregando categorias" className="h-5 w-5 animate-spin" />}
    {listing.isError && <p className="text-destructive">Não foi possível carregar a lista de categorias.</p>}
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-border text-left text-muted-foreground"><tr><th className="p-3">Código</th><th className="p-3">Categoria e caminho</th><th className="p-3">Tipo</th></tr></thead><tbody>
      {listing.data?.rows.map(c => <tr className="border-b border-border align-top" key={c.id}><td className="whitespace-nowrap p-3 font-medium">{c.id}</td><td className="min-w-48 p-3">{c.path}</td><td className="p-3 text-muted-foreground">{c.leaf ? "Final" : "Departamento"}</td></tr>)}
    </tbody></table></div>
    {listing.data?.total === 0 && <p className="text-muted-foreground">Nenhuma categoria encontrada.</p>}
    <PageNumbers page={page + 1} pageSize={50} total={listing.data?.total ?? 0} onChange={v => setPage(v - 1)} />
  </section>;
}