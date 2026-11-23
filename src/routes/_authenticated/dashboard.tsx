import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, ShieldCheck, AlertCircle, CheckCircle2, Sliders } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { listMyCompanies } from "@/lib/companies.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import { getDashboardStats } from "@/lib/audit.functions";
import { getLowMarginProducts } from "@/lib/pricing.functions";
import { PricingPolicyAlert } from "@/components/pricing-policy-alert";
import { TrendingDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{"title": "Dashboard | Ajusta-Ê"}, {"name": "description", "content": "Acompanhe os indicadores e a qualidade do catálogo da empresa."}, {"property": "og:title", "content": "Dashboard | Ajusta-Ê"}, {"property": "og:description", "content": "Acompanhe os indicadores e a qualidade do catálogo da empresa."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }), component: Dashboard });

const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#94a3b8"];

function Dashboard() {
  const fetchCompanies = useServerFn(listMyCompanies);
  const fetchStats = useServerFn(getDashboardStats);
  const fetchLowMargin = useServerFn(getLowMarginProducts);

  const companies = useQuery({
    queryKey: ["companies"],
    queryFn: () => fetchCompanies(),
    staleTime: 5 * 60_000,
  });

  const [companyId, setCompanyId] = useSelectedCompany();
  useEffect(() => { if (!companyId && companies.data?.[0]) setCompanyId(companies.data[0].id); }, [companies.data, companyId]);

  const stats = useQuery({
    queryKey: ["dashboard-stats", companyId],
    queryFn: () => fetchStats({ data: { company_id: companyId! } }),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const lowMargin = useQuery({
    queryKey: ["low-margin", companyId],
    queryFn: () => fetchLowMargin({ data: { company_id: companyId!, threshold: 20, limit: 50 } }),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const pie = stats.data ? [
    { name: "Com erros", value: stats.data.comErro },
    { name: "Com avisos", value: stats.data.comAviso },
    { name: "Aprovados", value: stats.data.semErro },
    { name: "Não auditados", value: Math.max(0, stats.data.naoAuditados) },
  ] : [];

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Visão geral da operação da empresa selecionada.</p>
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

      <PricingPolicyAlert companyId={companyId} />

      <div className="grid gap-4 md:grid-cols-4">
        <Stat title="Produtos" value={stats.data?.totalProducts ?? "—"} icon={<Package className="h-4 w-4" />} />
        <Stat title="Regras" value={stats.data?.totalRules ?? "—"} icon={<Sliders className="h-4 w-4" />} />
        <Stat title="Auditorias rodadas" value={stats.data?.totalRuns ?? "—"} icon={<ShieldCheck className="h-4 w-4" />} />
        <Stat title="Aprovados" value={stats.data?.semErro ?? "—"} icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat title="Com erros" value={stats.data?.comErro ?? "—"} icon={<AlertCircle className="h-4 w-4 text-red-500" />} />
        <Stat title="Com avisos" value={stats.data?.comAviso ?? "—"} icon={<AlertCircle className="h-4 w-4 text-amber-500" />} />
        <Stat
          title="Margem abaixo de 20%"
          value={lowMargin.data?.count ?? "—"}
          icon={<TrendingDown className="h-4 w-4 text-red-500" />}
          subtitle="Após todos os custos e a comissão da loja"
        />
        <Stat title="Não auditados" value={stats.data?.naoAuditados ?? "—"} icon={<AlertCircle className="h-4 w-4 text-muted-foreground" />} />
      </div>

      {(lowMargin.data?.items.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-500" /> Produtos com margem inferior a 20% (por loja)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Loja</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                    <TableHead className="text-right">Custo total</TableHead>
                    <TableHead className="text-right">Comissão</TableHead>
                    <TableHead className="text-right">Margem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowMargin.data!.items.map((it, i) => (
                    <TableRow key={`${it.id}-${it.loja_id ?? "base"}-${i}`}>
                      <TableCell className="font-mono text-xs">{it.sku ?? "—"}</TableCell>
                      <TableCell className="max-w-[280px] truncate">{it.nome ?? "—"}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-xs">
                        {it.loja_nome ?? "Sem loja (preço base)"}
                        {it.marketplace_nome ? (
                          <span className="text-muted-foreground"> · {it.marketplace_nome}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">{brl(it.preco)}</TableCell>
                      <TableCell className="text-right">{brl(it.custo_completo)}</TableCell>
                      <TableCell className="text-right">{it.comissao.toFixed(2)}%</TableCell>
                      <TableCell className="text-right font-medium text-red-600">
                        {it.margem_percent.toFixed(2)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {lowMargin.data!.count > lowMargin.data!.items.length && (
              <p className="mt-2 text-xs text-muted-foreground">
                Mostrando os {lowMargin.data!.items.length} piores de {lowMargin.data!.count.toLocaleString("pt-BR")}.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Distribuição da auditoria</CardTitle></CardHeader>
          <CardContent style={{ height: 300 }}>
            {pie.length > 0 && (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" outerRadius={100} label>
                    {pie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Produtos por categoria (top 10)</CardTitle></CardHeader>
          <CardContent style={{ height: 300 }}>
            {stats.data && stats.data.categorias.length > 0 && (
              <ResponsiveContainer>
                <BarChart data={stats.data.categorias}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function brl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Stat({ title, value, icon, subtitle }: { title: string; value: React.ReactNode; icon?: React.ReactNode; subtitle?: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}
