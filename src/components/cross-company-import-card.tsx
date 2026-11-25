import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronUp, Loader2, PackagePlus, Search } from "lucide-react";
import {
  listCrossCompanyImportCandidates,
  importCrossCompanyProducts,
  summarizeCrossCompanyMissing,
  listCrossCompanyMissingIds,
} from "@/lib/cross-company-import.functions";
import { enqueueBlingPush } from "@/lib/bling-push.functions";

type Candidate = {
  id: string;
  company_id: string;
  company_nome: string;
  codigo: string;
  nome: string | null;
  marca: string | null;
  preco: number | null;
  gtin: string | null;
  audited_at: string | null;
};

/**
 * Traz para a empresa atual produtos que passaram em TODAS as regras da
 * auditoria em outra empresa da conta e que ainda não existem aqui.
 */
export function CrossCompanyImportCard({ companyId }: { companyId: string | undefined }) {
  const qc = useQueryClient();
  const listCandidates = useServerFn(listCrossCompanyImportCandidates);
  const doImport = useServerFn(importCrossCompanyProducts);
  const doPush = useServerFn(enqueueBlingPush);

  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Candidate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [approvedTotal, setApprovedTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createInBling, setCreateInBling] = useState(true);
  const [zeroStock, setZeroStock] = useState(true);
  const summarize = useServerFn(summarizeCrossCompanyMissing);
  const listIds = useServerFn(listCrossCompanyMissingIds);
  const [summary, setSummary] = useState<{ companies: { company_id: string; company_nome: string; missing: number }[]; unique_total: number } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [phaseStart, setPhaseStart] = useState<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!phase) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  function startPhase(label: string | null) {
    setPhase(label);
    setPhaseStart(label ? Date.now() : null);
  }

  async function loadSummary() {
    if (!companyId) return;
    setSummaryLoading(true);
    try {
      setSummary(await summarize({ data: { company_id: companyId } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao contar produtos.");
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    setSummary(null);
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function importIds(ids: string[]) {
    if (!companyId || ids.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: ids.length });
    startPhase("Copiando produtos para esta empresa");
    try {
      const newIds: string[] = [];
      let inserted = 0;
      let noPrice = 0;
      for (let i = 0; i < ids.length; i += 500) {
        const r = await doImport({
          data: { company_id: companyId, source_product_ids: ids.slice(i, i + 500), zero_stock: zeroStock },
        });
        inserted += r.inserted;
        noPrice += r.no_price ?? 0;
        newIds.push(...r.ids);
        setProgress({ done: Math.min(i + 500, ids.length), total: ids.length });
      }
      toast.success(`${inserted.toLocaleString("pt-BR")} produto(s) importado(s) para esta empresa.`);
      if (noPrice > 0)
        toast.warning(
          `${noPrice.toLocaleString("pt-BR")} produto(s) não foram importados: sem preço de venda pelas regras desta empresa (confira o marketplace padrão na Precificação).`,
        );
      if (createInBling && newIds.length > 0) {
        startPhase(`Colocando ${newIds.length.toLocaleString("pt-BR")} produto(s) na fila de cadastro do Bling`);
        try {
          // Uma única chamada: cada nova fila de "criar" substitui a anterior da empresa.
          await doPush({ data: { company_id: companyId, product_ids: newIds, scope: "criar" } });
          toast.info("Cadastro dos produtos no Bling enfileirado.");
        } catch (e) {
          toast.error(`Produtos importados, mas o envio ao Bling falhou: ${e instanceof Error ? e.message : "erro"}`);
        }
      }
      setItems([]);
      setSelected(new Set());
      setLoaded(false);
      qc.invalidateQueries({ queryKey: ["products"] });
      await loadSummary();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao importar.");
    } finally {
      setImporting(false);
      setProgress(null);
      startPhase(null);
    }
  }

  async function importAll(sourceCompanyId?: string, label?: string) {
    if (!companyId) return;
    const n = sourceCompanyId
      ? summary?.companies.find((c) => c.company_id === sourceCompanyId)?.missing ?? 0
      : summary?.unique_total ?? 0;
    if (!window.confirm(`Importar ${n.toLocaleString("pt-BR")} produto(s) ${label ? `de ${label}` : "de todas as empresas"}?`)) return;
    setImporting(true);
    startPhase("Montando a lista de produtos aprovados");
    try {
      const { ids } = await listIds({ data: { company_id: companyId, source_company_id: sourceCompanyId } });
      await importIds(ids);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao importar.");
      setImporting(false);
      startPhase(null);
    }
  }

  async function load(reset: boolean) {
    if (!companyId) return;
    setLoading(true);
    try {
      const r = await listCandidates({
        data: {
          company_id: companyId,
          search: search.trim() || undefined,
          limit: 50,
          cursor: reset ? undefined : (cursor ?? undefined),
        },
      });
      setItems((prev) => {
        const base = reset ? [] : prev;
        const seen = new Set(base.map((x) => x.codigo));
        // Um mesmo SKU aprovado em várias empresas entra uma única vez na lista.
        const merged = [...base];
        for (const it of r.items) {
          if (seen.has(it.codigo)) continue;
          seen.add(it.codigo);
          merged.push(it);
        }
        return merged;
      });
      setCursor(r.next_cursor);
      setApprovedTotal(r.approved_total);
      setLoaded(true);
      if (reset) setSelected(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao buscar produtos.");
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmImport() {
    if (!companyId || selected.size === 0) return;
    setImporting(true);
    try {
      const ids = Array.from(selected);
      const newIds: string[] = [];
      let inserted = 0;
      let noPrice = 0;
      for (let i = 0; i < ids.length; i += 500) {
        const r = await doImport({
          data: { company_id: companyId, source_product_ids: ids.slice(i, i + 500), zero_stock: zeroStock },
        });
        inserted += r.inserted;
        noPrice += r.no_price ?? 0;
        newIds.push(...r.ids);
      }
      toast.success(`${inserted.toLocaleString("pt-BR")} produto(s) importado(s) para esta empresa.`);
      if (noPrice > 0)
        toast.warning(
          `${noPrice.toLocaleString("pt-BR")} produto(s) não foram importados: sem preço de venda pelas regras desta empresa (confira o marketplace padrão na Precificação).`,
        );

      if (createInBling && newIds.length > 0) {
        try {
          await doPush({ data: { company_id: companyId, product_ids: newIds, scope: "criar" } });
          toast.info("Cadastro dos produtos no Bling enfileirado.");
        } catch (e) {
          toast.error(
            `Produtos importados, mas o envio ao Bling falhou: ${e instanceof Error ? e.message : "erro"}`,
          );
        }
      }

      setItems((prev) => prev.filter((x) => !selected.has(x.id)));
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao importar.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5" /> Importar produtos corretos de outra empresa
            {summary && summary.unique_total > 0 && (
              <Badge variant="secondary">{summary.unique_total.toLocaleString("pt-BR")} disponível(is)</Badge>
            )}
          </span>
          <Button variant="ghost" size="sm" type="button" aria-label={open ? "Recolher" : "Expandir"}>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CardTitle>
        <CardDescription>
          Só entram produtos auditados, sem erros nem avisos, ativos na empresa de origem e cujo prefixo
          de SKU tenha fornecedor nesta empresa (para vincular automaticamente).
        </CardDescription>
      </CardHeader>
      {open && (
      <CardContent className="space-y-4">
        <div className="rounded-md border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            <span className="text-sm font-medium">Aprovados que faltam nesta empresa, por empresa</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={loadSummary} disabled={summaryLoading || importing}>
                {summaryLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Recontar
              </Button>
              <Button
                size="sm"
                onClick={() => importAll()}
                disabled={importing || !summary || summary.unique_total === 0}
              >
                Importar todos ({(summary?.unique_total ?? 0).toLocaleString("pt-BR")})
              </Button>
            </div>
          </div>
          {summaryLoading && !summary && (
            <p className="p-3 text-sm text-muted-foreground">Contando produtos…</p>
          )}
          {summary && summary.companies.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">Nenhuma outra empresa disponível.</p>
          )}
          {summary && summary.companies.length > 0 && (
            <div className="divide-y">
              {summary.companies.map((c) => (
                <div key={c.company_id} className="flex items-center justify-between gap-2 p-3 text-sm">
                  <span>{c.company_nome}</span>
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary">{c.missing.toLocaleString("pt-BR")} produto(s)</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={importing || c.missing === 0}
                      onClick={() => importAll(c.company_id, c.company_nome)}
                    >
                      Importar todos
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {summary && summary.companies.length > 1 && (
            <p className="border-t p-3 text-xs text-muted-foreground">
              O total geral não repete o mesmo SKU que existe em mais de uma empresa.
            </p>
          )}
          {phase && (
            <div className="border-t p-3 text-sm space-y-1">
              <div className="flex items-center gap-2 font-medium">
                <Loader2 className="h-4 w-4 animate-spin" /> {phase}…
              </div>
              <div className="text-xs text-muted-foreground">
                Em andamento há {phaseStart ? Math.floor((Date.now() - phaseStart) / 1000) : 0}s. Não feche esta página.
              </div>
            </div>
          )}
          {progress && (
            <p className="border-t p-3 text-sm">
              <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />
              Importando {progress.done.toLocaleString("pt-BR")} de {progress.total.toLocaleString("pt-BR")}…
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox id="cc-bling-all" checked={createInBling} onCheckedChange={(v) => setCreateInBling(!!v)} />
            <Label htmlFor="cc-bling-all" className="text-sm font-normal">Cadastrar também no Bling</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="cc-zero-all" checked={zeroStock} onCheckedChange={(v) => setZeroStock(!!v)} />
            <Label htmlFor="cc-zero-all" className="text-sm font-normal">Entrar com estoque zerado</Label>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Ou escolha produtos um a um:</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Filtrar por SKU ou nome (opcional)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(true); }}
          />
          <Button onClick={() => load(true)} disabled={!companyId || loading}>
            {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
            Buscar produtos aprovados
          </Button>
        </div>

        {loaded && (
          <p className="text-xs text-muted-foreground">
            {approvedTotal.toLocaleString("pt-BR")} produto(s) aprovados em outras empresas ·{" "}
            {items.length.toLocaleString("pt-BR")} disponível(is) para importar nesta lista
          </p>
        )}

        {items.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))))
                }
              >
                {selected.size === items.length ? "Limpar seleção" : "Selecionar todos da lista"}
              </Button>
            </div>

            <div className="max-h-96 divide-y overflow-y-auto rounded-md border">
              {items.map((it) => (
                <label key={it.id} className="flex cursor-pointer items-start gap-3 p-3 hover:bg-muted/40">
                  <Checkbox checked={selected.has(it.id)} onCheckedChange={() => toggle(it.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{it.nome ?? "(sem nome)"}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{it.codigo}</Badge>
                      <span>{it.company_nome}</span>
                      {it.marca && <span>· {it.marca}</span>}
                      {it.preco != null && (
                        <span>
                          · {it.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </span>
                      )}
                      {it.gtin && <span>· EAN {it.gtin}</span>}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="outline" size="sm" disabled={!cursor || loading} onClick={() => load(false)}>
                {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Carregar mais
              </Button>
              <Button disabled={selected.size === 0 || importing} onClick={confirmImport}>
                {importing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Importar {selected.size.toLocaleString("pt-BR")} produto(s)
              </Button>
            </div>
          </div>
        )}

        {loaded && items.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">
            Nenhum produto aprovado em outra empresa está faltando aqui. Rode a auditoria nas outras
            empresas para que os produtos corretos apareçam nesta lista.
          </p>
        )}
      </CardContent>
      )}
    </Card>
  );
}
