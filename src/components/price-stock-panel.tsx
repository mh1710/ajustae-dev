import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Wand2, Upload, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PageNumbers } from "@/components/page-numbers";
import { PricingPolicyAlert } from "@/components/pricing-policy-alert";
import { PricingPolicyDialog } from "@/components/pricing-policy-dialog";
import { listProducts, listProductIds } from "@/lib/bling-sync.functions";
import {
  transformUpdatePriceStock,
  transformZeroStock,
  transformSetStock,
  listChangedProductIds,
} from "@/lib/products-tools.functions";
import { auditPricePolicy, type PriceAuditResult } from "@/lib/pricing.functions";
import { enqueueBlingPush } from "@/lib/bling-push.functions";

type Scope = "all" | "selected" | "changed";
type SyncScope = "preco" | "estoque" | "ambos";
type Step = "policy" | "audit" | "ready";

function brl(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function PriceStockPanel({ companyId }: { companyId: string | undefined }) {
  const qc = useQueryClient();
  const fetchProducts = useServerFn(listProducts);
  const fetchIds = useServerFn(listProductIds);
  const fetchChangedIds = useServerFn(listChangedProductIds);
  const runPriceStock = useServerFn(transformUpdatePriceStock);
  const runZeroStock = useServerFn(transformZeroStock);
  const runSetStock = useServerFn(transformSetStock);
  const runAudit = useServerFn(auditPricePolicy);
  const enqueuePush = useServerFn(enqueueBlingPush);

  // ---- filtros / seleção ----
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [situacao, setSituacao] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope>("all");

  useEffect(() => { setPage(1); }, [search, situacao, companyId]);
  useEffect(() => { setSelectedIds([]); }, [companyId]);
  useEffect(() => {
    if (selectedIds.length > 0) setScope("selected");
    else setScope((s) => (s === "selected" ? "all" : s));
  }, [selectedIds.length]);

  const products = useQuery({
    queryKey: ["ps-products", companyId, search, situacao, page],
    queryFn: () => fetchProducts({
      data: {
        company_id: companyId!,
        search: search || undefined,
        situacao: situacao === "all" ? undefined : situacao,
        page,
        page_size: pageSize,
      },
    }),
    enabled: !!companyId,
  });

  const changedQuery = useQuery({
    queryKey: ["changed-product-ids", companyId],
    queryFn: () => fetchChangedIds({ data: { company_id: companyId! } }),
    enabled: !!companyId && scope === "changed",
    staleTime: 30_000,
  });
  const changedIds = changedQuery.data?.ids ?? [];

  const rows = products.data?.rows ?? [];
  const total = products.data?.count ?? 0;
  const pageIds = rows.map((r) => r.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));

  function togglePage(v: boolean) {
    setSelectedIds((prev) => (v ? Array.from(new Set([...prev, ...pageIds])) : prev.filter((id) => !pageIds.includes(id))));
  }
  async function selectAllFiltered() {
    if (!companyId) return;
    const res = await fetchIds({
      data: {
        company_id: companyId,
        search: search || undefined,
        situacao: situacao === "all" ? undefined : situacao,
      },
    });
    setSelectedIds(res.ids);
    toast.success(`${res.ids.length.toLocaleString("pt-BR")} produto(s) selecionado(s).`);
  }

  const ids = scope === "selected" ? selectedIds : scope === "changed" ? changedIds : undefined;
  const scopeDisabled =
    (scope === "selected" && selectedIds.length === 0) ||
    (scope === "changed" && (changedQuery.isLoading || changedIds.length === 0));

  // ---- aplicar preço/estoque ----
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyMode, setApplyMode] = useState<SyncScope>("ambos");
  const [applying, setApplying] = useState(false);
  const [considerMlStock, setConsiderMlStock] = useState(true);
  const [zeroing, setZeroing] = useState(false);
  const [setStockOpen, setSetStockOpen] = useState(false);
  const [setStockValue, setSetStockValue] = useState("4");
  const [settingStock, setSettingStock] = useState(false);
  const [setStockProgress, setSetStockProgress] = useState(0);

  async function doApply() {
    if (!companyId) return;
    setApplying(true);
    try {
      const res = await runPriceStock({
        data: {
          company_id: companyId,
          product_ids: ids,
          include_stores: applyMode !== "estoque",
          only_price: applyMode === "preco",
          only_stock: applyMode === "estoque",
          consider_ml_stock: considerMlStock,
        },
      });
      setApplyOpen(false);
      const nf = (n: number) => Number(n ?? 0).toLocaleString("pt-BR");
      const precos = (res.preco_atualizado ?? 0) + (res.preco_e_estoque_atualizados ?? 0);
      const estoques = (res.estoque_atualizado ?? 0) + (res.preco_e_estoque_atualizados ?? 0);
      const alterados = applyMode === "estoque" ? estoques : applyMode === "preco" ? precos : precos + estoques;
      const viaMl = Number((res as { estoque_via_ml?: number }).estoque_via_ml ?? 0);
      const origem = viaMl
        ? ` (${nf(estoques - viaMl)} pelo fornecedor · ${nf(viaMl)} pelo Mercado Livre, mínimo 4)`
        : "";
      const detalhe =
        applyMode === "estoque"
          ? `Estoque alterado em ${nf(estoques)} produto(s)${origem}.`
          : applyMode === "preco"
            ? `Preço alterado em ${nf(precos)} produto(s) e ${nf(res.stores_updated)} multiloja(s).`
            : `Alterados: ${nf(precos)} preço(s), ${nf(estoques)} estoque(s)${origem}, ${nf(res.stores_updated)} multiloja(s).`;
      const contexto =
        `${nf(res.encontrados)} produto(s) conferidos com a base do fornecedor` +
        (res.inalterados ? ` · ${nf(res.inalterados)} já estavam corretos` : "") +
        (res.nao_encontrados ? ` · ${nf(res.nao_encontrados)} sem correspondência no fornecedor` : "") +
        (res.sem_fornecedor ? ` · ${nf(res.sem_fornecedor)} sem fornecedor no SKU` : "");
      if (alterados === 0 && (res.stores_updated ?? 0) === 0) {
        toast.info(`Nada a alterar: ${contexto}.`);
      } else {
        toast.success(`${detalhe} ${contexto}.`);
      }
      await qc.invalidateQueries({ queryKey: ["ps-products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao aplicar preço e estoque");
    } finally { setApplying(false); }
  }

  async function doZeroStock() {
    if (!companyId) return;
    setZeroing(true);
    try {
      const res = await runZeroStock({ data: { company_id: companyId, product_ids: ids } });
      toast.success(`Estoque zerado em ${Number((res as { updated?: number }).updated ?? 0).toLocaleString("pt-BR")} produto(s).`);
      await qc.invalidateQueries({ queryKey: ["ps-products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao zerar estoque");
    } finally { setZeroing(false); }
  }

  async function doSetStock() {
    if (!companyId) return;
    const value = Math.max(0, Math.floor(Number(setStockValue)));
    if (!Number.isFinite(value)) {
      toast.error("Informe um número válido para o estoque.");
      return;
    }
    setSettingStock(true);
    setSetStockProgress(0);
    try {
      let updated = 0;
      if (ids) {
        for (let offset = 0; offset < ids.length; offset += 250) {
          const batch = ids.slice(offset, offset + 250);
          const res = await runSetStock({
            data: { company_id: companyId, product_ids: batch, value, limit: 250 },
          });
          updated += res.updated;
          setSetStockProgress(Math.min(offset + batch.length, ids.length));
        }
      } else {
        for (let guard = 0; guard < 10_000; guard++) {
          const res = await runSetStock({ data: { company_id: companyId, value, limit: 250 } });
          updated += res.updated;
          setSetStockProgress(updated);
          if (!res.has_more) break;
          if (guard === 9_999) throw new Error("A alteração não terminou. Tente continuar novamente.");
        }
      }
      setSetStockOpen(false);
      toast.success(`Estoque definido para ${value.toLocaleString("pt-BR")} em ${updated.toLocaleString("pt-BR")} produto(s).`);
      await qc.invalidateQueries({ queryKey: ["ps-products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao definir estoque");
    } finally { setSettingStock(false); }
  }

  // ---- sincronização com validação ----
  const [syncScope, setSyncScope] = useState<SyncScope>("ambos");
  const [flowOpen, setFlowOpen] = useState(false);
  const [step, setStep] = useState<Step>("policy");
  const [auditing, setAuditing] = useState(false);
  const [repricing, setRepricing] = useState(false);
  const [repriceProgress, setRepriceProgress] = useState<{ done: number; total: number } | null>(null);

  const [pushing, setPushing] = useState(false);
  const [audit, setAudit] = useState<PriceAuditResult | null>(null);

  const needsPriceCheck = syncScope !== "estoque";

  function startFlow() {
    setAudit(null);
    setStep(needsPriceCheck ? "policy" : "ready");
    setFlowOpen(true);
  }

  async function doAudit() {
    if (!companyId) return;
    setAuditing(true);
    try {
      const res = await runAudit({ data: { company_id: companyId, product_ids: ids, limit: 100 } });
      setAudit(res);
      setStep(res.divergentes === 0 ? "ready" : "audit");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na auditoria de preço");
    } finally { setAuditing(false); }
  }

  async function doReprice() {
    if (!companyId) return;
    setRepricing(true);
    setRepriceProgress(null);
    try {
      if (ids && ids.length > 0) {
        // Lotes pequenos: um único pedido com dezenas de milhares de produtos
        // estoura o tempo limite e a tela parecia "não fazer nada".
        const BATCH = 400;
        for (let offset = 0; offset < ids.length; offset += BATCH) {
          const batch = ids.slice(offset, offset + BATCH);
          await runPriceStock({
            data: {
              company_id: companyId,
              product_ids: batch,
              include_stores: true,
              only_price: syncScope === "preco",
              only_stock: false,
              consider_ml_stock: considerMlStock,
            },
          });
          setRepriceProgress({ done: Math.min(offset + batch.length, ids.length), total: ids.length });
        }
      } else {
        await runPriceStock({
          data: { company_id: companyId, include_stores: true, only_price: syncScope === "preco", consider_ml_stock: considerMlStock },
        });
      }
      await qc.invalidateQueries({ queryKey: ["ps-products"] });
      await doAudit();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao precificar novamente");
    } finally {
      setRepricing(false);
      setRepriceProgress(null);
    }
  }


  async function doPush() {
    if (!companyId) return;
    setPushing(true);
    try {
      await enqueuePush({
        data: {
          company_id: companyId,
          product_ids: ids,
          scope: syncScope,
          include_stores: true,
          only_changed: true,
        },
      });
      setFlowOpen(false);
      toast.success("Sincronização enfileirada para o Bling e as multilojas.");
      await qc.invalidateQueries({ queryKey: ["bling-push-progress"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enfileirar sincronização");
    } finally { setPushing(false); }
  }

  const scopeLabel = useMemo(() => {
    if (scope === "selected") return `${selectedIds.length.toLocaleString("pt-BR")} produto(s) selecionado(s)`;
    if (scope === "changed") return changedQuery.isLoading ? "Carregando alterados…" : `${changedIds.length.toLocaleString("pt-BR")} produto(s) alterado(s)`;
    return "Todos os produtos desta empresa";
  }, [scope, selectedIds.length, changedIds.length, changedQuery.isLoading]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Wand2 className="h-5 w-5" /> Preço e Estoque</CardTitle>
        <CardDescription>
          Aplique preço e estoque nos produtos e sincronize com o Bling e as multilojas — sempre com validação da política de precificação.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PricingPolicyAlert companyId={companyId} />

        {/* Filtros */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Label className="text-xs text-muted-foreground">Buscar (SKU ou nome)</Label>
            <div className="flex gap-2">
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setSearch(searchInput.trim()); }}
                placeholder="Ex.: HA6532"
              />
              <Button variant="outline" onClick={() => setSearch(searchInput.trim())}>Buscar</Button>
            </div>
          </div>
          <div className="w-[180px]">
            <Label className="text-xs text-muted-foreground">Situação</Label>
            <Select value={situacao} onValueChange={setSituacao}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="A">Ativo</SelectItem>
                <SelectItem value="I">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-[260px]">
            <Label className="text-xs text-muted-foreground">Aplicar em</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os produtos</SelectItem>
                <SelectItem value="selected" disabled={selectedIds.length === 0}>
                  Somente selecionados ({selectedIds.length.toLocaleString("pt-BR")})
                </SelectItem>
                <SelectItem value="changed">Somente o que mudou</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">{scopeLabel}</Badge>
          <Button size="sm" variant="outline" onClick={selectAllFiltered} disabled={!companyId}>
            Selecionar todos do filtro ({total.toLocaleString("pt-BR")})
          </Button>
          {selectedIds.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>Limpar seleção</Button>
          )}
        </div>

        {/* Tabela */}
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 w-10">
                  <Checkbox checked={allPageSelected} onCheckedChange={(v) => togglePage(!!v)} />
                </th>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-left">Produto</th>
                <th className="px-3 py-2 text-right">Custo</th>
                <th className="px-3 py-2 text-right">Preço</th>
                <th className="px-3 py-2 text-center">Situação</th>
              </tr>
            </thead>
            <tbody>
              {products.isLoading ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  <Loader2 className="inline h-4 w-4 animate-spin" /> Carregando…
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Nenhum produto encontrado.</td></tr>
              ) : rows.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selectedIds.includes(p.id)}
                      onCheckedChange={(v) =>
                        setSelectedIds((prev) => (v ? [...prev, p.id] : prev.filter((x) => x !== p.id)))
                      }
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{p.codigo ?? "—"}</td>
                  <td className="px-3 py-2">{p.nome ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{brl(p.preco_custo)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{brl(p.preco)}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant={p.situacao === "A" ? "default" : "secondary"}>{p.situacao === "A" ? "Ativo" : "Inativo"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PageNumbers page={page} pageSize={pageSize} total={total} onChange={setPage} />

        {/* Ações */}
        <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="font-medium text-sm">Aplicar preço e estoque (via fornecedor)</div>
            <div className="flex items-center gap-2">
              <Switch id="manual-stock-ml" checked={considerMlStock} onCheckedChange={setConsiderMlStock} disabled={applying || repricing} />
              <Label htmlFor="manual-stock-ml">Considerar estoque do Mercado Livre</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Localiza o produto no fornecedor pelo prefixo do SKU, atualiza custo e estoque e recalcula o preço
              de venda pela política de precificação — no Bling e nas multilojas.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!companyId || scopeDisabled || applying} onClick={() => { setApplyMode("preco"); setApplyOpen(true); }}>
                {applying && applyMode === "preco" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Aplicar somente preço
              </Button>
              <Button
                variant="secondary"
                disabled={!companyId || scopeDisabled || applying}
                onClick={() => { setApplyMode("estoque"); setApplyOpen(true); }}
              >
                {applying && applyMode === "estoque" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Aplicar somente estoque
              </Button>
              <Button variant="outline" disabled={!companyId || scopeDisabled || applying} onClick={() => { setApplyMode("ambos"); setApplyOpen(true); }}>
                {applying && applyMode === "ambos" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Aplicar preço e estoque
              </Button>
              <Button variant="outline" disabled={!companyId || scopeDisabled || zeroing} onClick={doZeroStock}>
                {zeroing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Zerar estoque
              </Button>
              <Button variant="outline" disabled={!companyId || scopeDisabled || settingStock} onClick={() => setSetStockOpen(true)}>
                {settingStock ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Setar estoque para…
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-medium text-sm">Sincronizar com o Bling + Multilojas</div>
            <Select value={syncScope} onValueChange={(v) => setSyncScope(v as SyncScope)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="preco">Somente preço</SelectItem>
                <SelectItem value="estoque">Somente estoque</SelectItem>
                <SelectItem value="ambos">Preço e estoque</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A sincronização sempre atinge o produto no Bling e os preços das multilojas vinculadas.
            </p>
            <Button variant="secondary" disabled={!companyId || scopeDisabled} onClick={startFlow}>
              <Upload className="mr-2 h-4 w-4" /> Sincronizar
            </Button>
          </div>
        </div>
      </CardContent>

      {/* Modal: política antes de aplicar o preço */}
      <PricingPolicyDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        companyId={companyId}
        title="Confirmar política de precificação"
        description={
          applyMode === "estoque"
            ? `Somente o estoque de ${scopeLabel.toLowerCase()} será atualizado — nenhum preço é alterado.`
            : `Os preços de ${scopeLabel.toLowerCase()} serão recalculados com a política abaixo${applyMode === "preco" ? " (o estoque não será alterado)" : ""}.`
        }
        confirmLabel="Aprovar e aplicar"
        onConfirm={doApply}
        confirming={applying}
      />

      {/* Modal: setar estoque para um valor fixo */}
      <Dialog open={setStockOpen} onOpenChange={setSetStockOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Setar estoque para um valor</DialogTitle>
            <DialogDescription>
              O estoque de {scopeLabel.toLowerCase()} será definido para o número abaixo. Depois, sincronize para enviar ao Bling.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="set-stock-value">Estoque</Label>
            <Input
              id="set-stock-value"
              type="number"
              min={0}
              step={1}
              value={setStockValue}
              onChange={(e) => setSetStockValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doSetStock(); }}
              autoFocus
            />
            {settingStock && (
              <p className="text-sm text-muted-foreground">
                Processando em lotes seguros… {setStockProgress.toLocaleString("pt-BR")} produto(s)
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSetStockOpen(false)}>Cancelar</Button>
            <Button onClick={doSetStock} disabled={settingStock || setStockValue.trim() === ""}>
              {settingStock ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fluxo de sincronização */}
      <Dialog open={flowOpen} onOpenChange={setFlowOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> Sincronizar preço e estoque
            </DialogTitle>
            <DialogDescription>
              Escopo: {scopeLabel} · Envio: {syncScope === "preco" ? "somente preço" : syncScope === "estoque" ? "somente estoque" : "preço e estoque"} (Bling + multilojas).
            </DialogDescription>
          </DialogHeader>

          {step === "policy" && (
            <PolicyInline companyId={companyId} />
          )}

          {step === "audit" && audit && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                <span>
                  <strong>{audit.divergentes.toLocaleString("pt-BR")}</strong> produto(s) com preço diferente do que a
                  política de precificação atual geraria ({audit.ok.toLocaleString("pt-BR")} conferem).
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">SKU</th>
                      <th className="px-2 py-1 text-left">Produto</th>
                      <th className="px-2 py-1 text-right">Atual</th>
                      <th className="px-2 py-1 text-right">Política</th>
                      <th className="px-2 py-1 text-right">Dif.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.items.map((i, k) => (
                      <tr key={k} className="border-t">
                        <td className="px-2 py-1 font-mono">{i.sku ?? "—"}</td>
                        <td className="px-2 py-1">{i.nome ?? "—"}</td>
                        <td className="px-2 py-1 text-right">{brl(i.preco_atual)}</td>
                        <td className="px-2 py-1 text-right">{brl(i.preco_esperado)}</td>
                        <td className="px-2 py-1 text-right">{brl(i.diferenca)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(repricing || repriceProgress) && (
                <p className="text-xs text-muted-foreground">
                  Precificando em lotes…{" "}
                  {repriceProgress
                    ? `${repriceProgress.done.toLocaleString("pt-BR")} de ${repriceProgress.total.toLocaleString("pt-BR")} produto(s)`
                    : "iniciando"}
                </p>
              )}
              <p className="text-xs text-muted-foreground">

                Você pode precificar novamente (uma nova auditoria será feita) ou seguir mesmo assim.
              </p>
            </div>
          )}

          {step === "ready" && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 rounded-md border border-emerald-400 bg-emerald-50 px-3 py-2 text-emerald-800">
                <CheckCircle2 className="h-4 w-4" />
                {needsPriceCheck
                  ? <span>Auditoria de preço concluída: todos os preços conferem com a política atual.</span>
                  : <span>Envio somente de estoque — não depende da política de preços.</span>}
              </div>
              {audit && (
                <div className="text-xs text-muted-foreground">
                  Avaliados: {audit.avaliados.toLocaleString("pt-BR")} · Sem base de cálculo: {audit.sem_base.toLocaleString("pt-BR")}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFlowOpen(false)}>Cancelar</Button>
            {step === "policy" && (
              <Button onClick={doAudit} disabled={auditing}>
                {auditing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Seguir e auditar preços
              </Button>
            )}
            {step === "audit" && (
              <>
                <Button variant="secondary" onClick={doReprice} disabled={repricing || auditing}>
                  {repricing || auditing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Precificar novamente
                </Button>
                <Button variant="destructive" onClick={() => setStep("ready")}>Seguir mesmo assim</Button>
              </>
            )}
            {step === "ready" && (
              <Button onClick={doPush} disabled={pushing}>
                {pushing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Sincronizar agora
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Resumo da política renderizado dentro do fluxo de sincronização. */
function PolicyInline({ companyId }: { companyId: string | undefined }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className="rounded-md border p-3 text-sm">
        Revise a política de precificação vigente antes de enviar os preços.
        <Button variant="link" className="px-1" onClick={() => setOpen(true)}>Ver política</Button>
      </div>
      <PricingPolicyDialog
        open={open}
        onOpenChange={setOpen}
        companyId={companyId}
        title="Política de precificação vigente"
        description="Confira as regras que geraram os preços que serão enviados."
        confirmLabel="Fechar"
        onConfirm={() => setOpen(false)}
      />
    </>
  );
}
