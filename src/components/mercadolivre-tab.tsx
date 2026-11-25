import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Link2, ExternalLink, Play, Square, Zap, Unplug } from "lucide-react";
import { PageNumbers } from "@/components/page-numbers";
import {
  getMlStatus,
  getMlAuthUrl,
  disconnectMl,
  startMlMapping,
  cancelMlMapping,
  getMlMapJob,
  getMlStats,
  listMlMatches,
  searchCompanyProducts,
  mapSingleProductOnMl,
} from "@/lib/mercadolivre.functions";

const PAGE_SIZE = 50;

function money(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function MercadoLivreTab({ companyId }: { companyId?: string }) {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getMlStatus);
  const fetchAuthUrl = useServerFn(getMlAuthUrl);
  const doDisconnect = useServerFn(disconnectMl);
  const doStart = useServerFn(startMlMapping);
  const doCancel = useServerFn(cancelMlMapping);
  const fetchJob = useServerFn(getMlMapJob);
  const fetchStats = useServerFn(getMlStats);
  const fetchMatches = useServerFn(listMlMatches);

  const doSearchProducts = useServerFn(searchCompanyProducts);
  const doMapSingle = useServerFn(mapSingleProductOnMl);

  const [skuSearch, setSkuSearch] = useState("");
  const [skuQuery, setSkuQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<string>("");
  const [mappingOne, setMappingOne] = useState(false);

  const [filter, setFilter] = useState<
    "todos" | "full" | "sem_full" | "nao_encontrado" | "com_estoque" | "sem_estoque"
  >("todos");
  const [zip, setZip] = useState("87050160");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setPage(1); }, [filter, search, companyId]);

  const status = useQuery({ queryKey: ["ml-status"], queryFn: () => fetchStatus() });

  const job = useQuery({
    queryKey: ["ml-job", companyId],
    queryFn: () => fetchJob({ data: { company_id: companyId! } }),
    enabled: !!companyId,
    refetchInterval: (q) => {
      const s = (q.state.data as { status?: string } | null)?.status;
      return s === "pendente" || s === "processando" ? 4000 : false;
    },
  });

  const running = job.data?.status === "pendente" || job.data?.status === "processando";

  const stats = useQuery({
    queryKey: ["ml-stats", companyId, job.data?.processed],
    queryFn: () => fetchStats({ data: { company_id: companyId! } }),
    enabled: !!companyId,
  });

  const matches = useQuery({
    queryKey: ["ml-matches", companyId, filter, search, page, job.data?.processed],
    queryFn: () =>
      fetchMatches({
        data: { company_id: companyId!, filter, search: search || undefined, page, page_size: PAGE_SIZE },
      }),
    enabled: !!companyId,
  });

  const connected = status.data?.status === "conectada";

  const progress = useMemo(() => {
    const total = job.data?.total ?? 0;
    const processed = job.data?.processed ?? 0;
    if (!total) return 0;
    return Math.min(100, Math.round((processed / total) * 100));
  }, [job.data]);

  async function handleConnect() {
    setBusy(true);
    try {
      const { url } = await fetchAuthUrl();
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await doDisconnect();
      await qc.invalidateQueries({ queryKey: ["ml-status"] });
      toast.success("Mercado Livre desconectado.");
    } finally { setBusy(false); }
  }

  async function handleStart() {
    if (!companyId) return;
    setBusy(true);
    try {
      const r = await doStart({ data: { company_id: companyId, zip_code: zip } });
      toast[r.already_running ? "info" : "success"](
        r.already_running ? "Já existe um mapeamento em andamento." : "Mapeamento iniciado.",
      );
      await qc.invalidateQueries({ queryKey: ["ml-job"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function handleCancel() {
    if (!job.data?.id) return;
    setBusy(true);
    try {
      await doCancel({ data: { job_id: job.data.id } });
      toast.success("Cancelamento solicitado.");
      await qc.invalidateQueries({ queryKey: ["ml-job"] });
    } finally { setBusy(false); }
  }

  const productOptions = useQuery({
    queryKey: ["ml-product-search", companyId, skuQuery],
    queryFn: () => doSearchProducts({ data: { company_id: companyId!, search: skuQuery } }),
    enabled: !!companyId && skuQuery.length >= 2,
  });

  async function handleMapOne() {
    if (!companyId || !selectedProduct) return;
    setMappingOne(true);
    try {
      const r = await doMapSingle({
        data: { company_id: companyId, product_id: selectedProduct, zip_code: zip },
      });
      if (r.error) toast.error(`${r.sku}: ${r.error}`);
      else if (r.qualifies) toast.success(`${r.sku} encontrado no ML com Full e estoque.`);
      else if (r.found)
        toast.info(
          `${r.sku} existe no Mercado Livre, mas nenhum anúncio tem Full com estoque para o CEP — por isso não entra na lista.`,
        );
      else toast.info(`${r.sku} não foi encontrado no Mercado Livre.`);
      await qc.invalidateQueries({ queryKey: ["ml-matches"] });
      await qc.invalidateQueries({ queryKey: ["ml-stats"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMappingOne(false);
    }
  }


  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" /> Mercado Livre
              </CardTitle>
              <CardDescription>
                Mapeia os SKUs únicos de todas as empresas da conta e verifica se existem no Mercado Livre e se há oferta com Frete Full.
                Busca por EAN e, quando não houver, pelo título.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {status.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : connected ? (
                <Badge variant="secondary">
                  Conectado{status.data?.nickname ? ` — ${status.data.nickname}` : ""}
                </Badge>
              ) : (
                <Badge variant="outline">Desconectado</Badge>
              )}
              {connected ? (
                <Button size="sm" variant="ghost" onClick={handleDisconnect} disabled={busy}>
                  <Unplug className="h-4 w-4 mr-1" /> Desconectar
                </Button>
              ) : (
                <Button size="sm" onClick={handleConnect} disabled={busy}>
                  <Link2 className="h-4 w-4 mr-1" /> Conectar Mercado Livre
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {status.data?.lastError && (
            <p className="text-xs text-destructive">{status.data.lastError}</p>
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <StatBox label="Produtos mapeados" value={stats.data?.mapeados ?? 0} />
            <StatBox label="Encontrados no ML" value={stats.data?.encontrados ?? 0} />
            <StatBox label="Com Frete Full" value={stats.data?.comFull ?? 0} />
            <StatBox label="Com estoque no ML" value={stats.data?.comEstoque ?? 0} />
          </div>

          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <p className="text-xs text-muted-foreground mb-1">CEP de destino (cálculo do frete)</p>
              <Input
                value={zip}
                onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="87050160"
                className="w-40 font-mono"
              />
            </div>
            <p className="text-xs text-muted-foreground pb-2">Padrão: Maringá/PR (87000-000)</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={handleStart} disabled={!connected || !companyId || busy || running}>
              <Play className="h-4 w-4 mr-1" /> Mapear todos os produtos da conta
            </Button>
            {running && (
              <Button size="sm" variant="destructive" onClick={handleCancel} disabled={busy}>
                <Square className="h-4 w-4 mr-1" /> Parar
              </Button>
            )}
            {job.data && (
              <span className="text-xs text-muted-foreground">
                Última execução: {job.data.status} — {(job.data.processed ?? 0).toLocaleString("pt-BR")} de{" "}
                {(job.data.total ?? 0).toLocaleString("pt-BR")}
              </span>
            )}
          </div>

          {running && <Progress value={progress} />}
          {job.data?.error && <p className="break-words text-xs text-muted-foreground">{job.data.error}</p>}

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-medium">Mapear um produto específico</p>
            <div className="flex items-end gap-2 flex-wrap">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Buscar por SKU, nome ou EAN</p>
                <div className="flex gap-2">
                  <Input
                    value={skuSearch}
                    onChange={(e) => setSkuSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setSelectedProduct("");
                        setSkuQuery(skuSearch.trim());
                      }
                    }}
                    placeholder="Ex.: HA6532"
                    className="w-56"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setSelectedProduct(""); setSkuQuery(skuSearch.trim()); }}
                    disabled={!companyId || skuSearch.trim().length < 2}
                  >
                    Buscar
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Produto</p>
                <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                  <SelectTrigger className="w-[420px] max-w-full">
                    <SelectValue
                      placeholder={
                        productOptions.isFetching
                          ? "Buscando…"
                          : (productOptions.data?.length ?? 0) === 0
                            ? "Nenhum produto — faça uma busca"
                            : "Selecione o produto"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(productOptions.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.codigo} — {p.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                onClick={handleMapOne}
                disabled={!connected || !companyId || !selectedProduct || mappingOne}
              >
                {mappingOne ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-1" />
                )}
                Mapear este produto
              </Button>
            </div>
          </div>

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">
              Resultados ({(matches.data?.count ?? 0).toLocaleString("pt-BR")})
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="full">Com Frete Full</SelectItem>
                  <SelectItem value="sem_full">Sem Frete Full</SelectItem>
                  <SelectItem value="nao_encontrado">Não encontrado</SelectItem>
                  <SelectItem value="com_estoque">Com estoque no ML</SelectItem>
                  <SelectItem value="sem_estoque">Sem estoque no ML</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Buscar por SKU, nome ou EAN…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {matches.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : (matches.data?.rows.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum resultado ainda. Conecte o Mercado Livre e rode o mapeamento.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">SKU</th>
                    <th className="text-left py-2 px-2">Produto</th>
                    <th className="text-left py-2 px-2">EAN</th>
                    <th className="text-left py-2 px-2">Situação</th>
                    <th className="text-left py-2 px-2">Full</th>
                    <th className="text-right py-2 px-2">Estoque</th>
                    <th className="text-right py-2 px-2">Menor preço</th>
                    <th className="text-right py-2 px-2">Frete</th>
                    <th className="text-right py-2 px-2">Total c/ frete</th>
                    <th className="text-left py-2 px-2">Casado por</th>
                    <th className="text-left py-2 px-2">Links</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.data?.rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 px-2 font-mono text-xs">{r.sku ?? "—"}</td>
                      <td className="py-2 px-2 max-w-[320px] truncate">{r.nome ?? "—"}</td>
                      <td className="py-2 px-2 font-mono text-xs">{r.ean ?? "—"}</td>
                      <td className="py-2 px-2">
                        {r.found ? (
                          <Badge variant="secondary">Encontrado</Badge>
                        ) : (
                          <Badge variant="outline">Não encontrado</Badge>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        {r.has_full ? (
                          <Badge title="Ofertas enviadas pelo galpão do ML (fulfillment)">
                            {r.full_offers} Full{r.best_is_full ? " • melhor" : ""}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {r.found ? (
                          r.has_stock ? (
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {(r.available_quantity ?? 0).toLocaleString("pt-BR")}
                            </span>
                          ) : (
                            <Badge variant="outline">Sem estoque</Badge>
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 px-2 text-right">{money(r.best_price ?? r.min_price)}</td>
                      <td className="py-2 px-2 text-right">
                        {r.best_shipping_cost === null || r.best_shipping_cost === undefined
                          ? "—"
                          : r.best_shipping_cost === 0
                            ? "Grátis"
                            : money(r.best_shipping_cost)}
                      </td>
                      <td className="py-2 px-2 text-right font-medium">
                        {money(r.best_total_price)}
                        {r.zip_code ? (
                          <span className="block text-[10px] text-muted-foreground">CEP {r.zip_code}</span>
                        ) : null}
                      </td>
                      <td className="py-2 px-2 text-xs text-muted-foreground">{r.match_by ?? "—"}</td>
                      <td className="py-2 px-2">
                        <OfferLinks permalink={r.permalink} offers={r.top_offers} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pt-3">
                <PageNumbers page={page} pageSize={PAGE_SIZE} total={matches.data?.count ?? 0} onChange={setPage} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type TopOffer = {
  item_id: string;
  price: number;
  shipping_cost: number;
  total_price: number;
  permalink: string | null;
  available_quantity: number;
};

function OfferLinks({ permalink, offers }: { permalink?: string | null; offers?: unknown }) {
  const list = (Array.isArray(offers) ? (offers as TopOffer[]) : []).filter((o) => o?.permalink);
  if (list.length === 0) {
    if (!permalink) return <span className="text-muted-foreground">—</span>;
    return (
      <a href={permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">
        Abrir <ExternalLink className="h-3 w-3" />
      </a>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {list.slice(0, 3).map((o, i) => (
        <a
          key={o.item_id}
          href={o.permalink!}
          target="_blank"
          rel="noreferrer"
          title={`Estoque ${o.available_quantity} · ${money(o.price)} + frete ${o.shipping_cost > 0 ? money(o.shipping_cost) : "grátis"}`}
          className="inline-flex items-center gap-1 whitespace-nowrap text-xs underline hover:text-foreground"
        >
          {i + 1}º {money(o.total_price)} <ExternalLink className="h-3 w-3" />
        </a>
      ))}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value.toLocaleString("pt-BR")}</p>
    </div>
  );
}
