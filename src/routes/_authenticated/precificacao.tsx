import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Calculator, Save, RotateCcw, Percent } from "lucide-react";
import { listMyCompanies } from "@/lib/companies.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import {
  getPricingSettings,
  upsertPricingSettings,
  getProductCostInputs,
  upsertProductCostOverride,
  searchProductsForPricing,
  type PricingSettings,
} from "@/lib/pricing.functions";
import { listMarketplaces } from "@/lib/marketplaces.functions";
import { PriceStockPanel } from "@/components/price-stock-panel";
import { computeCostBreakdown, fmtBRL } from "@/lib/pricing/cost";
import { pickPricingBand, fmtBandLabel, applyPriceAnchor, type ProfitBand, type PriceAnchor } from "@/lib/pricing/margin";

export const Route = createFileRoute("/_authenticated/precificacao")({
  component: PrecificacaoPage,
  head: () => ({
    meta: [
      { title: "Preço e Estoque — Precificação e Sincronização" },
      { name: "description", content: "Calcule o custo completo dos seus produtos combinando compra, embalagem, transporte, taxas e percentuais operacionais." },
      { property: "og:title", content: "Preço e Estoque — Precificação e Sincronização" },
      { property: "og:description", content: "Composição de custo base para precificação por marketplace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function toNum(v: string): number {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function fmtInput(n: number | null | undefined): string {
  if (n == null) return "";
  return String(n).replace(".", ",");
}

function PrecificacaoPage() {
  const qc = useQueryClient();
  const fetchCompanies = useServerFn(listMyCompanies);
  const fetchSettings = useServerFn(getPricingSettings);
  const saveSettings = useServerFn(upsertPricingSettings);
  const fetchInputs = useServerFn(getProductCostInputs);
  const saveOverride = useServerFn(upsertProductCostOverride);
  const searchProducts = useServerFn(searchProductsForPricing);
  const fetchMarketplaces = useServerFn(listMarketplaces);

  const companies = useQuery({ queryKey: ["companies"], queryFn: () => fetchCompanies() });
  const [companyId, setCompanyId] = useSelectedCompany();
  useEffect(() => {
    if (!companyId && companies.data && companies.data.length > 0) setCompanyId(companies.data[0].id);
  }, [companies.data, companyId]);

  const marketplaces = useQuery({
    queryKey: ["marketplaces", companyId],
    queryFn: () => companyId ? fetchMarketplaces({ data: { company_id: companyId } }) : Promise.resolve([]),
    enabled: !!companyId,
  });
  const [marketplaceId, setMarketplaceId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!marketplaceId && marketplaces.data && marketplaces.data.length > 0) {
      setMarketplaceId(marketplaces.data[0].id);
    }
  }, [marketplaces.data, marketplaceId]);

  const settings = useQuery({
    queryKey: ["pricing-settings", companyId],
    queryFn: () => fetchSettings({ data: { company_id: companyId! } }),
    enabled: !!companyId,
  });

  // Configurações (form)
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [bands, setBands] = useState<Array<{ min: string; max: string; margin: string }>>([]);
  const [anchors, setAnchors] = useState<Array<{ min: string; max: string; price: string }>>([]);
  const [stockCapDefault, setStockCapDefault] = useState<string>("");
  useEffect(() => {
    if (!settings.data) return;
    setCfg({
      embalagem_default: fmtInput(settings.data.embalagem_default),
      transporte_default: fmtInput(settings.data.transporte_default),
      taxa_operacional_valor: fmtInput(settings.data.taxa_operacional_valor),
      taxa_operacional_min_custo: fmtInput(settings.data.taxa_operacional_min_custo),
      frete_medio_percent: fmtInput(settings.data.frete_medio_percent),
      custo_fixo_percent: fmtInput(settings.data.custo_fixo_percent),
    });
    setBands(
      settings.data.profit_bands.map((b) => ({
        min: fmtInput(b.min),
        max: b.max == null ? "" : fmtInput(b.max),
        margin: fmtInput(b.margin_percent),
      })),
    );
    setAnchors(
      (settings.data.price_anchors ?? []).map((a) => ({
        min: fmtInput(a.min),
        max: fmtInput(a.max),
        price: fmtInput(a.price),
      })),
    );
    setStockCapDefault(settings.data.stock_cap_default == null ? "" : String(settings.data.stock_cap_default));
  }, [settings.data]);
  const [savingCfg, setSavingCfg] = useState(false);
  function parsedAnchors(): PriceAnchor[] {
    const out: PriceAnchor[] = [];
    for (const a of anchors) {
      const min = toNum(a.min);
      const max = toNum(a.max);
      const price = toNum(a.price);
      if (price > 0 && max >= min) out.push({ min, max, price });
    }
    return out;
  }
  function parsedStockCapDefault(): number | null {
    const t = stockCapDefault.trim();
    if (t === "") return null;
    const n = Math.floor(Number(t.replace(",", ".")));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  async function handleSaveSettings() {
    if (!companyId) return;
    setSavingCfg(true);
    try {
      await saveSettings({
        data: {
          company_id: companyId,
          embalagem_default: toNum(cfg.embalagem_default),
          transporte_default: toNum(cfg.transporte_default),
          taxa_operacional_valor: toNum(cfg.taxa_operacional_valor),
          taxa_operacional_min_custo: toNum(cfg.taxa_operacional_min_custo),
          frete_medio_percent: toNum(cfg.frete_medio_percent),
          custo_fixo_percent: toNum(cfg.custo_fixo_percent),
          devolucao_percent: 0,
          stock_cap_default: parsedStockCapDefault(),
          price_anchors: parsedAnchors(),
        },
      });
      toast.success("Configurações de precificação salvas.");
      await qc.invalidateQueries({ queryKey: ["pricing-settings", companyId] });
      await qc.invalidateQueries({ queryKey: ["product-cost-inputs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally { setSavingCfg(false); }
  }

  const [savingBands, setSavingBands] = useState(false);
  async function handleSaveBands() {
    if (!companyId || !settings.data) return;
    const parsed: ProfitBand[] = bands.map((b) => ({
      min: toNum(b.min),
      max: b.max.trim() === "" ? null : toNum(b.max),
      margin_percent: toNum(b.margin),
    }));
    const sorted = [...parsed].sort((a, b) => a.min - b.min);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.max != null && curr.min < prev.max) {
        toast.error("As faixas não podem se sobrepor. Ajuste os limites.");
        return;
      }
    }
    setSavingBands(true);
    try {
      const s: PricingSettings = settings.data;
      await saveSettings({
        data: {
          company_id: companyId,
          embalagem_default: s.embalagem_default,
          transporte_default: s.transporte_default,
          taxa_operacional_valor: s.taxa_operacional_valor,
          taxa_operacional_min_custo: s.taxa_operacional_min_custo,
          frete_medio_percent: s.frete_medio_percent,
          custo_fixo_percent: s.custo_fixo_percent,
          devolucao_percent: s.devolucao_percent,
          profit_bands: sorted,
          price_anchors: parsedAnchors(),
          stock_cap_default: parsedStockCapDefault(),
        },
      });
      toast.success("Política de precificação salva.");
      await qc.invalidateQueries({ queryKey: ["pricing-settings", companyId] });
      await qc.invalidateQueries({ queryKey: ["product-cost-inputs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar política");
    } finally { setSavingBands(false); }
  }

  function addBand() {
    const last = bands[bands.length - 1];
    const nextMin = last && last.max
      ? String(Math.round((toNum(last.max) + 0.01) * 100) / 100).replace(".", ",")
      : "0";
    setBands([...bands, { min: nextMin, max: "", margin: "0" }]);
  }
  function removeBand(idx: number) {
    setBands(bands.filter((_, i) => i !== idx));
  }
  function updateBand(idx: number, key: "min" | "max" | "margin", value: string) {
    setBands(bands.map((b, i) => (i === idx ? { ...b, [key]: value } : b)));
  }

  // Busca de produto
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const results = useQuery({
    queryKey: ["pricing-search", companyId, search],
    queryFn: () => searchProducts({ data: { company_id: companyId!, q: search || undefined } }),
    enabled: !!companyId,
  });

  const inputs = useQuery({
    queryKey: ["product-cost-inputs", companyId, productId],
    queryFn: () => fetchInputs({ data: { company_id: companyId!, product_id: productId! } }),
    enabled: !!companyId && !!productId,
  });

  // Embalagem e Transporte vêm SEMPRE do fornecedor do produto (fallback: padrão do sistema).
  // Apenas Taxa Operacional pode ter override por produto.
  const [taxaOpOverride, setTaxaOpOverride] = useState<string>("");
  const [taxaOpUseOverride, setTaxaOpUseOverride] = useState(false);
  const [productStockCap, setProductStockCap] = useState<string>("");

  useEffect(() => {
    if (!inputs.data) return;
    const ov = inputs.data.override;
    setTaxaOpOverride(ov?.taxa_operacional != null ? fmtInput(ov.taxa_operacional) : "");
    setTaxaOpUseOverride(ov?.taxa_operacional != null);
    setProductStockCap(ov?.stock_cap == null ? "" : String(ov.stock_cap));
  }, [inputs.data]);

  const breakdown = useMemo(() => {
    if (!inputs.data) return null;
    const s = inputs.data.settings;
    const supplier = inputs.data.supplier;

    const embalagem = supplier?.preco_embalagem ?? s.embalagem_default;
    const transporte = supplier?.preco_transporte ?? s.transporte_default;

    const taxa_operacional_valor = taxaOpUseOverride ? toNum(taxaOpOverride) : s.taxa_operacional_valor;

    // Devolução do fornecedor entra apenas na fórmula do preço de venda (markup),
    // não no custo completo — caso contrário seria contada duas vezes.
    return computeCostBreakdown({
      valor_compra: inputs.data.product.valor_compra,
      embalagem,
      transporte,
      taxa_operacional_valor,
      taxa_operacional_min_custo: s.taxa_operacional_min_custo,
      frete_medio_percent: s.frete_medio_percent,
      custo_fixo_percent: s.custo_fixo_percent,
      devolucao_percent: s.devolucao_percent,
    });
  }, [inputs.data, taxaOpUseOverride, taxaOpOverride]);

  const selectedMarketplace = useMemo(
    () => marketplaces.data?.find((m) => m.id === marketplaceId) ?? null,
    [marketplaces.data, marketplaceId],
  );

  const simulation = useMemo(() => {
    if (!inputs.data || !breakdown) return null;
    const supplier = inputs.data.supplier;
    const raw = pickPricingBand(inputs.data.settings.profit_bands, {
      custo_completo: breakdown.custo_completo,
      comissao_percent: selectedMarketplace?.taxa_percent ?? 0,
      devolucao_percent: supplier?.taxa_devolucao ?? 0,
      taxa_promocao_percent: supplier?.taxa_promocao ?? 0,
    });
    if (!raw) return null;
    const anchored = applyPriceAnchor(raw.preco_venda, inputs.data.settings.price_anchors);
    return { ...raw, preco_venda: anchored ?? raw.preco_venda, anchored: anchored != null && anchored !== raw.preco_venda };
  }, [inputs.data, breakdown, selectedMarketplace]);




  const [savingOv, setSavingOv] = useState(false);
  function parsedProductStockCap(): number | null {
    const t = productStockCap.trim();
    if (t === "") return null;
    const n = Math.floor(Number(t.replace(",", ".")));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  async function handleSaveOverride() {
    if (!companyId || !productId) return;
    setSavingOv(true);
    try {
      await saveOverride({
        data: {
          company_id: companyId,
          product_id: productId,
          embalagem: null,
          transporte: null,
          taxa_operacional: taxaOpUseOverride ? toNum(taxaOpOverride) : null,
          stock_cap: parsedProductStockCap(),
        },
      });
      toast.success("Valores do produto salvos.");
      await qc.invalidateQueries({ queryKey: ["product-cost-inputs", companyId, productId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally { setSavingOv(false); }
  }
  async function handleClearOverride() {
    if (!companyId || !productId) return;
    setSavingOv(true);
    try {
      await saveOverride({
        data: { company_id: companyId, product_id: productId, embalagem: null, transporte: null, taxa_operacional: null, stock_cap: null },
      });
      toast.success("Override do produto removido.");
      await qc.invalidateQueries({ queryKey: ["product-cost-inputs", companyId, productId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
    } finally { setSavingOv(false); }
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Calculator className="h-6 w-6" /> Preço e Estoque
          </h1>
          <p className="text-sm text-muted-foreground">
            Composição de custo, política de precificação e aplicação/sincronização de preço e estoque.
          </p>
        </div>
        <Select value={companyId ?? ""} onValueChange={(v) => { setCompanyId(v || undefined); setProductId(null); }}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Selecionar empresa" /></SelectTrigger>
          <SelectContent>
            {companies.data?.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </header>

      <PriceStockPanel companyId={companyId} />


      {/* Configurações */}
      <Card>
        <CardHeader>
          <CardTitle>Configurações do sistema</CardTitle>
          <CardDescription>
            Valores padrão e percentuais aplicados na composição de custo. Alterar aqui recalcula a base de todos os produtos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Field label="Embalagem padrão (R$)" value={cfg.embalagem_default} onChange={(v) => setCfg({ ...cfg, embalagem_default: v })} />
                <Field label="Transporte padrão (R$)" value={cfg.transporte_default} onChange={(v) => setCfg({ ...cfg, transporte_default: v })} />
                <Field label="Taxa operacional (R$)" value={cfg.taxa_operacional_valor} onChange={(v) => setCfg({ ...cfg, taxa_operacional_valor: v })} />
                <Field label="Aplicar somente se custo ≥ (R$)" value={cfg.taxa_operacional_min_custo} onChange={(v) => setCfg({ ...cfg, taxa_operacional_min_custo: v })} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Frete médio (%)" value={cfg.frete_medio_percent} onChange={(v) => setCfg({ ...cfg, frete_medio_percent: v })} />
                <Field label="Custo fixo (%)" value={cfg.custo_fixo_percent} onChange={(v) => setCfg({ ...cfg, custo_fixo_percent: v })} />
              </div>
              <div className="flex justify-end">
                <Button onClick={handleSaveSettings} disabled={savingCfg || !companyId}>
                  {savingCfg ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Salvar configurações
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Política de Precificação */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2"><Percent className="h-5 w-5" /> Política de Precificação</CardTitle>
              <CardDescription>
                Margens de lucro por faixa de preço de venda. O sistema encontra automaticamente a faixa
                em que o preço simulado se enquadra e aplica a margem correspondente.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={addBand} disabled={!settings.data}>
                Adicionar faixa
              </Button>
              <Button size="sm" onClick={handleSaveBands} disabled={savingBands || !companyId}>
                {savingBands ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Salvar política
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {settings.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">De (R$)</th>
                    <th className="px-3 py-2 font-medium">Até (R$)</th>
                    <th className="px-3 py-2 font-medium">Lucro (%)</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {bands.map((b, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">
                        <Input inputMode="decimal" value={b.min} onChange={(e) => updateBand(i, "min", e.target.value)} />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          inputMode="decimal"
                          placeholder="Sem teto"
                          value={b.max}
                          onChange={(e) => updateBand(i, "max", e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input inputMode="decimal" value={b.margin} onChange={(e) => updateBand(i, "margin", e.target.value)} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => removeBand(i)} disabled={bands.length <= 1}>
                          Remover
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-3">
                Deixe o campo <strong>Até</strong> vazio para representar a faixa mais alta (sem teto).
                As faixas não podem se sobrepor.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Âncoras de Preço */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Âncoras de Preço</CardTitle>
              <CardDescription>
                Se o preço calculado cair dentro de uma faixa, o sistema grava o <strong>preço final</strong> definido aqui.
                Exemplo: entre R$ 78,90 e R$ 85,00 → preço 78,90.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAnchors([...anchors, { min: "0", max: "0", price: "0" }])}
                disabled={!settings.data}
              >
                Adicionar âncora
              </Button>
              <Button size="sm" onClick={handleSaveSettings} disabled={savingCfg || !companyId}>
                {savingCfg ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Salvar âncoras
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {anchors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma âncora configurada. As âncoras são opcionais — o preço calculado pela política é usado como está.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">De (R$)</th>
                    <th className="px-3 py-2 font-medium">Até (R$)</th>
                    <th className="px-3 py-2 font-medium">Preço final (R$)</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {anchors.map((a, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">
                        <Input inputMode="decimal" value={a.min}
                          onChange={(e) => setAnchors(anchors.map((x, j) => j === i ? { ...x, min: e.target.value } : x))} />
                      </td>
                      <td className="px-3 py-2">
                        <Input inputMode="decimal" value={a.max}
                          onChange={(e) => setAnchors(anchors.map((x, j) => j === i ? { ...x, max: e.target.value } : x))} />
                      </td>
                      <td className="px-3 py-2">
                        <Input inputMode="decimal" value={a.price}
                          onChange={(e) => setAnchors(anchors.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setAnchors(anchors.filter((_, j) => j !== i))}>
                          Remover
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Selecionar produto</CardTitle>
          <CardDescription>Busque por código ou nome. A composição é calculada abaixo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Buscar por código ou nome…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-56 overflow-y-auto rounded border divide-y">
            {results.isLoading ? (
              <div className="p-3 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Buscando…</div>
            ) : (results.data ?? []).length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">Nenhum produto encontrado.</div>
            ) : (
              (results.data ?? []).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setProductId(p.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 ${productId === p.id ? "bg-muted" : ""}`}
                >
                  <span className="font-mono text-xs text-muted-foreground mr-2">{p.codigo}</span>
                  {p.nome}
                  <span className="text-xs text-muted-foreground ml-2">custo {fmtBRL(p.valor_compra)}</span>
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Composição de custo */}
      {productId && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardTitle>Composição de Custo</CardTitle>
                <CardDescription>
                  {inputs.data ? (
                    <>
                      <span className="font-mono text-xs">{inputs.data.product.codigo}</span> — {inputs.data.product.nome}
                      {inputs.data.supplier && <span className="ml-2">· Fornecedor: <strong>{inputs.data.supplier.nome}</strong></span>}
                    </>
                  ) : "Carregando…"}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleClearOverride} disabled={savingOv}>
                  <RotateCcw className="h-4 w-4 mr-2" /> Remover overrides
                </Button>
                <Button size="sm" onClick={handleSaveOverride} disabled={savingOv}>
                  {savingOv ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Salvar valores do produto
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!inputs.data || !breakdown ? (
              <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                {/* Entradas ajustáveis */}
                <div className="space-y-4">
                  {!inputs.data.supplier && (
                    <div className="rounded-md border-2 border-destructive bg-destructive/10 text-destructive px-3 py-2 text-sm">
                      <strong>Fornecedor não encontrado</strong> para este produto (SKU <span className="font-mono">{inputs.data.product.codigo}</span>).
                      Sem fornecedor não é possível obter Embalagem, Transporte e Taxa de Devolução —
                      a composição abaixo pode ficar incorreta. Cadastre o fornecedor ou ajuste o prefixo do SKU.
                    </div>
                  )}

                  <Row label="Valor de Compra" value={fmtBRL(breakdown.valor_compra)} muted />

                  <SupplierValueRow
                    label="Embalagem"
                    supplierValue={inputs.data.supplier?.preco_embalagem ?? null}
                    supplierLabel={inputs.data.supplier?.nome ?? null}
                    fallbackValue={inputs.data.settings.embalagem_default}
                  />
                  <SupplierValueRow
                    label="Transporte"
                    supplierValue={inputs.data.supplier?.preco_transporte ?? null}
                    supplierLabel={inputs.data.supplier?.nome ?? null}
                    fallbackValue={inputs.data.settings.transporte_default}
                  />


                  <div className="rounded border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Taxa Operacional</Label>
                      <label className="text-xs flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={taxaOpUseOverride} onChange={(e) => setTaxaOpUseOverride(e.target.checked)} />
                        Override neste produto
                      </label>
                    </div>
                    <Input
                      inputMode="decimal"
                      value={taxaOpUseOverride ? taxaOpOverride : fmtInput(inputs.data.settings.taxa_operacional_valor)}
                      onChange={(e) => setTaxaOpOverride(e.target.value)}
                      disabled={!taxaOpUseOverride}
                    />
                    <div className="text-xs text-muted-foreground">
                      Regra: aplica somente se custo ≥ {fmtBRL(inputs.data.settings.taxa_operacional_min_custo)}.{" "}
                      {breakdown.taxa_operacional_aplicada ? (
                        <span className="text-emerald-700">Aplicada.</span>
                      ) : (
                        <span>Não aplicada neste produto.</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded border p-3 flex items-center justify-between">
                    <div>
                      <Label className="text-xs">Taxa de Devolução</Label>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {inputs.data.supplier
                          ? <>Fornecedor: <strong>{inputs.data.supplier.nome}</strong></>
                          : <span className="text-destructive">Sem fornecedor — usando 0%</span>}
                      </div>
                    </div>
                    <span className="font-mono tabular-nums text-sm">
                      {fmtPct(inputs.data.supplier?.taxa_devolucao ?? 0)}
                    </span>
                  </div>

                  <div className="rounded border p-3 space-y-2">
                    <Label className="text-xs">Teto de estoque deste produto (opcional)</Label>
                    <Input
                      inputMode="numeric"
                      placeholder="Herda do fornecedor ou padrão da empresa"
                      value={productStockCap}
                      onChange={(e) => setProductStockCap(e.target.value.replace(/[^0-9]/g, ""))}
                    />
                    <div className="text-[11px] text-muted-foreground">
                      Ordem: produto → fornecedor ({inputs.data.supplier?.nome ?? "—"}) → padrão da empresa.
                    </div>
                  </div>
                </div>

                {/* Composição — resultado */}
                <div className="space-y-1">
                  <Row label="Valor de Compra" value={fmtBRL(breakdown.valor_compra)} />
                  <Row label="Embalagem" value={fmtBRL(breakdown.embalagem)} />
                  <Row label="Transporte" value={fmtBRL(breakdown.transporte)} />
                  <Row label="Taxa Operacional" value={fmtBRL(breakdown.taxa_operacional)} />
                  <Divider />
                  <Row label="CMV" value={fmtBRL(breakdown.cmv)} strong />
                  <Row label={`Frete (${fmtPct(inputs.data.settings.frete_medio_percent)})`} value={fmtBRL(breakdown.frete)} />
                  <Row label="CMV Total" value={fmtBRL(breakdown.cmv_total)} strong />
                  <Row label={`Custo Fixo (${fmtPct(inputs.data.settings.custo_fixo_percent)})`} value={fmtBRL(breakdown.custo_fixo)} />
                  <Row label={`Devolução (${fmtPct(inputs.data.supplier?.taxa_devolucao ?? 0)})`} value={fmtBRL(breakdown.devolucao)} />
                  <Divider />
                  <div className="mt-3 rounded-md border-2 border-primary bg-primary/5 px-4 py-3 flex items-center justify-between">
                    <span className="text-sm font-semibold uppercase tracking-wide">Custo Completo</span>
                    <span className="text-2xl font-bold text-primary">{fmtBRL(breakdown.custo_completo)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Este é o custo base consumido pelas próximas seções do módulo de precificação.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Simulação de preço via Política de Precificação */}
      {productId && inputs.data && breakdown && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardTitle>Simulação de Preço de Venda</CardTitle>
                <CardDescription>
                  Escolha o marketplace. O sistema testa cada faixa da política e usa a margem cuja faixa
                  contém o preço simulado.
                </CardDescription>
              </div>
              <Select value={marketplaceId ?? ""} onValueChange={(v) => setMarketplaceId(v || undefined)}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Marketplace" /></SelectTrigger>
                <SelectContent>
                  {marketplaces.data?.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome} · {fmtPct(m.taxa_percent)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {!marketplaces.data || marketplaces.data.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Cadastre marketplaces em <strong>Marketplaces</strong> para simular o preço.
              </div>
            ) : !selectedMarketplace ? (
              <div className="text-sm text-muted-foreground">Selecione um marketplace.</div>
            ) : !simulation ? (
              <div className="rounded-md border-2 border-destructive bg-destructive/10 text-destructive px-3 py-2 text-sm">
                Não foi possível calcular o preço — verifique custo, política e taxas.
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-1">
                  <Row label="Custo Completo" value={fmtBRL(breakdown.custo_completo)} muted />
                  <Row label={`Comissão ${selectedMarketplace.nome}`} value={fmtPct(selectedMarketplace.taxa_percent)} />
                  <Row label="Devolução (fornecedor)" value={fmtPct(inputs.data.supplier?.taxa_devolucao ?? 0)} />
                  <Row label="Promoção (fornecedor)" value={fmtPct(inputs.data.supplier?.taxa_promocao ?? 0)} />
                  <Divider />
                  <Row label="Faixa aplicada" value={fmtBandLabel(simulation.band)} strong />
                  <Row label="Margem" value={fmtPct(simulation.margin_percent)} strong />
                  <Row label="Lucro líquido estimado" value={fmtBRL(simulation.lucro_liquido)} />
                </div>
                <div className="space-y-3">
                  <div className="rounded-md border-2 border-primary bg-primary/5 px-4 py-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Preço de venda sugerido</div>
                    <div className="text-3xl font-bold text-primary mt-1">{fmtBRL(simulation.preco_venda)}</div>
                    <div className="text-xs text-muted-foreground mt-2">
                      Fórmula: custo ÷ (1 − margem − comissão − devolução − promoção).
                    </div>
                  </div>
                  {!simulation.matched && simulation.fallback_reason && (
                    <div className="rounded-md border border-amber-400 bg-amber-50 text-amber-800 px-3 py-2 text-xs">
                      <strong>Atenção:</strong> {simulation.fallback_reason} Revise a política de precificação.
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function fmtPct(n: number): string {
  return `${(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 text-sm ${muted ? "text-muted-foreground" : ""}`}>
      <span className={strong ? "font-semibold" : ""}>{label}</span>
      <span className={`font-mono tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}

function Divider() { return <div className="border-t my-2" />; }

function SupplierValueRow({
  label, supplierValue, supplierLabel, fallbackValue,
}: {
  label: string;
  supplierValue: number | null;
  supplierLabel: string | null;
  fallbackValue: number;
}) {
  const usingSupplier = supplierValue != null;
  const value = usingSupplier ? supplierValue! : fallbackValue;
  return (
    <div className="rounded border p-3 flex items-center justify-between">
      <div>
        <Label className="text-xs">{label}</Label>
        <div className="text-xs text-muted-foreground mt-0.5">
          {usingSupplier
            ? <>Fornecedor: <strong>{supplierLabel ?? "—"}</strong></>
            : <>Sem fornecedor identificado — usando padrão do sistema</>}
        </div>
      </div>
      <span className="font-mono tabular-nums text-sm">{fmtBRL(value)}</span>
    </div>
  );
}

