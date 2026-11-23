import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Loader2, Pickaxe, ExternalLink, X, Search, Download } from "lucide-react";
import {
  listMlCategories,
  startProspect,
  getProspectJob,
  cancelProspect,
  listProspectItems,
  reviewProspectItem,
  enrichProspectItem,
  prepareProspectItem,
} from "@/lib/ml-prospect.functions";
import { ProspectImportDialog, type PreparedProspect } from "@/components/ml-prospect-import-dialog";
import { loadAllProspectIds } from "@/components/ml-prospect-selection";

type Job = {
  id: string;
  status: string;
  target: number;
  found: number;
  processed: number;
  candidates_total: number;
  error: string | null;
  params: Record<string, unknown>;
} | null;

type ImportProgress = {
  done: number;
  total: number;
  imported: number;
  skipped: number;
  shortened: number;
  anatel: number;
  step: string;
};

function money(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function MlProspectTab({ companyId }: { companyId: string | null }) {
  const qc = useQueryClient();
  const fetchCategories = useServerFn(listMlCategories);
  const doStart = useServerFn(startProspect);
  const fetchJob = useServerFn(getProspectJob);
  const doCancel = useServerFn(cancelProspect);
  const fetchItems = useServerFn(listProspectItems);
  const doReview = useServerFn(reviewProspectItem);
  const doEnrich = useServerFn(enrichProspectItem);
  const doPrepare = useServerFn(prepareProspectItem);
  const [prepared, setPrepared] = useState<PreparedProspect[]>([]);
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichmentProgress, setEnrichmentProgress] = useState<{ done: number; total: number } | null>(null);
  const [reviewItem, setReviewItem] = useState<Record<string, any> | null>(null);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewNcm, setReviewNcm] = useState("");
  const [reviewAnatel, setReviewAnatel] = useState("");
  const [reviewDescription, setReviewDescription] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [reviewIssues, setReviewIssues] = useState<string[]>([]);
  const [savingReview, setSavingReview] = useState(false);

  const [selected, setSelected] = useState<string[]>([]);
  const [allCategories, setAllCategories] = useState(false);
  const [keywords, setKeywords] = useState("");
  const [target, setTarget] = useState(100);
  const [maxCost, setMaxCost] = useState(1000);
  const [maxWeight, setMaxWeight] = useState(30);
  const [maxLength, setMaxLength] = useState(70);
  const [requireMeasures, setRequireMeasures] = useState(true);
  const [quickCollect, setQuickCollect] = useState(false);
  const [shippingMode, setShippingMode] = useState<"full" | "tomorrow" | "two_days" | "deadline">("full");
  const [zipCode, setZipCode] = useState("87050-160");
  const [maxDeliveryDays, setMaxDeliveryDays] = useState(3);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [starting, setStarting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const categories = useQuery({
    queryKey: ["ml-categories"],
    queryFn: () => fetchCategories(),
    staleTime: 60 * 60 * 1000,
  });

  const job = useQuery<Job>({
    queryKey: ["ml-prospect-job", activeJobId],
    queryFn: () => fetchJob({ data: activeJobId ? { job_id: activeJobId } : {} }) as Promise<Job>,
    refetchIntervalInBackground: true,
    refetchInterval: (q) => {
      const s = (q.state.data as Job)?.status;
      return s === "pendente" || s === "processando" ? 3000 : false;
    },
  });

  const jobId = job.data?.id ?? null;
  const running = job.data?.status === "pendente" || job.data?.status === "processando";

  const items = useQuery({
    queryKey: ["ml-prospect-items", jobId],
    queryFn: () => fetchItems({ data: { job_id: jobId as string, page: 1, page_size: 200 } }),
    enabled: !!jobId,
    refetchInterval: running ? 4000 : false,
  });

  const rows = (items.data?.rows ?? []) as Array<Record<string, any>>;
  const totalItems = items.data?.total ?? rows.length;
  useEffect(() => { setPicked(new Set()); }, [jobId, companyId]);

  const selectAll = async () => {
    if (!jobId) return;
    setSelectingAll(true);
    try {
      const ids = await loadAllProspectIds((page, pageSize) =>
        fetchItems({ data: { job_id: jobId, page, page_size: pageSize } }),
      );
      setPicked(ids);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao selecionar todos os produtos.");
    } finally {
      setSelectingAll(false);
    }
  };

  const filtered = useMemo(
    () => (categories.data ?? []).filter((c: { id: string; name: string }) => !!c?.id),
    [categories.data],
  );

  const start = async () => {
    if (!/^\d{5}-?\d{3}$/.test(zipCode.trim())) {
      toast.error("Informe um CEP válido com oito dígitos.");
      return;
    }
    setStarting(true);
    try {
      const res = await doStart({
        data: {
          categories: allCategories ? [] : selected,
          all_categories: allCategories,
          keywords: keywords
            .split(/[,;\n]/)
            .map((k) => k.trim())
            .filter(Boolean),
          target,
          max_cost: maxCost,
          max_weight_kg: maxWeight,
          max_length_cm: maxLength,
          require_measures: quickCollect ? false : requireMeasures,
          quick_collect: quickCollect,
          shipping_mode: shippingMode === "two_days" ? "deadline" : shippingMode,
          zip_code: zipCode.trim(),
          max_delivery_days: shippingMode === "two_days" ? 2 : maxDeliveryDays,
        },
      });
      setActiveJobId(res.job_id);
      if (!res.already_running) qc.setQueryData(["ml-prospect-job", res.job_id], {
        id: res.job_id, status: "pendente", target, found: 0, processed: 0,
        candidates_total: 0, error: null, params: {},
      });
      if (res.already_running) toast.info("Já existe um garimpo em andamento.");
      else toast.success("Garimpo iniciado. Os produtos vão aparecendo abaixo.");
      await qc.invalidateQueries({ queryKey: ["ml-prospect-job"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao iniciar o garimpo.");
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!jobId) return;
    try {
      await doCancel({ data: { job_id: jobId } });
      toast.success("Garimpo encerrado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao cancelar o garimpo.");
    } finally {
      await qc.invalidateQueries({ queryKey: ["ml-prospect-job"] });
      await qc.invalidateQueries({ queryKey: ["ml-prospect-items"] });
    }
  };

  const togglePick = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const importPicked = async () => {
    if (!companyId) {
      toast.error("Selecione uma empresa no topo da página para importar.");
      return;
    }
    if (picked.size === 0) return;
    const ids = [...picked];
    setImporting(true);
    setProgress({ done: 0, total: ids.length, imported: 0, skipped: 0, shortened: 0, anatel: 0, step: "Buscando NCM, Anatel, medidas, fotos e descrição…" });
    const results: PreparedProspect[] = [];
    let done = 0;
    const queue = [...ids];
    // Three products at a time: each one may search the web for the missing data.
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const row = rows.find(r => String(r.id) === id) ?? { id };
        try {
          const res = await doPrepare({ data: { company_id: companyId, item_id: id } });
          results.push({ row: res.row as Record<string, any>, blockers: res.blockers.filter(b => !res.notes.includes(b)), notes: res.notes });
        } catch (e) {
          results.push({ row, blockers: [], notes: [], error: e instanceof Error ? e.message : "Falha ao buscar os dados." });
        }
        done++;
        setProgress(p => p ? { ...p, done } : p);
      }
    };
    try {
      await Promise.all([worker(), worker(), worker()]);
      setProgress(p => p ? { ...p, step: "Dados encontrados. Confira e importe." } : p);
      setPrepared(ids.map(id => results.find(r => String(r.row.id) === id)).filter((r): r is PreparedProspect => !!r));
      setPrepareOpen(true);
      await qc.invalidateQueries({ queryKey: ["ml-prospect-items"] });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {(starting || job.data) && (
        <section aria-label="Andamento do garimpo" aria-live="polite" className="sticky top-2 z-20 space-y-2 rounded-md border bg-background p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-medium">
              {(starting || running) && <Loader2 className="h-4 w-4 animate-spin" />}
              {starting ? "Iniciando garimpo…" : running ? (job.data?.candidates_total ? "Analisando produtos" : "Buscando candidatos") : job.data?.status === "cancelado" ? "Garimpo cancelado" : job.data?.status === "erro" ? "Busca interrompida" : "Busca encerrada"}
            </span>
            {running && <Button variant="destructive" size="sm" onClick={cancel}><X className="mr-1 h-4 w-4" />Cancelar</Button>}
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div><strong className="block text-lg tabular-nums">{job.data?.processed ?? 0}</strong>Analisados</div>
            <div><strong className="block text-lg tabular-nums">{job.data?.found ?? 0} / {job.data?.target ?? target}</strong>Encontrados</div>
            <div><strong className="block text-lg tabular-nums">{job.data?.candidates_total ?? 0}</strong>Candidatos</div>
          </div>
          <Progress value={job.data?.target ? Math.min(100, job.data.found / job.data.target * 100) : 0} />
          {job.data?.error && <p className="break-words text-sm text-muted-foreground">{job.data.error}</p>}
          {job.error && <p className="text-sm text-destructive">Não foi possível atualizar o andamento.</p>}
        </section>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Pickaxe className="h-5 w-5" /> Garimpo de produtos
          </CardTitle>
          <CardDescription>
            Procura no Mercado Livre produtos que a conta ainda não tem, com entrega
            conforme a modalidade escolhida, dentro do custo, peso e comprimento definidos. Não traz medicamentos.
            Cadastro no Bling somente após revisão e aprovação em todas as regras ativas, incluindo fotos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label>Quantos produtos garimpar</Label>
              <Input
                type="number"
                min={1}
                value={target}
                onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div>
              <Label>Custo máximo (preço + frete)</Label>
              <Input
                type="number"
                min={1}
                value={maxCost}
                onChange={(e) => setMaxCost(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div>
              <Label>Peso máximo (kg)</Label>
              <Input
                type="number"
                min={1}
                value={maxWeight}
                onChange={(e) => setMaxWeight(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div>
              <Label>Comprimento máximo (cm)</Label>
              <Input
                type="number"
                min={1}
                value={maxLength}
                onChange={(e) => setMaxLength(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
            <Label htmlFor="prospect-shipping">Envio</Label>
            <Select value={shippingMode} onValueChange={v => { if (v === "full" || v === "tomorrow" || v === "two_days" || v === "deadline") setShippingMode(v); }} disabled={starting || running}>
              <SelectTrigger id="prospect-shipping"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Envio Full</SelectItem>
                <SelectItem value="tomorrow">Chega amanhã</SelectItem>
                <SelectItem value="two_days">Chega amanhã ou em até 2 dias</SelectItem>
                <SelectItem value="deadline">Prazo máximo de chegada</SelectItem>
              </SelectContent>
            </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prospect-zip">CEP de entrega (Maringá: 87050-160)</Label>
              <Input id="prospect-zip" value={zipCode} inputMode="numeric" maxLength={9} onChange={e => setZipCode(e.target.value.replace(/[^\d-]/g, ""))} disabled={starting || running} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prospect-days">Chegada em até (dias corridos)</Label>
              <Input id="prospect-days" type="number" min={1} max={30} step={1} value={shippingMode === "two_days" ? 2 : maxDeliveryDays} onChange={e => setMaxDeliveryDays(Math.min(30, Math.max(1, Math.floor(Number(e.target.value) || 1))))} disabled={shippingMode !== "deadline" || starting || running} />
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={quickCollect}
              onCheckedChange={(v) => setQuickCollect(v === true)}
              disabled={starting || running}
            />
            <span>
              Coleta rápida: buscar só por prazo, custo, EAN, peso e comprimento
              <span className="block text-xs text-muted-foreground">Fotos, medidas e NCM são completados depois; nada vai ao Bling sem passar em todas as regras.</span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={quickCollect ? false : requireMeasures}
              onCheckedChange={(v) => setRequireMeasures(v === true)}
              disabled={quickCollect || starting || running}
            />
            Trazer somente produtos com peso e medidas informados
          </label>



          <div>
            <Label className="flex items-center gap-2">
              <Search className="h-4 w-4" /> Palavras-chave (separe por vírgula)
            </Label>
            <Input
              placeholder="furadeira, panela elétrica, fone bluetooth"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="prospect-categories">Categorias (mais vendidos)</Label>
            <Select value={allCategories ? "all" : "selected"} onValueChange={v => setAllCategories(v === "all")} disabled={starting || running}>
              <SelectTrigger id="prospect-categories" className="mt-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="selected">Escolher categorias</SelectItem>
                <SelectItem value="all">Sem categorias — todos os objetos</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-sm text-muted-foreground">Medicamentos, suplementos, alimentos e bebidas excluídos.</p>
            {!allCategories && (categories.isLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando categorias…
              </div>
            ) : (
              <div className="mt-2 grid max-h-60 gap-2 overflow-auto rounded-md border p-3 sm:grid-cols-3">
                {filtered.map((c: { id: string; name: string }) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.includes(c.id)}
                      disabled={starting || running}
                      onCheckedChange={(v) =>
                        setSelected((prev) =>
                          v ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                        )
                      }
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={start} disabled={starting || running}>
              {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pickaxe className="mr-2 h-4 w-4" />}
              Garimpar
            </Button>
            {running && (
              <Button variant="destructive" onClick={cancel}>
                <X className="mr-2 h-4 w-4" /> Cancelar
              </Button>
            )}
            {job.data && (
              <span className="text-sm text-muted-foreground">
                {job.data.status} · encontrados {job.data.found}/{job.data.target} · analisados{" "}
                {job.data.processed}
                {job.data.candidates_total ? ` de ${job.data.candidates_total} candidatos` : ""}
              </span>
            )}
          </div>
          {job.data?.error && <p className="text-sm text-destructive">{job.data.error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Candidatos do garimpo ({totalItems})</CardTitle>
          <CardDescription>
            Clique em “Todos os campos” para ver tudo que a API do Mercado Livre devolveu do
            produto. Selecione os que quiser e importe para a empresa selecionada: o SKU será
            ML + código do produto, o custo será o preço do Mercado Livre, o preço de venda é
            calculado pela regra da empresa. Ao importar, buscamos NCM, Anatel, marca, peso, medidas,
            fotos e descrição pelo EAN; você confere cada produto antes do cadastro.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 overflow-auto">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={selectAll} disabled={selectingAll || importing || enriching || !jobId || totalItems === 0}>
              {selectingAll && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Selecionar todos ({totalItems})
            </Button>
            {picked.size > 0 && <Button variant="ghost" disabled={selectingAll || importing || enriching} onClick={() => setPicked(new Set())}>Limpar seleção</Button>}
            <Button
              onClick={importPicked}
              disabled={selectingAll || importing || enriching || picked.size === 0 || !companyId}
            >
              {importing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Importar selecionados ({picked.size})
            </Button>
            <Button variant="outline" disabled={selectingAll || enriching || importing || !companyId || rows.length === 0} onClick={async () => {
              if (!companyId) return;
              const selectedRows = picked.size ? [...picked].map(id => ({ id })) : rows;
              setEnriching(true); setEnrichmentProgress({ done: 0, total: selectedRows.length });
              let complete = 0;
              try {
                for (let i = 0; i < selectedRows.length; i++) {
                  const row = selectedRows[i];
                  if (!row) continue;
                  const result = await doEnrich({ data: { company_id: companyId, item_id: String(row.id) } });
                  if (result.ean && result.ncm) complete++;
                  setEnrichmentProgress({ done: i + 1, total: selectedRows.length });
                  await qc.invalidateQueries({ queryKey: ["ml-prospect-items"] });
                }
                toast.success(`${complete} produto(s) com EAN e NCM disponível para revisão.`);
              } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao buscar os códigos."); }
              finally { setEnriching(false); }
            }}>
              {enriching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Buscar EAN/NCM{picked.size ? ` (${picked.size})` : ""}
            </Button>
            {!companyId && (
              <span className="text-sm text-muted-foreground">
                Selecione uma empresa no topo da página para importar.
              </span>
            )}
          </div>

          {enrichmentProgress && <p aria-live="polite" className="text-sm text-muted-foreground">Códigos conferidos: {enrichmentProgress.done} / {enrichmentProgress.total}</p>}
          {progress && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{progress.step}</span>
                <span className="text-muted-foreground">
                  {progress.done} de {progress.total}
                </span>
              </div>
              <Progress
                value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
              />
              {!importing && prepared.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setPrepareOpen(true)}>Abrir conferência</Button>
              )}
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="p-2">
                  <Checkbox
                    aria-label="Selecionar produtos desta página"
                    disabled={selectingAll || importing || enriching}
                    checked={rows.length > 0 && rows.every(r => picked.has(String(r.id))) ? true : rows.some(r => picked.has(String(r.id))) ? "indeterminate" : false}
                    onCheckedChange={(v) =>
                      setPicked(prev => {
                        const next = new Set(prev);
                        for (const row of rows) { if (v === true) next.add(String(row.id)); else next.delete(String(row.id)); }
                        return next;
                      })
                    }
                  />
                </th>
                <th className="p-2">Produto</th>
                <th className="p-2">Fotos</th>
                <th className="p-2">EAN</th>
                <th className="p-2">Custo (preço ML)</th>
                <th className="p-2">Frete</th>
                <th className="p-2">Total</th>
                <th className="p-2">NCM / CEST</th>
                <th className="p-2">Garantia</th>
                <th className="p-2">Cross</th>
                <th className="p-2">Peso</th>
                <th className="p-2">Maior medida</th>
                <th className="p-2">Entrega</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)} className="border-t">
                  <td className="p-2">
                    <Checkbox
                      aria-label={`Selecionar ${r.titulo ?? r.id}`}
                      disabled={selectingAll || importing || enriching}
                      checked={picked.has(String(r.id))}
                      onCheckedChange={(v) => togglePick(String(r.id), v === true)}
                    />
                  </td>
                  <td className="max-w-[320px] p-2">
                    <div className="truncate font-medium">{r.titulo ?? "—"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">
                        {`ML${String(r.catalog_product_id ?? "").replace(/^MLB/i, "")}`}
                      </span>
                      {" · "}
                      {r.marca ?? "—"} · {r.category_path ?? r.domain_id ?? "—"}
                    </div>
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      {((r.pictures as string[]) ?? []).slice(0, 3).map((u) => (
                        <img key={u} src={u} alt="" className="h-8 w-8 rounded object-cover" />
                      ))}
                      <span className="text-xs text-muted-foreground">
                        {Number(r.pictures_count ?? 0)}
                      </span>
                    </div>
                  </td>
                  <td className="p-2" title={r.raw?.identity?.ean_source ?? "EAN não publicado"}>{r.ean ?? "EAN pendente"}</td>
                  <td className="p-2 font-medium">{money(r.custo ?? r.price)}</td>
                  <td className="p-2">{money(r.shipping_cost)}</td>
                  <td className="p-2">{money(r.total_price)}</td>
                  <td className="p-2 text-xs">
                    {r.ncm ? String(r.ncm) : "NCM pendente"}
                    {r.ncm_fonte && <div className="max-w-48 whitespace-normal text-muted-foreground">{r.ncm_fonte}</div>}
                    <div className="text-muted-foreground">{r.cest ? String(r.cest) : "sem CEST"}</div>
                  </td>
                  <td className="p-2">{(r.garantia as string) ?? "3 meses"}</td>
                  <td className="p-2">{Number(r.crossdocking ?? 3)}</td>
                  <td className="p-2">{r.weight_kg ? `${Number(r.weight_kg).toFixed(2)} kg` : "—"}</td>
                  <td className="p-2">{r.length_cm ? `${Number(r.length_cm).toFixed(1)} cm` : "—"}</td>
                  <td className="p-2">
                    <Badge variant="secondary">
                      {r.is_full ? "Full · " : ""}{r.delivery_date ? new Date(r.delivery_date).toLocaleDateString("pt-BR") : "Prazo não informado"}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap p-2 text-right">
                    <Button variant="outline" size="sm" disabled={!companyId} onClick={() => {
                      setReviewItem(r); setReviewTitle(r.raw?.review?.titulo ?? r.titulo ?? ""); setReviewNcm(r.ncm ?? "");
                      setReviewAnatel(r.raw?.review?.anatel ?? ""); setReviewDescription(r.raw?.review?.descricao_curta ?? "");
                      setConfirmed(false); setReviewIssues([]);
                    }}>Revisar</Button>
                    <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>
                      Todos os campos
                    </Button>
                    {r.permalink && (
                      <a href={String(r.permalink)} target="_blank" rel="noreferrer">
                        <Button variant="ghost" size="sm">
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </a>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={14} className="p-6 text-center text-muted-foreground">
                    {running ? "Garimpando…" : "Nenhum produto garimpado ainda."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!reviewItem} onOpenChange={v => !v && setReviewItem(null)}>
        <DialogContent className="max-h-[85vh] overflow-auto">
          <DialogHeader><DialogTitle>Revisão do produto</DialogTitle><DialogDescription>{reviewItem?.titulo}</DialogDescription></DialogHeader>
          <Label>Título (até 60 caracteres)</Label><Input value={reviewTitle} onChange={e => setReviewTitle(e.target.value)} maxLength={60} />
          <Label>NCM conferido</Label><Input value={reviewNcm} onChange={e => setReviewNcm(e.target.value)} />
          <Label>Código Anatel ou Não se aplica</Label><Input value={reviewAnatel} onChange={e => setReviewAnatel(e.target.value)} />
          <Label>Descrição curta</Label><textarea className="min-h-32 w-full rounded-md border bg-background p-2 text-foreground" value={reviewDescription} onChange={e => setReviewDescription(e.target.value)} />
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={confirmed} onCheckedChange={v => setConfirmed(v === true)} />Confirmei o NCM e a homologação deste produto nas fontes corretas.</label>
          {reviewIssues.map((message, i) => <p key={i} className="text-sm text-destructive">{message}</p>)}
          <Button disabled={!confirmed || savingReview || !companyId} onClick={async () => {
            if (!companyId || !reviewItem) return;
            setSavingReview(true);
            try {
              const res = await doReview({ data: { company_id: companyId, item_id: reviewItem.id, titulo: reviewTitle, ncm: reviewNcm, anatel: reviewAnatel, descricao_curta: reviewDescription, ncm_confirmed: true, anatel_confirmed: true } });
              setReviewIssues(res.issues.map(x => x.message));
              toast.success("Revisão salva. As fotos e a oferta serão reconferidas ao importar.");
              await qc.invalidateQueries({ queryKey: ["ml-prospect-items"] });
            } catch (e) { toast.error(e instanceof Error ? e.message : "Falha na revisão."); }
            finally { setSavingReview(false); }
          }}>Salvar revisão</Button>
        </DialogContent>
      </Dialog>
      <ProspectImportDialog
        open={prepareOpen}
        onOpenChange={setPrepareOpen}
        companyId={companyId}
        prepared={prepared}
        onFinished={() => {
          setPicked(new Set());
          void qc.invalidateQueries({ queryKey: ["ml-prospect-items"] });
          void qc.invalidateQueries({ queryKey: ["suppliers"] });
        }}
      />
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{String(detail?.titulo ?? "Produto")}</DialogTitle>
            <DialogDescription>
              Todos os campos devolvidos pela API do Mercado Livre (produto, anúncio e frete).
            </DialogDescription>
          </DialogHeader>
          {detail && <ProspectDetail row={detail} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProspectDetail({ row }: { row: Record<string, any> }) {
  const raw = (row.raw ?? {}) as Record<string, any>;
  const product = (raw.product ?? {}) as Record<string, any>;
  const attrs = (product.attributes ?? []) as Array<{ id?: string; name?: string; value_name?: string }>;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.entries(row)
          .filter(([k]) => k !== "raw")
          .map(([k, v]) => (
            <div key={k} className="flex gap-2 border-b py-1">
              <span className="w-40 shrink-0 text-muted-foreground">{k}</span>
              <span className="break-all">{v === null || v === undefined ? "—" : String(v)}</span>
            </div>
          ))}
      </div>

      <div>
        <h4 className="mb-2 font-medium">Atributos do produto ({attrs.length})</h4>
        <div className="grid gap-1 sm:grid-cols-2">
          {attrs.map((a, i) => (
            <div key={`${a.id}-${i}`} className="flex gap-2 border-b py-1">
              <span className="w-48 shrink-0 text-muted-foreground">{a.name ?? a.id}</span>
              <span className="break-all">{a.value_name ?? "—"}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-2 font-medium">JSON completo da API</h4>
        <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify(raw, null, 2)}
        </pre>
      </div>
    </div>
  );
}
