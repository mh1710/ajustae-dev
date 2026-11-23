import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { listProductStores, startBlingStoresSync, getBlingStoresProgress } from "@/lib/bling-stores.functions";
import { useAccess } from "@/hooks/use-access";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  productId: string;
  productName: string | null;
  productCode: string | null;
  blingProductId: string | null;
}

export function ProductStoresModal({
  open, onOpenChange, companyId, productId, productName, productCode, blingProductId,
}: Props) {
  const { access } = useAccess();
  const qc = useQueryClient();
  const fetchList = useServerFn(listProductStores);
  const startSync = useServerFn(startBlingStoresSync);
  const fetchProgress = useServerFn(getBlingStoresProgress);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filterStore, setFilterStore] = useState<string>("all");
  const [filterLinked, setFilterLinked] = useState<string>("all");
  const [filterPromo, setFilterPromo] = useState<string>("all");

  const list = useQuery({
    queryKey: ["product-stores", companyId, productId],
    queryFn: () => fetchList({ data: { company_id: companyId, internal_product_id: productId } }),
    enabled: open,
  });

  const progress = useQuery({
    queryKey: ["stores-progress-modal", companyId],
    queryFn: () => fetchProgress({ data: { company_id: companyId } }),
    enabled: open,
    refetchInterval: (q) => {
      const st = (q.state.data as any)?.job?.status;
      return st === "pendente" || st === "processando" ? 2500 : false;
    },
  });

  async function handleRefresh() {
    if (!blingProductId) {
      toast.error("Este produto não tem ID do Bling.");
      return;
    }
    try {
      const r = await startSync({
        data: { company_id: companyId, scope: "product", bling_product_id: blingProductId },
      });
      if (r.already_running) toast.info("Já existe uma sincronização em andamento.");
      else toast.success("Sincronização iniciada.");
      qc.invalidateQueries({ queryKey: ["stores-progress-modal", companyId] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["product-stores", companyId, productId] }), 3000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao iniciar sincronização.");
    }
  }

  const rows = (list.data ?? []) as any[];
  const distinctStores = Array.from(
    new Map(rows.map((r) => [r.bling_store_id, r.store_name || r.bling_store_id])).entries(),
  );

  const filtered = rows.filter((r) => {
    if (filterStore !== "all" && r.bling_store_id !== filterStore) return false;
    if (filterLinked === "active" && !r.is_linked) return false;
    if (filterLinked === "inactive" && r.is_linked) return false;
    if (filterPromo === "with" && r.current_promotional_price == null) return false;
    if (filterPromo === "without" && r.current_promotional_price != null) return false;
    if (search) {
      const s = search.toLowerCase();
      const hay = [r.store_name, r.store_product_code, r.bling_store_id, r.bling_product_store_id]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });

  function toggle(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const job = (progress.data as any)?.job;
  const isRunning = job && (job.status === "pendente" || job.status === "processando");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lojas vinculadas — {productName ?? "produto"}</DialogTitle>
          <DialogDescription>
            SKU: <span className="font-mono">{productCode ?? "—"}</span> · Bling ID:{" "}
            <span className="font-mono">{blingProductId ?? "—"}</span> · {rows.length} loja(s) vinculada(s)
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {!access.company_restricted && <Button size="sm" onClick={handleRefresh} disabled={isRunning || !blingProductId}>
            {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Atualizar lojas deste produto
          </Button>}
          {isRunning && (
            <span className="text-xs text-muted-foreground">
              Página {job.paginas_processadas + 1} · {job.vinculos_encontrados} vínculos processados
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-3">
          <Input placeholder="Buscar código/nome/ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={filterStore} onValueChange={setFilterStore}>
            <SelectTrigger><SelectValue placeholder="Loja" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as lojas</SelectItem>
              {distinctStores.map(([id, name]) => (
                <SelectItem key={id} value={id}>{name as string}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterLinked} onValueChange={setFilterLinked}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Ativos + inativos</SelectItem>
              <SelectItem value="active">Somente ativos</SelectItem>
              <SelectItem value="inactive">Somente inativos</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterPromo} onValueChange={setFilterPromo}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Com/sem promoção</SelectItem>
              <SelectItem value="with">Com promoção</SelectItem>
              <SelectItem value="without">Sem promoção</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="mt-3 overflow-x-auto rounded border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase">
              <tr>
                <th className="w-8 px-2 py-2"></th>
                <th className="px-2 py-2">Loja</th>
                <th className="px-2 py-2">Tipo</th>
                <th className="px-2 py-2">ID loja</th>
                <th className="px-2 py-2">ID vínculo</th>
                <th className="px-2 py-2">Cód. loja</th>
                <th className="px-2 py-2 text-right">Preço</th>
                <th className="px-2 py-2 text-right">Promocional</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Última importação</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.isLoading && (
                <tr><td colSpan={10} className="px-2 py-6 text-center text-muted-foreground">Carregando...</td></tr>
              )}
              {!list.isLoading && filtered.length === 0 && (
                <tr><td colSpan={10} className="px-2 py-6 text-center text-muted-foreground">Nenhum vínculo encontrado.</td></tr>
              )}
              {filtered.map((r) => {
                const isOpen = expanded.has(r.id);
                return (
                  <>
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-2 py-2">
                        <button onClick={() => toggle(r.id)} className="text-muted-foreground hover:text-foreground">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-2 py-2">{r.store_name ?? "—"}</td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">{r.store_type ?? "—"}</td>
                      <td className="px-2 py-2 font-mono text-xs">{r.bling_store_id}</td>
                      <td className="px-2 py-2 font-mono text-xs">{r.bling_product_store_id}</td>
                      <td className="px-2 py-2 font-mono text-xs">{r.store_product_code ?? "—"}</td>
                      <td className="px-2 py-2 text-right">
                        {r.current_price != null ? Number(r.current_price).toFixed(2) : "—"}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {r.current_promotional_price != null ? Number(r.current_promotional_price).toFixed(2) : "—"}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={r.is_linked ? "default" : "secondary"}>
                          {r.is_linked ? "ativo" : "inativo"}
                        </Badge>
                        {r.sync_status && r.sync_status !== "ok" && (
                          <Badge variant="outline" className="ml-1">{r.sync_status}</Badge>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {r.last_imported_at ? new Date(r.last_imported_at).toLocaleString("pt-BR") : "—"}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.id}-det`} className="bg-muted/20">
                        <td colSpan={10} className="px-4 py-3">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                            <div><span className="text-muted-foreground">Categorias:</span>
                              <pre className="mt-1 max-h-32 overflow-auto rounded bg-background p-2 text-[11px]">
                                {JSON.stringify(r.categories_json, null, 2)}
                              </pre>
                            </div>
                            <div><span className="text-muted-foreground">Fornecedor / Marca:</span>
                              <div className="mt-1">
                                Fornecedor: <span className="font-mono">{r.supplier_store_id ?? "—"}</span><br />
                                Marca: <span className="font-mono">{r.brand_store_id ?? "—"}</span>
                              </div>
                              <div className="mt-2 text-muted-foreground">Criado: {new Date(r.created_at).toLocaleString("pt-BR")}</div>
                              <div className="text-muted-foreground">Atualizado: {new Date(r.updated_at).toLocaleString("pt-BR")}</div>
                              {r.sync_error && <div className="mt-2 text-destructive">Erro: {r.sync_error}</div>}
                            </div>
                            <div><span className="text-muted-foreground">JSON bruto (Bling):</span>
                              <pre className="mt-1 max-h-48 overflow-auto rounded bg-background p-2 text-[11px]">
                                {JSON.stringify(r.raw_data_json, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
