import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, Pause, Play, StopCircle, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageNumbers } from "@/components/page-numbers";
import {
  startBlingSuppliersSync, getBlingSuppliersSummary, controlBlingSuppliersSync,
  listProductsWithSuppliers, setBlingSupplierMap, enqueueSupplierLinks,
} from "@/lib/bling-suppliers.functions";
import { listPrefixMap } from "@/lib/prefix-map.functions";

const PAGE = 50;

export function BlingSuppliersTab({ companyId }: { companyId: string | null }) {
  const qc = useQueryClient();
  const fnStart = useServerFn(startBlingSuppliersSync);
  const fnSummary = useServerFn(getBlingSuppliersSummary);
  const fnControl = useServerFn(controlBlingSuppliersSync);
  const fnList = useServerFn(listProductsWithSuppliers);
  const fnMap = useServerFn(setBlingSupplierMap);
  const fnLink = useServerFn(enqueueSupplierLinks);
  const fnPrefix = useServerFn(listPrefixMap);

  const [filter, setFilter] = useState<"all" | "with" | "without">("without");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [manualSupplier, setManualSupplier] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setPage(1); setSelected([]); }, [filter, supplierFilter, search, companyId]);

  const summary = useQuery({
    queryKey: ["bling-suppliers-summary", companyId],
    queryFn: () => fnSummary({ data: { company_id: companyId! } }),
    enabled: !!companyId,
    refetchInterval: (q) => (q.state.data?.job?.status === "executando" ? 3000 : false),
  });
  const prefix = useQuery({ queryKey: ["prefix-map"], queryFn: () => fnPrefix() });
  const products = useQuery({
    queryKey: ["bling-suppliers-products", companyId, filter, supplierFilter, search, page],
    queryFn: () => fnList({ data: {
      company_id: companyId!, filter, search,
      bling_supplier_id: supplierFilter === "all" ? null : supplierFilter,
      limit: PAGE, offset: (page - 1) * PAGE,
    } }),
    enabled: !!companyId,
  });

  const job = summary.data?.job ?? null;
  const running = job?.status === "executando";
  const paused = job?.status === "pausado";
  const prevStatus = useState<string | undefined>(undefined);
  useEffect(() => {
    if (prevStatus[0] === "executando" && job?.status === "concluido") {
      qc.invalidateQueries({ queryKey: ["bling-suppliers-products"] });
      toast.success("Fornecedores do Bling atualizados.");
    }
    prevStatus[1](job?.status);
  }, [job?.status]);

  if (!companyId) return <p className="text-sm text-muted-foreground">Selecione uma empresa.</p>;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["bling-suppliers-summary", companyId] });
    qc.invalidateQueries({ queryKey: ["bling-suppliers-products"] });
  };

  async function run<T>(fn: () => Promise<T>, ok?: (r: T) => string) {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast.success(ok(r));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro.");
    } finally {
      setBusy(false);
    }
  }

  const suppliers = summary.data?.suppliers ?? [];
  const systemSuppliers = prefix.data?.suppliers ?? [];
  const items = products.data?.items ?? [];
  const total = products.data?.total ?? 0;
  const without = (summary.data?.total_products ?? 0) - (summary.data?.with_supplier ?? 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Fornecedores vinculados no Bling</CardTitle>
          <div className="flex gap-2">
            {running ? (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => fnControl({ data: { company_id: companyId, job_id: job!.id, action: "pause" } }))}>
                  <Pause className="h-4 w-4" /> Pausar
                </Button>
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(() => fnControl({ data: { company_id: companyId, job_id: job!.id, action: "cancel" } }))}>
                  <StopCircle className="h-4 w-4" /> Cancelar
                </Button>
              </>
            ) : paused ? (
              <>
                <Button size="sm" disabled={busy} onClick={() => run(() => fnControl({ data: { company_id: companyId, job_id: job!.id, action: "resume" } }))}>
                  <Play className="h-4 w-4" /> Retomar
                </Button>
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(() => fnControl({ data: { company_id: companyId, job_id: job!.id, action: "cancel" } }))}>
                  <StopCircle className="h-4 w-4" /> Cancelar
                </Button>
              </>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => run(() => fnStart({ data: { company_id: companyId } }), () => "Busca de fornecedores iniciada.")}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Puxar fornecedores do Bling
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-4">
            <span>Produtos: <strong>{(summary.data?.total_products ?? 0).toLocaleString("pt-BR")}</strong></span>
            <span>Com fornecedor: <strong>{(summary.data?.with_supplier ?? 0).toLocaleString("pt-BR")}</strong></span>
            <span>Sem fornecedor: <strong className="text-destructive">{without.toLocaleString("pt-BR")}</strong></span>
          </div>
          {job ? (
            <div className="space-y-1">
              {running && job.phase === "detalhes" && job.details_total > 0 ? (
                <Progress value={Math.min(100, (job.details_checked / job.details_total) * 100)} className="h-2" />
              ) : running ? <Progress value={Math.min(95, job.pages_done)} className="h-2" /> : null}
              {running && job.phase === "detalhes" ? (
                <p className="text-xs text-muted-foreground">
                  Conferindo pela ficha os produtos que a listagem do Bling não traz (inativos):{" "}
                  {job.details_checked.toLocaleString("pt-BR")} de {job.details_total.toLocaleString("pt-BR")}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Última busca: {job.status === "executando" ? "em andamento" : job.status} · {job.pages_done} página(s) ·{" "}
                {job.links_found.toLocaleString("pt-BR")} vínculo(s)
                {job.finished_at ? ` · ${new Date(job.finished_at).toLocaleString("pt-BR")}` : ""}
              </p>
              {job.last_error ? <p className="text-xs text-destructive">{job.last_error}</p> : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma busca feita ainda nesta empresa.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Fornecedores encontrados no Bling</CardTitle></CardHeader>
        <CardContent>
          {suppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Puxe os fornecedores do Bling para ver a lista.</p>
          ) : (
            <div className="space-y-2">
              {suppliers.map((s) => (
                <div key={s.bling_supplier_id} className="flex flex-wrap items-center gap-3 rounded-md border p-2 text-sm">
                  <div className="min-w-48 flex-1">
                    <div className="font-medium">{s.nome ?? s.bling_supplier_id}</div>
                    <div className="text-xs text-muted-foreground">id {s.bling_supplier_id} · {s.products.toLocaleString("pt-BR")} produto(s)</div>
                    {(s.prefixes ?? []).length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="text-xs text-muted-foreground">Prefixos:</span>
                        {(s.prefixes ?? []).map((p) => (
                          <Badge key={p.prefix} variant="secondary" className="text-xs">
                            {p.prefix} · {p.count.toLocaleString("pt-BR")}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">Fornecedor do sistema:</span>
                  <Select
                    value={s.supplier_codigo ?? "none"}
                    onValueChange={(v) => run(() => fnMap({ data: { company_id: companyId, bling_supplier_id: s.bling_supplier_id, supplier_codigo: v === "none" ? "" : v } }), () => "Ligação salva.")}
                  >
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Não ligado</SelectItem>
                      {systemSuppliers.map((f: { codigo: string; nome: string }) => (
                        <SelectItem key={f.codigo} value={f.codigo}>{f.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                A ligação diz ao "Vincular pelo prefixo" qual fornecedor do Bling usar para cada prefixo de SKU do mapa central.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Produtos</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="with">Com fornecedor</SelectItem>
                <SelectItem value="without">Sem fornecedor</SelectItem>
              </SelectContent>
            </Select>
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Qualquer fornecedor</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.bling_supplier_id} value={s.bling_supplier_id}>{s.nome ?? s.bling_supplier_id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input className="w-56" placeholder="Buscar SKU ou nome" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(
                () => fnLink({ data: { company_id: companyId, mode: "prefix", product_ids: selected.length ? selected : null } }),
                (r) => `${r.enqueued} vínculo(s) enviados ao Bling${r.skipped ? ` · ${r.skipped} sem fornecedor ligado ao prefixo` : ""}${r.no_cost ? ` · ${r.no_cost} sem preço de custo (não vinculados)` : ""}.`,
              )}
            >
              <Link2 className="h-4 w-4" /> Vincular pelo prefixo {selected.length ? `(${selected.length})` : "(todos sem fornecedor)"}
            </Button>
            <span className="text-muted-foreground">ou</span>
            <Select value={manualSupplier} onValueChange={setManualSupplier}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Escolher fornecedor" /></SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.bling_supplier_id} value={s.bling_supplier_id}>{s.nome ?? s.bling_supplier_id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !manualSupplier || selected.length === 0}
              onClick={() => run(
                () => fnLink({ data: { company_id: companyId, mode: "manual", product_ids: selected, bling_supplier_id: manualSupplier } }),
                (r) => `${r.enqueued} vínculo(s) enviados ao Bling${r.no_cost ? ` · ${r.no_cost} sem preço de custo (não vinculados)` : ""}.`,
              )}
            >
              Definir nos selecionados ({selected.length})
            </Button>
          </div>

          {products.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="w-8 p-2">
                      <Checkbox
                        checked={items.length > 0 && items.every((i) => selected.includes(i.id))}
                        onCheckedChange={(c) => setSelected(c ? [...new Set([...selected, ...items.map((i) => i.id)])] : selected.filter((id) => !items.some((i) => i.id === id)))}
                        aria-label="Selecionar página"
                      />
                    </th>
                    <th className="p-2">SKU</th>
                    <th className="p-2">Nome</th>
                    <th className="p-2">Fornecedor no Bling</th>
                    <th className="p-2">Código</th>
                    <th className="p-2">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="p-2">
                        <Checkbox
                          checked={selected.includes(p.id)}
                          onCheckedChange={(c) => setSelected(c ? [...selected, p.id] : selected.filter((x) => x !== p.id))}
                          aria-label={`Selecionar ${p.codigo ?? ""}`}
                        />
                      </td>
                      <td className="p-2 font-mono text-xs">{p.codigo}</td>
                      <td className="max-w-72 truncate p-2">{p.nome}</td>
                      <td className="p-2">
                        {p.suppliers.length === 0 ? (
                          <Badge variant="destructive">Sem fornecedor</Badge>
                        ) : (
                          p.suppliers.map((s) => (
                            <div key={s.bling_supplier_id}>{s.nome ?? s.bling_supplier_id}{s.padrao ? " (padrão)" : ""}</div>
                          ))
                        )}
                      </td>
                      <td className="p-2 text-xs">{p.suppliers.map((s) => s.codigo).filter(Boolean).join(", ")}</td>
                      <td className="p-2 text-xs">
                        {p.suppliers.map((s) => (s.preco_custo != null ? Number(s.preco_custo).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "")).filter(Boolean).join(", ")}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 ? (
                    <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Nenhum produto.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{total.toLocaleString("pt-BR")} produto(s)</span>
            <PageNumbers page={page} pageSize={PAGE} total={total} onChange={setPage} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
