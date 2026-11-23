import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart3, Loader2, RefreshCw, StopCircle, Plus, Trash2, History, AlertTriangle,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageNumbers } from "@/components/page-numbers";
import { listMyCompanies } from "@/lib/companies.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import { useAccess } from "@/hooks/use-access";
import { RepasseTab } from "@/components/repasse-tab";
import {
  startOrdersSync, getOrdersSyncStatus, cancelOrdersSync, listOrdersSyncHistory,
  getSalesKpis, getDreReport, listOrders, getOrderDetail, listDreExpenses, saveDreExpense, deleteDreExpense,
} from "@/lib/bi.functions";

export const Route = createFileRoute("/_authenticated/bi")({
  component: BiPage,
  head: () => ({
    meta: [
      { title: "BI, DRE e Repasses | Ajusta-e" },
      { name: "description", content: "Vendas do Bling, demonstrativo de resultado e cadastro de repasses com custos e divisão por empresa." },
      { property: "og:title", content: "BI, DRE e Repasses | Ajusta-e" },
      { property: "og:description", content: "Indicadores de vendas, custos, resultado e repasses do período por empresa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const brl = (v: unknown) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
const UF_REGIAO: Record<string, string> = {
  AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
  AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste", PE: "Nordeste",
  PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
  DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
  PR: "Sul", RS: "Sul", SC: "Sul",
};
const pct = (v: unknown) => `${Number(v ?? 0).toFixed(2)}%`;
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
];

function BiPage() {
  const { access } = useAccess();
  const qc = useQueryClient();
  const fetchCompanies = useServerFn(listMyCompanies);
  const doStart = useServerFn(startOrdersSync);
  const fetchStatus = useServerFn(getOrdersSyncStatus);
  const doCancel = useServerFn(cancelOrdersSync);
  const fetchHistory = useServerFn(listOrdersSyncHistory);
  const fetchKpis = useServerFn(getSalesKpis);
  const fetchDre = useServerFn(getDreReport);
  const fetchOrders = useServerFn(listOrders);
  const fetchExpenses = useServerFn(listDreExpenses);
  const fnSaveExpense = useServerFn(saveDreExpense);
  const fnDeleteExpense = useServerFn(deleteDreExpense);

  const companies = useQuery({ queryKey: ["companies"], queryFn: () => fetchCompanies() });
  const [companyId, setCompanyId] = useSelectedCompany();
  useEffect(() => {
    if (!companyId && companies.data?.length) setCompanyId((companies.data as any[])[0].id);
  }, [companies.data, companyId]);

  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(today());
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const perPage = 25;

  const status = useQuery({
    queryKey: ["orders-sync-status", companyId],
    queryFn: () => fetchStatus({ data: { company_id: companyId! } }),
    enabled: !!companyId,
    refetchInterval: (q) => {
      const st = (q.state.data as any)?.job?.status;
      return st === "executando" || st === "pendente" ? 2500 : false;
    },
  });
  const job = (status.data as any)?.job;
  const state = (status.data as any)?.state;
  const running = job?.status === "executando" || job?.status === "pendente";

  const kpis = useQuery({
    queryKey: ["bi-kpis", companyId, from, to],
    queryFn: () => fetchKpis({ data: { company_id: companyId!, from, to } }),
    enabled: !!companyId,
  });
  const dre = useQuery({
    queryKey: ["bi-dre", companyId, from, to],
    queryFn: () => fetchDre({ data: { company_id: companyId!, from, to } }),
    enabled: !!companyId,
  });
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const orders = useQuery({
    queryKey: ["bi-orders", companyId, from, to, page, search],
    queryFn: () =>
      fetchOrders({ data: { company_id: companyId!, from, to, page, per_page: perPage, search } }),
    enabled: !!companyId,
  });
  const expenses = useQuery({
    queryKey: ["dre-expenses", companyId, from, to],
    queryFn: () => fetchExpenses({ data: { company_id: companyId!, from, to } }),
    enabled: !!companyId,
  });
  const history = useQuery({
    queryKey: ["orders-sync-history", companyId],
    queryFn: () => fetchHistory({ data: { company_id: companyId! } }),
    enabled: !!companyId,
  });

  const k = (kpis.data ?? {}) as any;
  const d = (dre.data ?? {}) as any;
  const series = useMemo(
    () =>
      ((k.series ?? []) as any[]).map((s) => ({
        dia: String(s.dia ?? "").slice(5),
        receita: Number(s.receita ?? 0),
        cmv: Number(s.cmv ?? 0),
        lucro: Number(s.lucro ?? 0),
      })),
    [k.series],
  );

  const estados = useMemo(
    () => ((k.estados ?? []) as any[]).filter((e) => e.uf && e.uf !== "--"),
    [k.estados],
  );
  const maxUfReceita = useMemo(
    () => estados.reduce((m, e) => Math.max(m, Number(e.receita ?? 0)), 0),
    [estados],
  );
  const regioes = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of estados) {
      const r = UF_REGIAO[String(e.uf)] ?? "Outros";
      map.set(r, (map.get(r) ?? 0) + Number(e.receita ?? 0));
    }
    return [...map.entries()].map(([regiao, receita]) => ({ regiao, receita }));
  }, [estados]);

  async function handleSync(mode: "incremental" | "full") {
    if (!companyId) return;
    try {
      const res: any = await doStart({ data: { company_id: companyId, mode } });
      if (res.already_running) toast.info("Já existe uma sincronização em andamento.");
      else toast.success(mode === "full" ? "Sincronização completa iniciada." : "Buscando apenas pedidos novos/alterados.");
      await qc.invalidateQueries({ queryKey: ["orders-sync-status", companyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao sincronizar.");
    }
  }

  async function handleCancel() {
    if (!companyId) return;
    await doCancel({ data: { company_id: companyId } });
    toast.info("Cancelamento solicitado.");
    await qc.invalidateQueries({ queryKey: ["orders-sync-status", companyId] });
  }

  // ----- despesas -----
  const [expForm, setExpForm] = useState({ competencia: firstDayOfMonth(), categoria: "", descricao: "", tipo: "fixa", valor: "" });
  const [expOpen, setExpOpen] = useState(false);
  async function handleSaveExpense() {
    if (!companyId) return;
    try {
      await fnSaveExpense({
        data: {
          company_id: companyId,
          competencia: expForm.competencia,
          categoria: expForm.categoria,
          descricao: expForm.descricao || undefined,
          tipo: expForm.tipo as "fixa" | "variavel",
          valor: Number(String(expForm.valor).replace(",", ".")) || 0,
        },
      });
      setExpOpen(false);
      setExpForm({ competencia: firstDayOfMonth(), categoria: "", descricao: "", tipo: "fixa", valor: "" });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["dre-expenses", companyId] }),
        qc.invalidateQueries({ queryKey: ["bi-dre", companyId] }),
      ]);
      toast.success("Despesa salva.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar despesa.");
    }
  }

  

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">BI &amp; DRE</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setPage(1); }}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Empresa" /></SelectTrigger>
            <SelectContent>
              {((companies.data ?? []) as any[]).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-[150px]" />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-[150px]" />
        </div>
      </div>

      {/* Sincronização */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>Sincronização de pedidos (Bling)</span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => handleSync("incremental")} disabled={running || !companyId}>
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Sincronizar novos
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleSync("full")} disabled={running || !companyId}>
                Sincronização completa
              </Button>
              {running && !access.company_restricted && (
                <Button size="sm" variant="destructive" onClick={handleCancel}>
                  <StopCircle className="mr-2 h-4 w-4" /> Cancelar
                </Button>
              )}
              <Dialog>
                <DialogTrigger asChild>
                  <Button size="sm" variant="ghost"><History className="mr-2 h-4 w-4" /> Histórico</Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl">
                  <DialogHeader><DialogTitle>Histórico de sincronizações</DialogTitle></DialogHeader>
                  <div className="max-h-[60vh] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Início</TableHead><TableHead>Modo</TableHead><TableHead>Status</TableHead>
                          <TableHead className="text-right">Novos</TableHead><TableHead className="text-right">Atualizados</TableHead>
                          <TableHead className="text-right">Ignorados</TableHead><TableHead className="text-right">Requisições</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {((history.data ?? []) as any[]).map((h) => (
                          <TableRow key={h.id}>
                            <TableCell>{h.started_at ? new Date(h.started_at).toLocaleString("pt-BR") : "-"}</TableCell>
                            <TableCell>{h.mode}</TableCell>
                            <TableCell><Badge variant="outline">{h.status}</Badge></TableCell>
                            <TableCell className="text-right">{h.orders_new}</TableCell>
                            <TableCell className="text-right">{h.orders_updated}</TableCell>
                            <TableCell className="text-right">{h.orders_skipped}</TableCell>
                            <TableCell className="text-right">{h.requests_made}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {job ? (
            <>
              {running && <Progress value={undefined} className="h-2" />}
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>Status: <strong className="text-foreground">{job.status}</strong></span>
                <span>Novos: {job.orders_new}</span>
                <span>Atualizados: {job.orders_updated}</span>
                <span>Ignorados (sem mudança): {job.orders_skipped}</span>
                <span>Requisições: {job.requests_made}</span>
                {job.errors > 0 && <span className="text-destructive">Erros: {job.errors}</span>}
              </div>
              {job.last_error && <p className="text-destructive">{job.last_error}</p>}
            </>
          ) : (
            <p>Nenhuma sincronização executada ainda.</p>
          )}
          <p>
            Última sincronização:{" "}
            <strong className="text-foreground">
              {state?.last_synced_at ? new Date(state.last_synced_at).toLocaleString("pt-BR") : "nunca"}
            </strong>
            {" · "}Pedidos na base: {state?.total_orders ?? 0}
          </p>
          <p className="text-xs">
            Ao sincronizar novamente, apenas pedidos criados ou alterados desde a última execução são consultados —
            pedidos sem mudança não geram requisição de detalhe.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="visao">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
          <TabsTrigger value="geografia">Geografia</TabsTrigger>
          <TabsTrigger value="clientes">Clientes</TabsTrigger>
          <TabsTrigger value="dre">DRE</TabsTrigger>
          <TabsTrigger value="repasse">Repasse</TabsTrigger>
        </TabsList>

        <TabsContent value="repasse">
          <RepasseTab key={`${companyId}-${from}-${to}`} companyId={companyId} from={from} to={to} onPeriodChange={(nextFrom,nextTo) => { setFrom(nextFrom); setTo(nextTo); }} />
        </TabsContent>

        <TabsContent value="visao" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Receita", value: brl(k.receita) },
              { label: "Pedidos", value: String(k.pedidos ?? 0) },
              { label: "Ticket médio", value: brl(k.ticket_medio) },
              { label: "Itens por pedido", value: Number(k.itens_por_pedido ?? 0).toFixed(2) },
              { label: "Clientes", value: String(k.clientes ?? 0) },
              { label: "Clientes novos", value: String(k.clientes_novos ?? 0) },
              { label: "Clientes recorrentes", value: String(k.clientes_recorrentes ?? 0) },
              { label: "Receita por cliente", value: brl(k.receita_por_cliente) },
              { label: "CMV", value: `${brl(k.cmv)} · ${pct(k.cmv_percent)}` },
              { label: "Taxas marketplace", value: `${brl(k.taxas)} · ${pct(k.taxas_percent)}` },
              { label: "Frete", value: `${brl(k.frete)} · ${pct(k.frete_percent)}` },
              { label: "Descontos", value: `${brl(k.desconto)} · ${pct(k.desconto_percent)}` },
              { label: "Lucro bruto", value: brl(k.lucro_bruto) },
              { label: "Margem", value: pct(k.margem_percent) },
              { label: "Estados atendidos", value: String(((k.estados ?? []) as any[]).filter((e) => e.uf !== "--").length) },
              { label: "Canais ativos", value: String(((k.lojas ?? []) as any[]).length) },
            ].map((c) => (
              <Card key={c.label}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className="text-xl font-semibold">{c.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>


          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Receita x CMV por dia</CardTitle></CardHeader>
            <CardContent className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="dia" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(v: any) => brl(v)} />
                  <Area type="monotone" dataKey="receita" stroke="var(--chart-1)" fill="var(--chart-2)" />
                  <Area type="monotone" dataKey="cmv" stroke="var(--chart-5)" fill="var(--chart-5)" fillOpacity={0.15} />
                  <Area type="monotone" dataKey="lucro" stroke="var(--chart-3)" fill="var(--chart-3)" fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Receita por loja</CardTitle></CardHeader>
              <CardContent className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={((k.lojas ?? []) as any[]).map((l) => ({ nome: l.loja_nome, receita: Number(l.receita) }))}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="nome" fontSize={11} />
                    <YAxis fontSize={12} />
                    <Tooltip formatter={(v: any) => brl(v)} />
                    <Bar dataKey="receita" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Top produtos</CardTitle></CardHeader>
              <CardContent className="max-h-[280px] overflow-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Código</TableHead><TableHead>Produto</TableHead><TableHead className="text-right">Qtd</TableHead><TableHead className="text-right">Receita</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {((k.top_produtos ?? []) as any[]).map((p, i) => (
                      <TableRow key={`${p.codigo}-${i}`}>
                        <TableCell className="font-mono text-xs">{p.codigo}</TableCell>
                        <TableCell className="max-w-[240px] truncate">{p.descricao}</TableCell>
                        <TableCell className="text-right">{p.quantidade}</TableCell>
                        <TableCell className="text-right">{brl(p.receita)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Receita por canal / intermediador</CardTitle></CardHeader>
              <CardContent className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={((k.canais ?? []) as any[]).map((c) => ({ name: c.canal, value: Number(c.receita) }))}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={90}
                      label
                    >
                      {((k.canais ?? []) as any[]).map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip formatter={(v: any) => brl(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Pedidos por situação</CardTitle></CardHeader>
              <CardContent className="max-h-[280px] overflow-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Situação</TableHead><TableHead className="text-right">Pedidos</TableHead><TableHead className="text-right">Receita</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {((k.situacoes ?? []) as any[]).map((s, i) => (
                      <TableRow key={i}>
                        <TableCell>{s.situacao}</TableCell>
                        <TableCell className="text-right">{s.pedidos}</TableCell>
                        <TableCell className="text-right">{brl(s.receita)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="geografia" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Mapa de vendas por estado</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {estados.length === 0 && <p className="text-sm text-muted-foreground">Sem pedidos no período.</p>}
              {estados.map((e) => (
                <div key={e.uf} className="flex items-center gap-3">
                  <span className="w-10 font-mono text-sm font-semibold">{e.uf}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full rounded bg-primary"
                      style={{ width: `${maxUfReceita > 0 ? (Number(e.receita) / maxUfReceita) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="w-28 text-right text-sm">{brl(e.receita)}</span>
                  <span className="w-20 text-right text-xs text-muted-foreground">{e.pedidos} ped.</span>
                  <span className="hidden w-28 text-right text-xs text-muted-foreground sm:inline">
                    ticket {brl(e.ticket)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Receita por região</CardTitle></CardHeader>
              <CardContent className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={regioes}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="regiao" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip formatter={(v: any) => brl(v)} />
                    <Bar dataKey="receita" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Top cidades</CardTitle></CardHeader>
              <CardContent className="max-h-[280px] overflow-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Cidade</TableHead><TableHead>UF</TableHead><TableHead className="text-right">Pedidos</TableHead><TableHead className="text-right">Receita</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {((k.cidades ?? []) as any[]).map((c, i) => (
                      <TableRow key={i}>
                        <TableCell>{c.cidade}</TableCell>
                        <TableCell className="font-mono text-xs">{c.uf}</TableCell>
                        <TableCell className="text-right">{c.pedidos}</TableCell>
                        <TableCell className="text-right">{brl(c.receita)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="clientes" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Clientes no período", value: String(k.clientes ?? 0) },
              { label: "Novos", value: String(k.clientes_novos ?? 0) },
              { label: "Recorrentes", value: String(k.clientes_recorrentes ?? 0) },
              { label: "Compraram 1x", value: String(k.clientes_unicos ?? 0) },
              { label: "Receita por cliente", value: brl(k.receita_por_cliente) },
              { label: "Ticket médio", value: brl(k.ticket_medio) },
              {
                label: "Taxa de recorrência",
                value: pct(Number(k.clientes ?? 0) > 0 ? (Number(k.clientes_recorrentes ?? 0) / Number(k.clientes)) * 100 : 0),
              },
              { label: "Itens vendidos", value: String(k.itens ?? 0) },
            ].map((c) => (
              <Card key={c.label}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className="text-xl font-semibold">{c.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Top clientes</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Cliente</TableHead><TableHead>UF</TableHead><TableHead className="text-right">Pedidos</TableHead><TableHead className="text-right">Receita</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {((k.top_clientes ?? []) as any[]).map((c, i) => (
                    <TableRow key={i}>
                      <TableCell className="max-w-[280px] truncate">{c.nome}</TableCell>
                      <TableCell className="font-mono text-xs">{c.uf || "-"}</TableCell>
                      <TableCell className="text-right">{c.pedidos}</TableCell>
                      <TableCell className="text-right">{brl(c.receita)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pedidos" className="space-y-3">
          <Input
            placeholder="Buscar por número ou cliente"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="max-w-sm"
          />
          <Card>
            <CardContent className="overflow-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead><TableHead>Data</TableHead><TableHead>Loja</TableHead>
                    <TableHead>Cliente</TableHead><TableHead>Situação</TableHead>
                    <TableHead className="text-right">Total</TableHead><TableHead className="text-right">CMV</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((orders.data as any)?.rows ?? []).map((o: any) => (
                    <TableRow key={o.id} className="cursor-pointer" onClick={() => setOpenOrderId(o.id)}>
                      <TableCell className="font-mono text-xs">{o.numero}</TableCell>
                      <TableCell>{o.data ? new Date(o.data + "T12:00:00").toLocaleDateString("pt-BR") : "-"}</TableCell>
                      <TableCell>{o.loja_nome ?? o.loja_id ?? "Bling"}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{o.contato_nome}</TableCell>
                      <TableCell><Badge variant="outline">{o.situacao_nome ?? "-"}</Badge></TableCell>
                      <TableCell className="text-right">{brl(o.total)}</TableCell>
                      <TableCell className="text-right">{brl(o.custo_total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <PageNumbers
            page={page}
            pageSize={perPage}
            total={(orders.data as any)?.total ?? 0}
            onChange={setPage}
          />
          <OrderDetailDialog
            companyId={companyId ?? ""}
            orderId={openOrderId}
            onClose={() => setOpenOrderId(null)}
          />
        </TabsContent>

        <TabsContent value="dre" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Demonstrativo de resultado</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableBody>
                  {[
                    ["Receita bruta", d.receita_bruta, false],
                    ["(-) Descontos", d.descontos, true],
                    ["(-) Taxas de marketplace", d.taxas_marketplace, true],
                    ["(=) Receita líquida", d.receita_liquida, false],
                    ["(-) CMV", d.cmv, true],
                    ["(-) Frete", d.frete, true],
                    ["(=) Lucro bruto", d.lucro_bruto, false],
                    ["(-) Custo fixo estimado", d.custo_fixo_estimado, true],
                    ["(-) Devoluções estimadas", d.devolucao_estimada, true],
                    ["(-) Despesas lançadas", d.despesas, true],
                    ["(=) Resultado líquido", d.resultado_liquido, false],
                  ].map(([label, value, neg], i) => (
                    <TableRow key={i as number}>
                      <TableCell className={String(label).startsWith("(=") ? "font-semibold" : ""}>{label as string}</TableCell>
                      <TableCell className={`text-right ${neg ? "text-destructive" : "font-medium"}`}>{brl(value)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-semibold">Margem líquida</TableCell>
                    <TableCell className="text-right font-semibold">{Number(d.margem_liquida_percent ?? 0).toFixed(2)}%</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">Cobertura de CMV (receita com custo cadastrado)</TableCell>
                    <TableCell className="text-right">{Number(d.cobertura_cmv_percent ?? 0).toFixed(2)}%</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">Pedidos sem custo cadastrado</TableCell>
                    <TableCell className="text-right">
                      {Number(d.pedidos_sem_custo ?? 0)} de {Number(d.pedidos ?? 0)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">Receita sem custo cadastrado</TableCell>
                    <TableCell className="text-right">{brl(d.receita_sem_custo)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              {Number(d.pedidos_sem_custo ?? 0) > 0 && (
                <div className="flex items-start gap-2 border-t bg-muted/40 p-3 text-sm text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <span>
                    Parte do CMV está faltando: {Number(d.pedidos_sem_custo)} pedido(s) sem preço de custo,
                    representando {brl(d.receita_sem_custo)} de receita. O lucro bruto e a margem líquida acima
                    estão otimistas até que esses custos sejam cadastrados.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                Despesas do período
                <Dialog open={expOpen} onOpenChange={setExpOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Nova despesa</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Lançar despesa</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <div><Label>Competência</Label><Input type="date" value={expForm.competencia} onChange={(e) => setExpForm({ ...expForm, competencia: e.target.value })} /></div>
                      <div><Label>Categoria</Label><Input value={expForm.categoria} onChange={(e) => setExpForm({ ...expForm, categoria: e.target.value })} placeholder="Ex.: Aluguel, Salários, Marketing" /></div>
                      <div><Label>Descrição</Label><Input value={expForm.descricao} onChange={(e) => setExpForm({ ...expForm, descricao: e.target.value })} /></div>
                      <div>
                        <Label>Tipo</Label>
                        <Select value={expForm.tipo} onValueChange={(v) => setExpForm({ ...expForm, tipo: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fixa">Fixa</SelectItem>
                            <SelectItem value="variavel">Variável</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div><Label>Valor</Label><Input value={expForm.valor} onChange={(e) => setExpForm({ ...expForm, valor: e.target.value })} placeholder="0,00" /></div>
                      <Button className="w-full" onClick={handleSaveExpense}>Salvar</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Competência</TableHead><TableHead>Categoria</TableHead><TableHead>Descrição</TableHead>
                    <TableHead>Tipo</TableHead><TableHead className="text-right">Valor</TableHead><TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((expenses.data ?? []) as any[]).map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{new Date(e.competencia + "T12:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}</TableCell>
                      <TableCell>{e.categoria}</TableCell>
                      <TableCell>{e.descricao}</TableCell>
                      <TableCell><Badge variant="outline">{e.tipo}</Badge></TableCell>
                      <TableCell className="text-right">{brl(e.valor)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={async () => {
                            await fnDeleteExpense({ data: { company_id: companyId!, id: e.id } });
                            await Promise.all([
                              qc.invalidateQueries({ queryKey: ["dre-expenses", companyId] }),
                              qc.invalidateQueries({ queryKey: ["bi-dre", companyId] }),
                            ]);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, value }: { label: string; value: unknown }) {
  const v = value == null || value === "" ? "-" : String(value);
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium break-words">{v}</p>
    </div>
  );
}

function OrderDetailDialog({
  companyId,
  orderId,
  onClose,
}: {
  companyId: string;
  orderId: string | null;
  onClose: () => void;
}) {
  const fetchDetail = useServerFn(getOrderDetail);
  const detail = useQuery({
    queryKey: ["bi-order-detail", companyId, orderId],
    enabled: !!companyId && !!orderId,
    queryFn: () => fetchDetail({ data: { company_id: companyId, order_id: orderId! } }),
  });

  const d = detail.data as any;
  const o = d?.order;
  const e = d?.entrega;
  const c = d?.contato;
  const items = (d?.items ?? []) as any[];
  const taxa = Number(o?.taxa_percent ?? 0);
  const comissao = (Number(o?.total ?? 0) * taxa) / 100;

  return (
    <Dialog open={!!orderId} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-auto">
        <DialogHeader>
          <DialogTitle>
            Pedido {o?.numero ?? ""} {o?.numero_loja ? `· Loja ${o.numero_loja}` : ""}
          </DialogTitle>
        </DialogHeader>

        {detail.isLoading && (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando pedido...
          </div>
        )}
        {detail.isError && (
          <p className="py-6 text-sm text-destructive">
            {(detail.error as Error)?.message ?? "Falha ao carregar o pedido."}
          </p>
        )}

        {o && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field label="Data" value={o.data ? new Date(o.data + "T12:00:00").toLocaleDateString("pt-BR") : null} />
              <Field label="Data de saída" value={o.data_saida ? new Date(o.data_saida + "T12:00:00").toLocaleDateString("pt-BR") : null} />
              <Field label="Situação" value={o.situacao_nome} />
              <Field label="ID no Bling" value={o.bling_order_id} />
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Cliente</h3>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Field label="Nome" value={c?.nome} />
                <Field label="Documento" value={c?.documento} />
                <Field label="E-mail" value={c?.email} />
                <Field label="Telefone" value={c?.celular ?? c?.telefone} />
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Canal e intermediador</h3>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Field label="Loja" value={o.loja_nome ?? o.loja_id ?? "Bling"} />
                <Field label="Intermediador" value={o.intermediador_nome} />
                <Field label="CNPJ do intermediador" value={o.intermediador_cnpj} />
                <Field label="Razão social (CNPJ)" value={o.intermediador_razao_social} />
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Entrega</h3>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Field label="Destinatário" value={e?.nome} />
                <Field
                  label="Endereço"
                  value={[e?.endereco, e?.numero, e?.complemento].filter(Boolean).join(", ")}
                />
                <Field label="Bairro" value={e?.bairro} />
                <Field label="Cidade / UF" value={[e?.municipio, e?.uf].filter(Boolean).join(" / ")} />
                <Field label="CEP" value={e?.cep} />
                <Field label="Transportadora" value={e?.transportadora} />
                <Field label="Rastreamento" value={e?.rastreamento} />
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Itens ({items.length})</h3>
              <div className="overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Vl. unit.</TableHead>
                      <TableHead className="text-right">Desconto</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Custo unit.</TableHead>
                      <TableHead className="text-right">Custo total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-mono text-xs">{i.codigo ?? "-"}</TableCell>
                        <TableCell className="max-w-[260px] truncate">{i.descricao ?? "-"}</TableCell>
                        <TableCell className="text-right">{Number(i.quantidade ?? 0)}</TableCell>
                        <TableCell className="text-right">{brl(i.valor_unitario)}</TableCell>
                        <TableCell className="text-right">{brl(i.desconto)}</TableCell>
                        <TableCell className="text-right">{brl(i.total)}</TableCell>
                        <TableCell className="text-right">{brl(i.custo_unitario)}</TableCell>
                        <TableCell className="text-right">{brl(i.custo_total)}</TableCell>
                      </TableRow>
                    ))}
                    {items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                          Sem itens sincronizados.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Valores</h3>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Field label="Total dos produtos" value={brl(o.total_produtos)} />
                <Field label="Desconto" value={brl(o.desconto)} />
                <Field label="Frete" value={brl(o.frete)} />
                <Field label="Outras despesas" value={brl(o.outras_despesas)} />
                <Field label="Total do pedido" value={brl(o.total)} />
                <Field label="CMV (custo)" value={brl(o.custo_total)} />
                <Field label={`Comissão (${taxa.toFixed(2)}%)`} value={brl(comissao)} />
                <Field
                  label="Margem estimada"
                  value={brl(Number(o.total ?? 0) - Number(o.custo_total ?? 0) - comissao)}
                />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
