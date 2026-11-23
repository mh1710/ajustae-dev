import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, Check } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  getAnatelOfficialStats,
  suggestAnatelOfficial,
  applyAnatelOfficial,
  type AnatelOfficialSuggestion,
} from "@/lib/anatel.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import { listMyCompanies } from "@/lib/companies.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const norm = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^0+/, "");

type Row = AnatelOfficialSuggestion & { status: "novo" | "diferente" | "igual"; choice: "oficial" | "atual"; checked: boolean };

export function AnatelOfficialCard() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useSelectedCompany();
  const fetchCompanies = useServerFn(listMyCompanies);
  const companies = useQuery({ queryKey: ["companies"], queryFn: () => fetchCompanies() });
  const fetchStats = useServerFn(getAnatelOfficialStats);
  const doSuggest = useServerFn(suggestAnatelOfficial);
  const doApply = useServerFn(applyAnatelOfficial);
  const stats = useQuery({ queryKey: ["anatel-official-stats"], queryFn: () => fetchStats() });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showEqual, setShowEqual] = useState(false);

  async function search() {
    if (!companyId) return toast.error("Selecione uma empresa.");
    setLoading(true);
    try {
      const res = await doSuggest({ data: { company_id: companyId } });
      setRows(
        res.items.map((it) => {
          const status: Row["status"] = !it.codigo_atual ? "novo" : norm(it.codigo_atual) === norm(it.numero) ? "igual" : "diferente";
          return { ...it, status, choice: "oficial", checked: status === "novo" };
        }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na busca");
    } finally {
      setLoading(false);
    }
  }

  const visible = useMemo(() => (rows ?? []).filter((r) => showEqual || r.status !== "igual"), [rows, showEqual]);
  const counts = useMemo(() => {
    const c = { novo: 0, diferente: 0, igual: 0 };
    (rows ?? []).forEach((r) => c[r.status]++);
    return c;
  }, [rows]);
  const selected = visible.filter((r) => r.checked && r.status !== "igual");

  function patch(id: string, p: Partial<Row>) {
    setRows((rs) => (rs ?? []).map((r) => (r.product_id === id ? { ...r, ...p } : r)));
  }

  async function apply() {
    const items = selected
      .filter((r) => !(r.status === "diferente" && r.choice === "atual"))
      .map((r) => ({ codigo: r.codigo, codigo_anatel: r.numero, nome: r.nome, marca: r.marca, gtin: r.gtin }));
    const kept = selected.length - items.length;
    if (!items.length) {
      toast.success(`${kept} produto(s) mantidos com o código atual.`);
      setRows((rs) => (rs ?? []).filter((r) => !selected.includes(r)));
      return;
    }
    setApplying(true);
    try {
      const res = await doApply({ data: { items } });
      toast.success(`${res.saved} código(s) gravados no módulo Anatel${kept ? `, ${kept} mantidos` : ""}. Rode "Atualizar Código Anatel" para levar à descrição curta.`);
      setRows((rs) => (rs ?? []).filter((r) => !selected.includes(r)));
      qc.invalidateQueries({ queryKey: ["anatel-list"] });
      qc.invalidateQueries({ queryKey: ["anatel-stats"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao aplicar");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lista oficial da Anatel</CardTitle>
        <CardDescription>
          Produtos homologados publicados pela Anatel (só homologações emitidas; suspensas e canceladas ficam de fora).
          A busca usa o nome do produto no fornecedor (achado pelo SKU), casa o modelo com o modelo homologado e exige que a marca confira com o fabricante.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-64">
            <Select value={companyId ?? ""} onValueChange={(v) => { setCompanyId(v); setRows(null); }}>
              <SelectTrigger><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
              <SelectContent>
                {(companies.data ?? []).map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={search} disabled={loading || !companyId}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Buscar códigos
          </Button>
          <div className="text-sm text-muted-foreground">
            Homologações na lista: <strong>{stats.data?.total?.toLocaleString("pt-BR") ?? 0}</strong>
            {stats.data?.imported_at ? ` · Atualizada em ${new Date(stats.data.imported_at).toLocaleString("pt-BR")}` : ""}
          </div>
        </div>

        {rows && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">Novos: {counts.novo}</Badge>
              <Badge variant="destructive">Diferentes do módulo: {counts.diferente}</Badge>
              <Badge variant="outline">Iguais: {counts.igual}</Badge>
              <label className="ml-2 flex items-center gap-2">
                <Checkbox checked={showEqual} onCheckedChange={(v) => setShowEqual(!!v)} /> Mostrar iguais
              </label>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setRows((rs) => (rs ?? []).map((r) => ({ ...r, checked: true })))}>Marcar todos</Button>
                <Button variant="outline" size="sm" onClick={() => setRows((rs) => (rs ?? []).map((r) => ({ ...r, checked: false })))}>Desmarcar todos</Button>
                <Button variant="outline" size="sm" onClick={() => setRows(null)}>Descartar tudo</Button>
                <Button size="sm" onClick={apply} disabled={applying || selected.length === 0}>
                  {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  Aplicar {selected.length}
                </Button>
              </div>
            </div>
            <div className="max-h-[600px] overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2"></th>
                    <th className="p-2">Produto</th>
                    <th className="p-2">Homologação encontrada</th>
                    <th className="p-2">Código a usar</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">Nenhuma sugestão.</td></tr>
                  ) : visible.map((r) => (
                    <tr key={r.product_id} className="border-t align-top">
                      <td className="p-2">
                        <Checkbox disabled={r.status === "igual"} checked={r.checked} onCheckedChange={(v) => patch(r.product_id, { checked: !!v })} />
                      </td>
                      <td className="p-2 max-w-xs">
                        <div className="font-mono text-xs">{r.codigo}</div>
                        <div className="truncate" title={r.nome ?? ""}>{r.nome}</div>
                        <div className="text-xs text-muted-foreground">{r.marca}</div>
                      </td>
                      <td className="p-2 max-w-xs text-xs">
                        <div>Modelo: <strong>{r.modelo}</strong></div>
                        <div className="truncate" title={r.fabricante ?? ""}>{r.fabricante}</div>
                        <div className="text-muted-foreground truncate" title={r.tipo ?? ""}>{r.tipo}</div>
                      </td>
                      <td className="p-2 text-xs">
                        {r.status === "diferente" ? (
                          <div className="space-y-1">
                            <label className="flex items-center gap-2">
                              <input type="radio" checked={r.choice === "oficial"} onChange={() => patch(r.product_id, { choice: "oficial" })} />
                              Oficial: <span className="font-mono">{r.numero}</span>
                            </label>
                            <label className="flex items-center gap-2">
                              <input type="radio" checked={r.choice === "atual"} onChange={() => patch(r.product_id, { choice: "atual" })} />
                              Módulo: <span className="font-mono">{r.codigo_atual}</span>
                            </label>
                          </div>
                        ) : (
                          <div>
                            <span className="font-mono">{r.numero}</span>
                            <div className="text-muted-foreground">{r.status === "igual" ? "Já igual no módulo" : "Sem código no módulo"}</div>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
