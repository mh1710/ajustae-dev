import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, PackagePlus, X, List, ScanSearch, CheckCircle2 } from "lucide-react";
import { PageNumbers } from "@/components/page-numbers";
import {
  getSupplierCatalogSummary,
  listSupplierCatalogCandidates,
  startSupplierCatalogImport,
  listSupplierCatalogJobs,
  listSupplierCatalogItems,
  cancelSupplierCatalogImport,
} from "@/lib/supplier-catalog-import.functions";

const n = (v: number | null | undefined) => Number(v ?? 0).toLocaleString("pt-BR");
const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

const STATUS_LABEL: Record<string, string> = { executando: "Em andamento", concluido: "Concluída", cancelado: "Cancelada", erro: "Erro" };
const ITEM_TABS = [
  { value: "pendencia", label: "Com pendência" },
  { value: "importado", label: "Enviados ao Bling" },
  { value: "erro", label: "Erros" },
  { value: "ignorado", label: "Já existiam" },
  { value: "pendente", label: "Na fila" },
] as const;
const SCAN_TABS = [
  { value: "pronto", label: "Prontos" },
  { value: "pendencia", label: "Com pendência" },
  { value: "erro", label: "Erros" },
  { value: "pendente", label: "Na fila" },
] as const;
type ItemStatus = (typeof ITEM_TABS)[number]["value"] | (typeof SCAN_TABS)[number]["value"];

export function SupplierCatalogImportTab({ companyId }: { companyId: string | null }) {
  const qc = useQueryClient();
  const fetchSummary = useServerFn(getSupplierCatalogSummary);
  const fetchJobs = useServerFn(listSupplierCatalogJobs);
  const doStart = useServerFn(startSupplierCatalogImport);
  const doCancel = useServerFn(cancelSupplierCatalogImport);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState<string | null>(null);
  const [listing, setListing] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ["supplier-catalog-summary", companyId],
    queryFn: () => fetchSummary({ data: { company_id: companyId! } }),
    enabled: !!companyId,
  });
  const jobs = useQuery({
    queryKey: ["supplier-catalog-jobs", companyId],
    queryFn: () => fetchJobs({ data: { company_id: companyId! } }),
    enabled: !!companyId,
    refetchInterval: (q) => ((q.state.data ?? []).some((j) => j.status === "executando") ? 6000 : false),
  });

  // Quando um scanner ou importação termina, os números por fornecedor mudam.
  const running = (jobs.data ?? []).filter((j) => j.status === "executando").length;
  const lastRunning = useRef(running);
  useEffect(() => {
    if (running < lastRunning.current) void qc.invalidateQueries({ queryKey: ["supplier-catalog-summary", companyId] });
    lastRunning.current = running;
  }, [running, companyId, qc]);

  if (!companyId) return <div className="text-sm text-muted-foreground">Escolha a empresa no topo da página.</div>;

  const activeBySupplier = new Map((jobs.data ?? []).filter((j) => j.status === "executando").map((j) => [j.fornecedor_id, j]));

  async function start(fornecedorId: string, nome: string, modo: "importar" | "escanear", onlyReady = false) {
    const raw = (limits[fornecedorId] ?? "").trim();
    const limit = raw ? Number(raw) : undefined;
    if (raw && !(Number.isInteger(limit) && (limit ?? 0) > 0)) { toast.error("Informe uma quantidade inteira ou deixe em branco para todos."); return; }
    setStarting(`${fornecedorId}:${modo}:${onlyReady}`);
    try {
      const r = await doStart({ data: { company_id: companyId!, fornecedor_id: fornecedorId, modo, only_ready: onlyReady, ...(limit ? { limit } : {}) } });
      toast.success(modo === "escanear"
        ? `Scanner de ${nome} iniciado. Nada é enviado ao Bling; continua sozinho, mesmo com a página fechada.`
        : `Importação de ${nome} iniciada. Continua sozinha, mesmo com a página fechada.`);
      setOpenJob(r.job_id);
      await qc.invalidateQueries({ queryKey: ["supplier-catalog-jobs", companyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setStarting(null); }
  }

  async function cancel(jobId: string) {
    if (!window.confirm("Cancelar? Os produtos já enviados ao Bling e os já escaneados continuam como estão.")) return;
    try {
      await doCancel({ data: { job_id: jobId } });
      toast.success("Cancelado.");
      await qc.invalidateQueries({ queryKey: ["supplier-catalog-jobs", companyId] });
      await qc.invalidateQueries({ queryKey: ["supplier-catalog-summary", companyId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PackagePlus className="h-5 w-5" /> Novos do fornecedor</CardTitle>
          <CardDescription>
            Produtos que estão no fornecedor e ainda não estão no catálogo desta empresa. Elegível: custo maior que R$ 10 e menor que R$ 1.000,
            peso menor que 30 kg e maior medida até 70 cm. O que faltar é buscado pelo EAN em outros fornecedores, no Bling das outras empresas e no
            Mercado Livre, e só vão ao Bling os produtos que passam em todas as regras da auditoria. O scanner faz essa mesma busca e conferência sem
            enviar nada, para você ver quantos ficam prontos antes de importar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Contando produtos…</div>
          ) : summary.error ? (
            <div className="text-sm text-destructive">{(summary.error as Error).message}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Fornecedor</th>
                    <th className="px-3 py-2 font-medium">Prefixo do SKU</th>
                    <th className="px-3 py-2 font-medium text-right">Fora do catálogo</th>
                    <th className="px-3 py-2 font-medium text-right">Elegíveis</th>
                    <th className="px-3 py-2 font-medium text-right">Com estoque</th>
                    <th className="px-3 py-2 font-medium text-right">Completos no fornecedor</th>
                    <th className="px-3 py-2 font-medium text-right">Prontos no scanner</th>
                    <th className="px-3 py-2 font-medium">Importar</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary.data ?? []).map((s) => {
                    const active = activeBySupplier.get(s.fornecedor_id);
                    return (
                      <tr key={s.fornecedor_id} className="border-t align-top">
                        <td className="px-3 py-2 font-medium">{s.nome}</td>
                        <td className="px-3 py-2 font-mono text-xs">{s.prefixo ?? "—"}</td>
                        <td className="px-3 py-2 text-right">
                          {n(s.fora_catalogo)}
                          <div className="text-xs text-muted-foreground">fora da faixa: {n(s.fora_custo)} custo · {n(s.fora_peso)} peso · {n(s.fora_comprimento)} medida</div>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">{n(s.elegiveis)}</td>
                        <td className="px-3 py-2 text-right">{n(s.com_estoque)}</td>
                        <td className="px-3 py-2 text-right">{n(s.completos)}</td>
                        <td className="px-3 py-2 text-right">
                          {s.escaneados ? (
                            <>
                              <span className="font-semibold">{n(s.prontos_scanner)}</span>
                              <div className="text-xs text-muted-foreground">de {n(s.escaneados)} escaneados</div>
                            </>
                          ) : <span className="text-xs text-muted-foreground">Não escaneado</span>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Input
                              className="w-28" inputMode="numeric" placeholder="Todos"
                              value={limits[s.fornecedor_id] ?? ""}
                              onChange={(e) => setLimits((l) => ({ ...l, [s.fornecedor_id]: e.target.value.replace(/\D/g, "") }))}
                              aria-label={`Quantidade de ${s.nome}`}
                            />
                            <Button size="sm" variant="outline" onClick={() => start(s.fornecedor_id, s.nome, "escanear")} disabled={!!active || !!starting || !s.elegiveis}>
                              {starting === `${s.fornecedor_id}:escanear:false` ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ScanSearch className="h-4 w-4 mr-2" />}
                              {active?.modo === "escanear" ? "Escaneando…" : "Escanear"}
                            </Button>
                            {s.prontos_scanner > 0 && (
                              <Button size="sm" onClick={() => start(s.fornecedor_id, s.nome, "importar", true)} disabled={!!active || !!starting}>
                                {starting === `${s.fornecedor_id}:importar:true` ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                                Importar prontos
                              </Button>
                            )}
                            <Button size="sm" variant={s.prontos_scanner > 0 ? "secondary" : "default"} onClick={() => start(s.fornecedor_id, s.nome, "importar")} disabled={!!active || !!starting || !s.elegiveis}>
                              {starting === `${s.fornecedor_id}:importar:false` ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PackagePlus className="h-4 w-4 mr-2" />}
                              {active?.modo === "importar" ? "Importando…" : "Importar elegíveis"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setListing(listing === s.fornecedor_id ? null : s.fornecedor_id)}>
                              <List className="h-4 w-4 mr-2" /> {listing === s.fornecedor_id ? "Fechar lista" : "Ver lista"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground">
                Produtos sem estoque também entram, com estoque 0, e sobem quando o fornecedor tiver. O SKU novo usa o prefixo mais usado nesta empresa para o fornecedor.
                “Importar prontos” leva só os que ficaram 100% no último scanner, conferindo tudo de novo antes de enviar. A quantidade vale para os três botões.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {listing && <CandidateList companyId={companyId} fornecedorId={listing} prefix={summary.data?.find((s) => s.fornecedor_id === listing)?.prefixo ?? ""} />}

      <Card>
        <CardHeader>
          <CardTitle>Scanners e importações</CardTitle>
          <CardDescription>Progresso desta empresa. Atualiza a cada 6 segundos enquanto algum está em andamento.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {jobs.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : !(jobs.data ?? []).length ? (
            <div className="text-sm text-muted-foreground">Nenhuma importação ainda.</div>
          ) : (
            (jobs.data ?? []).map((j) => {
              const pct = j.total ? Math.round((j.processed / j.total) * 100) : 0;
              return (
                <div key={j.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{j.fornecedor_nome}</span>
                      <Badge variant="outline">{j.modo === "escanear" ? "Scanner" : j.only_ready ? "Importação dos prontos" : "Importação"}</Badge>
                      <Badge variant={j.status === "executando" ? "default" : "secondary"}>{STATUS_LABEL[j.status] ?? j.status}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(j.created_at).toLocaleString("pt-BR")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setOpenJob(openJob === j.id ? null : j.id)}>{openJob === j.id ? "Fechar detalhes" : "Ver detalhes"}</Button>
                      {j.status === "executando" && (
                        <Button size="sm" variant="ghost" onClick={() => cancel(j.id)}><X className="h-4 w-4 mr-1" /> Cancelar</Button>
                      )}
                    </div>
                  </div>
                  <Progress value={pct} />
                  <div className="text-sm flex flex-wrap gap-x-4 gap-y-1">
                    <span>{n(j.processed)} de {n(j.total)} analisados</span>
                    {j.modo === "escanear"
                      ? <span className="font-medium">{n(j.ready)} prontos (100%)</span>
                      : <span className="font-medium">{n(j.imported)} enviados ao Bling</span>}
                    <span>{n(j.pending)} com pendência</span>
                    {j.failed > 0 && <span className="text-destructive">{n(j.failed)} com erro</span>}
                    {j.ignored > 0 && <span>{n(j.ignored)} já existiam</span>}
                  </div>
                  {j.waiting_reason && <div className="text-xs text-muted-foreground">{j.waiting_reason}</div>}
                  {j.last_error && <div className="text-xs text-destructive">{j.last_error}</div>}
                  {openJob === j.id && <JobItems jobId={j.id} running={j.status === "executando"} scan={j.modo === "escanear"} />}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CandidateList({ companyId, fornecedorId, prefix }: { companyId: string; fornecedorId: string; prefix: string }) {
  const fetchList = useServerFn(listSupplierCatalogCandidates);
  const [page, setPage] = useState(1);
  const PAGE = 50;
  const q = useQuery({
    queryKey: ["supplier-catalog-candidates", companyId, fornecedorId, page],
    queryFn: () => fetchList({ data: { company_id: companyId, fornecedor_id: fornecedorId, page, page_size: PAGE } }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Produtos elegíveis</CardTitle>
        <CardDescription>
          {n(q.data?.total)} produtos. “Completo” = o fornecedor já traz EAN, NCM, marca, peso, medidas, 3 fotos e descrição. “Pronto” = o scanner
          completou o que faltava e o produto passou em todas as regras.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">SKU novo</th>
                    <th className="px-3 py-2 font-medium">Título</th>
                    <th className="px-3 py-2 font-medium">Marca</th>
                    <th className="px-3 py-2 font-medium">EAN</th>
                    <th className="px-3 py-2 font-medium text-right">Estoque</th>
                    <th className="px-3 py-2 font-medium text-right">Custo</th>
                    <th className="px-3 py-2 font-medium">Dados</th>
                  </tr>
                </thead>
                <tbody>
                  {(q.data?.rows ?? []).map((r) => (
                    <tr key={r.fornecedor_produto_id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{prefix}{r.codigo}</td>
                      <td className="px-3 py-2">{r.titulo ?? "—"}</td>
                      <td className="px-3 py-2">{r.marca ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.ean ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{n(r.qt_estoque)}</td>
                      <td className="px-3 py-2 text-right">{brl(r.custo)}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.scan?.status === "pronto" ? <Badge>Pronto</Badge>
                          : r.scan ? (r.scan.issues ?? []).map((i, k) => <div key={k} className="text-muted-foreground">{i}</div>)
                          : r.completo ? <Badge variant="secondary">Completo</Badge>
                          : <span className="text-muted-foreground">Ainda não escaneado</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PageNumbers page={page} pageSize={PAGE} total={q.data?.total ?? 0} onChange={setPage} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function JobItems({ jobId, running, scan }: { jobId: string; running: boolean; scan: boolean }) {
  const fetchItems = useServerFn(listSupplierCatalogItems);
  const tabs = scan ? SCAN_TABS : ITEM_TABS;
  const [status, setStatus] = useState<ItemStatus>(scan ? "pronto" : "pendencia");
  const [page, setPage] = useState(1);
  const PAGE = 50;
  const q = useQuery({
    queryKey: ["supplier-catalog-items", jobId, status, page],
    queryFn: () => fetchItems({ data: { job_id: jobId, status, page, page_size: PAGE } }),
    refetchInterval: running ? 6000 : false,
  });
  return (
    <div className="space-y-3 pt-2">
      <Tabs value={status} onValueChange={(v) => { setStatus(v as ItemStatus); setPage(1); }}>
        <TabsList>{tabs.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}</TabsList>
      </Tabs>
      {q.isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
      ) : !(q.data?.rows ?? []).length ? (
        <div className="text-sm text-muted-foreground">Nenhum produto aqui.</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 font-medium">Título</th>
                  <th className="px-3 py-2 font-medium">{status === "importado" || status === "pronto" ? "Completado com" : "Motivo"}</th>
                </tr>
              </thead>
              <tbody>
                {(q.data?.rows ?? []).map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="px-3 py-2 font-mono text-xs">{r.sku}</td>
                    <td className="px-3 py-2">{r.titulo ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {status === "importado" || status === "pronto"
                        ? sourceText(r.sources) || "Dados do fornecedor"
                        : (r.issues ?? []).map((i, k) => <div key={k}>{i}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PageNumbers page={page} pageSize={PAGE} total={q.data?.total ?? 0} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function sourceText(s: Record<string, string | number | boolean | string[] | null> | null | undefined) {
  if (!s) return "";
  const parts: string[] = [];
  if (s["medidas"]) parts.push("medidas do Mercado Livre");
  if (s["marca"]) parts.push("marca do Mercado Livre");
  if (s["descricao"]) parts.push("descrição do Mercado Livre");
  if (s["fotos_ml"]) parts.push(`${s["fotos_ml"]} fotos do Mercado Livre`);
  if (s["fotos_bling"]) parts.push(`${s["fotos_bling"]} fotos de outra empresa (mesmo EAN)`);
  if (s["ncm"]) parts.push(`NCM: ${String(s["ncm"])}`);
  if (s["anatel"]) parts.push("código Anatel da base");
  return parts.join(" · ");
}
