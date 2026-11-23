import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw, Pause, Play, X, PencilLine, ListChecks, AlertTriangle, RotateCcw, Wand2, Trash2 } from "lucide-react";
import { listMyCompanies } from "@/lib/companies.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import { PageNumbers } from "@/components/page-numbers";
import { customFieldEditScope } from "@/lib/custom-field-edit-scope";
import { assignCustomFieldRole } from "@/lib/custom-field-role-assignment";
import { customFieldOptions, customFieldValueAllowed, CUSTOM_FIELD_TIPO_NOMES } from "@/lib/custom-field-options";
import { CUSTOM_FIELD_FIXED_VALUES } from "@/lib/custom-field-fixed-values";
import {
  getCustomFieldsOverview, listProductCustomFields, startCustomFieldsSync, clearLocalCustomFields, refreshCustomFieldDefinitions,
  startCustomFieldsBulkEdit, controlCustomFieldJob, type CustomFieldJob,
  listCustomFieldJobErrors, retryCustomFieldErrors, saveCustomFieldRoles, startCustomFieldsAuto,
} from "@/lib/bling-custom-fields.functions";

export const Route = createFileRoute("/_authenticated/campos-customizados")({
  head: () => ({
    meta: [
      { title: "Campos customizados | Ajustta-Ê" },
      { name: "description", content: "Campos customizados dos produtos do Bling, com edição em massa." },
      { property: "og:title", content: "Campos customizados | Ajustta-Ê" },
      { property: "og:description", content: "Veja e edite em massa os campos customizados dos produtos do Bling." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomFieldsPage,
});

const PAGE_SIZE = 50;
const NONE = "__none";
const ROLES = [
  { key: "mapa", label: "Mapa", rule: "Não se aplica" },
  { key: "anvisa", label: "Anvisa", rule: "Não se aplica" },
  { key: "anatel_homologacao", label: "Código Homologação Anatel", rule: "Código Anatel do produto, ou Não se aplica" },
  { key: "anatel", label: "Anatel", rule: "Código Anatel do produto, ou Não se aplica" },
  { key: "garantia", label: "Meses de Garantia", rule: "3" },
  { key: "garantia_extenso", label: "Garantia por extenso", rule: "3 meses" },
  { key: "modelo", label: "Modelo", rule: "Do fornecedor, ou Mercado Livre pelo EAN/título" },
] as const;
const ALL = "__all";
const CLEAR = "__limpar";
const ATUAL = "__atual";

function JobLine({ job, fieldName, onControl, onShowErrors }: { job: CustomFieldJob; fieldName?: string; onControl: (a: "pause" | "resume" | "cancel") => void; onShowErrors: () => void }) {
  const pct = job.total > 0 ? Math.min(100, Math.round((job.done_count / job.total) * 100)) : 0;
  const active = job.status === "executando" || job.status === "pausado";
  const label = job.kind === "sync" ? "Buscar campos no Bling" : job.kind === "auto" ? "Atualização automática dos campos" : `Editar "${fieldName ?? "campo"}" → "${job.valor ?? ""}"`;
  return (
    <div className="space-y-1 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">{label}</span>
          <Badge variant={job.status === "erro" ? "destructive" : job.status === "concluido" ? "secondary" : "outline"}>{job.status}</Badge>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{job.done_count} / {job.total}{job.error_count > 0 && ` · ${job.error_count} erro(s)`}</span>
          {job.kind !== "sync" && job.error_count > 0 && <Button size="sm" variant="outline" onClick={onShowErrors}><AlertTriangle className="mr-1 h-3 w-3" /> Ver erros</Button>}
          {job.status === "executando" && <Button size="sm" variant="outline" onClick={() => onControl("pause")}><Pause className="h-3 w-3" /></Button>}
          {(job.status === "pausado" || job.status === "erro") && <Button size="sm" variant="outline" onClick={() => onControl("resume")}><Play className="h-3 w-3" /></Button>}
          {(active || job.status === "erro") && <Button size="sm" variant="outline" onClick={() => onControl("cancel")}><X className="h-3 w-3" /></Button>}
        </div>
      </div>
      {active && <Progress value={pct} />}
      {job.last_error && <p className="text-xs text-destructive">{job.last_error}</p>}
    </div>
  );
}

function CustomFieldsPage() {
  const qc = useQueryClient();
  const fetchCompanies = useServerFn(listMyCompanies);
  const fnOverview = useServerFn(getCustomFieldsOverview);
  const fnList = useServerFn(listProductCustomFields);
  const fnSync = useServerFn(startCustomFieldsSync);
  const fnBulk = useServerFn(startCustomFieldsBulkEdit);
  const fnControl = useServerFn(controlCustomFieldJob);
  const fnClear = useServerFn(clearLocalCustomFields);
  const fnDefinitions = useServerFn(refreshCustomFieldDefinitions);
  const [clearCompany, setClearCompany] = useState<string | null>(null);
  const [clearMode, setClearMode] = useState("all");

  const companies = useQuery({ queryKey: ["companies"], queryFn: () => fetchCompanies() });
  const [companyId, setCompanyId] = useSelectedCompany();
  useEffect(() => { if (!companyId && companies.data?.[0]) setCompanyId(companies.data[0].id); }, [companies.data, companyId, setCompanyId]);

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 400); return () => clearTimeout(t); }, [search]);
  const [filterField, setFilterField] = useState<string>(ALL);
  const [filterMode, setFilterMode] = useState<"vazio" | "preenchido">("vazio");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => { setPage(0); setSelected(new Set()); }, [companyId, debounced, filterField, filterMode]);

  const overview = useQuery({
    queryKey: ["cf-overview", companyId],
    queryFn: () => {
      if (!companyId) throw new Error("Selecione uma empresa.");
      return fnOverview({ data: { company_id: companyId } });
    },
    enabled: !!companyId,
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => j.status === "executando") ? 4000 : false),
  });
  const running = overview.data?.jobs.some((j) => j.status === "executando");

  const filter = useMemo(() => ({
    search: debounced || undefined,
    field_id: filterField !== ALL ? filterField : undefined,
    field_mode: filterField !== ALL ? filterMode : undefined,
  }), [debounced, filterField, filterMode]);

  const list = useQuery({
    queryKey: ["cf-list", companyId, filter, page],
    queryFn: () => {
      if (!companyId) throw new Error("Selecione uma empresa.");
      return fnList({ data: { company_id: companyId, ...filter, page, page_size: PAGE_SIZE } });
    },
    enabled: !!companyId,
    refetchInterval: running ? 8000 : false,
  });

  const fields = overview.data?.fields ?? [];
  const fieldName = (id: string | null) => fields.find((f) => f.id === id)?.nome ?? undefined;
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const activeJob = overview.data?.jobs.find((j) => j.status === "executando" || j.status === "pausado");

  const fnSaveRoles = useServerFn(saveCustomFieldRoles);
  const fnAuto = useServerFn(startCustomFieldsAuto);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [roleValores, setRoleValores] = useState<Record<string, string | null>>({});
  useEffect(() => { setRoles(overview.data?.roles ?? {}); setRoleValores(overview.data?.valores ?? {}); }, [overview.data?.roles, overview.data?.valores]);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoScope, setAutoScope] = useState<"selected" | "filtered">("filtered");

  async function saveRoles() {
    if (!companyId) return;
    try {
      const payload: Record<string, string | null> = {};
      const valores: Record<string, string | null> = {};
      for (const r of ROLES) { payload[r.key] = roles[r.key] ?? null; valores[r.key] = roleValores[r.key] ?? null; }
      await fnSaveRoles({ data: { company_id: companyId, roles: payload as any, valores: valores as any } });
      toast.success("Campos apontados salvos.");
      qc.invalidateQueries({ queryKey: ["cf-overview", companyId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao salvar"); }
  }

  async function doAuto() {
    if (!companyId) return;
    setBusy(true);
    try {
      const r = await fnAuto({ data: { company_id: companyId, ...(autoScope === "selected" ? { product_ids: [...selected] } : { filter }) } });
      toast.success(`Atualização iniciada em ${r.total} produto(s).`);
      setAutoOpen(false); setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["cf-overview", companyId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao iniciar"); }
    finally { setBusy(false); }
  }
  const rolesSaved = Object.keys(overview.data?.roles ?? {}).length > 0;
  const rolesDirty = ROLES.some((r) => (roles[r.key] ?? "") !== (overview.data?.roles?.[r.key] ?? ""))
    || ROLES.some((r) => (roleValores[r.key] ?? "") !== (overview.data?.valores?.[r.key] ?? ""));

  const [errorsJob, setErrorsJob] = useState<CustomFieldJob | null>(null);

  // Edição em massa
  const [editOpen, setEditOpen] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [valor, setValor] = useState("");
  const [scope, setScope] = useState<"selected" | "filtered">("selected");
  const [busy, setBusy] = useState(false);
  const [individual, setIndividual] = useState<{ id: string; codigo: string | null; nome: string | null; valores: Record<string, string | null> } | null>(null);
  useEffect(() => { setEditOpen(false); setIndividual(null); }, [companyId]);

  function openEdit() {
    setIndividual(null);
    setValor("");
    setScope(selected.size > 0 ? "selected" : "filtered");
    if (!target && fields[0]) setTarget(fields[0].id);
    setEditOpen(true);
  }

  function openIndividualEdit(row: typeof rows[number]) {
    const first = fields[0];
    if (!first) return;
    setIndividual({ id: row.id, codigo: row.codigo, nome: row.nome, valores: row.valores ?? {} });
    setTarget(first.id);
    setValor(row.valores?.[first.id] ?? "");
    setEditOpen(true);
  }

  async function doSync() {
    if (!companyId) return;
    setBusy(true);
    try { await fnSync({ data: { company_id: companyId } }); toast.success("Busca dos campos iniciada."); qc.invalidateQueries({ queryKey: ["cf-overview", companyId] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao iniciar"); }
    finally { setBusy(false); }
  }

  async function doClear() {
    if (!clearCompany || clearCompany !== companyId) return;
    setBusy(true);
    try {
      const result = await fnClear({ data: { company_id: clearCompany, reset_definitions: clearMode === "all" } });
      toast.success(`${result.values_deleted} valor(es) e ${result.fields_deleted} campo(s) removidos apenas do Ajustta-e.`);
      setClearCompany(null); setSelected(new Set()); setFilterField(ALL); setTarget("");
      if (clearMode === "all") setRoles({});
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["cf-overview", companyId] }),
        qc.invalidateQueries({ queryKey: ["cf-list", companyId] }),
      ]);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao limpar"); }
    finally { setBusy(false); }
  }

  async function doDefinitions() {
    if (!companyId) return;
    setBusy(true);
    try {
      const result = await fnDefinitions({ data: { company_id: companyId } });
      toast.success(`${result.count} campo(s) encontrado(s).`);
      await qc.invalidateQueries({ queryKey: ["cf-overview", companyId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao buscar campos"); }
    finally { setBusy(false); }
  }

  async function doBulk() {
    if (!companyId || !target) return;
    setBusy(true);
    try {
      const r = await fnBulk({ data: {
        company_id: companyId, target_field_id: target, valor,
        ...customFieldEditScope(individual?.id ?? null, scope, selected, filter),
      } });
      toast.success(`Edição iniciada em ${r.total} produto(s). Os valores serão gravados no Bling.`);
      setEditOpen(false); setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["cf-overview", companyId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao editar"); }
    finally { setBusy(false); }
  }

  async function control(job: CustomFieldJob, action: "pause" | "resume" | "cancel") {
    if (!companyId) return;
    try { await fnControl({ data: { company_id: companyId, job_id: job.id, action } }); qc.invalidateQueries({ queryKey: ["cf-overview", companyId] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  // Campo escolhido na edição: se for lista suspensa, o valor só pode vir das opções do Bling.
  const targetField = fields.find((f) => f.id === target);
  const targetOptions = customFieldOptions(targetField);
  const targetIsList = targetOptions.length > 0;
  const valorNormalizado = valor.trim();
  const valorAtualForaDaLista =
    valorNormalizado !== "" && !targetOptions.some((o) => o.toLowerCase() === valorNormalizado.toLowerCase());

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight"><ListChecks className="h-7 w-7" /> Campos customizados</h1>
          <p className="text-sm text-muted-foreground">Campos customizados dos produtos no Bling da empresa selecionada.</p>
        </div>
        <div className="w-56">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger><SelectValue placeholder="Empresa" /></SelectTrigger>
            <SelectContent>{companies.data?.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle>Buscar no Bling</CardTitle>
            <CardDescription>
              {fields.length} campo(s) encontrado(s) · {overview.data?.total_products ?? 0} produtos.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { setClearMode("all"); setClearCompany(companyId || null); }} disabled={busy || !!activeJob || !companyId}>
              <Trash2 className="mr-2 h-4 w-4" /> Limpar no Ajustta-e
            </Button>
            <Button variant="outline" onClick={doDefinitions} disabled={busy || !!activeJob || !companyId}>
              <ListChecks className="mr-2 h-4 w-4" /> Buscar só a lista de campos
            </Button>
            <Button onClick={doSync} disabled={busy || !!activeJob || !companyId}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Puxar campos customizados
            </Button>
            <Button variant="outline" onClick={openEdit} disabled={fields.length === 0 || !!activeJob}>
              <PencilLine className="mr-2 h-4 w-4" /> Editar em massa
            </Button>
          </div>
        </CardHeader>
        {(overview.data?.jobs.length ?? 0) > 0 && (
          <CardContent className="space-y-2">
            {overview.data?.jobs.slice(0, 3).map((j) => <JobLine key={j.id} job={j} fieldName={fieldName(j.field_id)} onControl={(a) => control(j, a)} onShowErrors={() => setErrorsJob(j)} />)}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle>Atualização automática</CardTitle>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={saveRoles} disabled={!rolesDirty || fields.length === 0 || !!activeJob}>Salvar campos</Button>
            <Button onClick={() => { setAutoScope(selected.size > 0 ? "selected" : "filtered"); setAutoOpen(true); }}
              disabled={!rolesSaved || rolesDirty || !!activeJob || fields.length === 0}>
              <Wand2 className="mr-2 h-4 w-4" /> Atualizar campos
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {fields.length === 0 && <p className="text-sm text-muted-foreground md:col-span-2">Nenhum campo encontrado para esta empresa.</p>}
          {fields.map((f) => {
            const assigned = ROLES.find((r) => roles[r.key] === f.id);
            const opcoes = customFieldOptions(f);
            const tipo = f.tipo_campo_id != null ? CUSTOM_FIELD_TIPO_NOMES[f.tipo_campo_id] : null;
            const fixo = assigned ? CUSTOM_FIELD_FIXED_VALUES[assigned.key] : undefined;
            const escolhido = assigned && fixo ? (roleValores[assigned.key] ?? fixo) : "";
            const foraDaLista = !!assigned && !customFieldValueAllowed(escolhido, f);
            return (
              <div key={f.id} className="min-w-0 space-y-1">
                <Label htmlFor={`auto-field-${f.id}`} className="break-words">
                  {f.nome}
                  {tipo && <span className="ml-1 text-xs font-normal text-muted-foreground">({tipo.toLowerCase()})</span>}
                </Label>
                <Select value={assigned?.key ?? NONE} disabled={!!activeJob} onValueChange={(v) => setRoles((p) => assignCustomFieldRole(p, f.id, v === NONE ? null : v))}>
                  <SelectTrigger id={`auto-field-${f.id}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Não atualizar</SelectItem>
                    {ROLES.map((r) => <SelectItem key={r.key} value={r.key} disabled={!!roles[r.key] && roles[r.key] !== f.id}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {assigned && <p className="text-xs text-muted-foreground">{assigned.rule}</p>}
                {assigned && fixo && opcoes.length > 0 && (
                  <Select
                    aria-label={`Valor do campo ${f.nome}`}
                    value={escolhido && opcoes.some((o) => o === escolhido) ? escolhido : "__fixo"}
                    disabled={!!activeJob}
                    onValueChange={(v) => setRoleValores((p) => ({ ...p, [assigned.key]: v === "__fixo" ? "" : v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      {escolhido && !opcoes.some((o) => o === escolhido) && <SelectItem value="__fixo">{escolhido} (valor da regra)</SelectItem>}
                    </SelectContent>
                  </Select>
                )}
                {opcoes.length > 0 && <p className="text-xs text-muted-foreground">Opções da lista: {opcoes.join(" · ")}</p>}
                {foraDaLista && (
                  <p className="flex items-start gap-1 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    A lista do Bling não tem "{escolhido || fixo}". Crie essa opção no Bling antes de atualizar este campo.
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={!!clearCompany} onOpenChange={(open) => { if (!open && !busy) setClearCompany(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Limpar campos de {companies.data?.find((c) => c.id === clearCompany)?.nome}</DialogTitle>
            <DialogDescription>Esta limpeza afeta somente o Ajustta-e. Nada será apagado ou alterado no Bling. O histórico das tarefas de campos desta empresa também será removido.</DialogDescription>
          </DialogHeader>
          <RadioGroup value={clearMode} onValueChange={setClearMode} disabled={busy}>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="all" id="clear-all" />
              <Label htmlFor="clear-all">Campos, valores e apontamentos automáticos</Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="values" id="clear-values" />
              <Label htmlFor="clear-values">Somente os valores dos produtos (manter campos e apontamentos)</Label>
            </div>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setClearCompany(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={busy || clearCompany !== companyId} onClick={doClear}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />} Confirmar limpeza local
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={autoOpen} onOpenChange={setAutoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atualizar campos customizados</DialogTitle>
            <DialogDescription>Os valores são calculados para cada produto e gravados no Bling.</DialogDescription>
          </DialogHeader>
          <RadioGroup value={autoScope} onValueChange={(v) => setAutoScope(v as "selected" | "filtered")}>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="selected" id="au-sel" disabled={selected.size === 0} />
              <Label htmlFor="au-sel">Apenas os selecionados ({selected.size})</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="filtered" id="au-all" />
              <Label htmlFor="au-all">Todos os produtos do filtro atual ({total})</Label>
            </div>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutoOpen(false)}>Cancelar</Button>
            <Button onClick={doAuto} disabled={busy || (autoScope === "selected" && selected.size === 0)}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Atualizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle>Produtos</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input className="w-64" placeholder="Buscar por SKU ou nome" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={filterField} onValueChange={setFilterField}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Filtrar por campo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os produtos</SelectItem>
                {fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            {filterField !== ALL && (
              <Select value={filterMode} onValueChange={(v) => setFilterMode(v as "vazio" | "preenchido")}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vazio">Vazio</SelectItem>
                  <SelectItem value="preenchido">Preenchido</SelectItem>
                </SelectContent>
              </Select>
            )}
            <span className="text-sm text-muted-foreground">{total} produto(s){selected.size > 0 && ` · ${selected.size} selecionado(s)`}</span>
          </div>
        </CardHeader>
        <CardContent>
          {fields.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum campo customizado ainda. Clique em "Puxar campos customizados". Se continuar vazio, a empresa não tem campos customizados de produtos no Bling.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="w-8 p-2"><Checkbox checked={allOnPage} onCheckedChange={(v) => {
                      const n = new Set(selected); rows.forEach((r) => (v ? n.add(r.id) : n.delete(r.id))); setSelected(n);
                    }} /></th>
                    <th className="p-2">SKU</th>
                    <th className="p-2">Nome</th>
                     <th className="p-2">Editar</th>
                    {fields.map((f) => <th key={f.id} className="whitespace-nowrap p-2">{f.nome}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {list.isLoading && <tr><td colSpan={4 + fields.length} className="p-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/40">
                      <td className="p-2"><Checkbox checked={selected.has(r.id)} onCheckedChange={(v) => {
                        const n = new Set(selected); if (v) n.add(r.id); else n.delete(r.id); setSelected(n);
                      }} /></td>
                      <td className="whitespace-nowrap p-2 font-mono">{r.codigo}</td>
                      <td className="max-w-xs truncate p-2" title={r.nome ?? ""}>{r.nome}</td>
                       <td className="p-2"><Button size="icon" variant="ghost" title={`Editar campos de ${r.codigo}`} aria-label={`Editar campos de ${r.codigo}`} disabled={busy || !!activeJob} onClick={() => openIndividualEdit(r)}><PencilLine className="h-4 w-4" /></Button></td>
                      {fields.map((f) => {
                        const v = r.valores?.[f.id];
                        return <td key={f.id} className="max-w-[200px] truncate p-2" title={v ?? ""}>{v ? v : <span className="text-muted-foreground">—</span>}</td>;
                      })}
                    </tr>
                  ))}
                  {!list.isLoading && rows.length === 0 && <tr><td colSpan={4 + fields.length} className="p-6 text-center text-muted-foreground">Nenhum produto.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {total > PAGE_SIZE && (
            <div className="mt-4 flex justify-center">
              <PageNumbers page={page + 1} pageSize={PAGE_SIZE} total={total} onChange={(p) => setPage(p - 1)} />
            </div>
          )}
        </CardContent>
      </Card>

      {errorsJob && companyId && (
        <ErrorsDialog job={errorsJob} companyId={companyId} fieldName={fieldName(errorsJob.field_id)}
          onClose={() => setErrorsJob(null)} onRetried={() => qc.invalidateQueries({ queryKey: ["cf-overview", companyId] })} />
      )}

      <Dialog open={editOpen} onOpenChange={(open) => { if (!busy) setEditOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{individual ? `Editar campos · ${individual.codigo}` : "Editar em massa"}</DialogTitle>
            <DialogDescription>{individual ? `${individual.nome ?? ""} — Somente este produto será alterado no Bling e no Ajustta-e.` : "O valor é gravado direto no Bling e aqui no sistema. Os outros campos não mudam."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Campo</Label>
              <Select value={target} disabled={busy} onValueChange={(id) => { setTarget(id); if (individual) setValor(individual.valores[id] ?? ""); }}>
                <SelectTrigger><SelectValue placeholder="Escolha o campo" /></SelectTrigger>
                <SelectContent>{fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Novo valor</Label>
              {targetIsList ? (
                <Select
                  aria-label="Novo valor"
                  disabled={busy}
                  value={valorNormalizado === "" ? CLEAR : valorAtualForaDaLista ? ATUAL : valor}
                  onValueChange={(v) => setValor(v === CLEAR ? "" : v === ATUAL ? valor : v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {targetOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    {valorAtualForaDaLista && <SelectItem value={ATUAL}>{valor} (valor atual)</SelectItem>}
                    <SelectItem value={CLEAR}>Limpar campo</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input aria-label="Novo valor" disabled={busy} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Deixe vazio para limpar o campo" />
              )}
              {targetIsList && (
                <p className="text-xs text-muted-foreground">
                  Este campo é uma lista no Bling: escolha uma das opções acima.
                </p>
              )}
            </div>
            {!individual && <RadioGroup value={scope} onValueChange={(v) => setScope(v as "selected" | "filtered")}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="selected" id="sc-sel" disabled={selected.size === 0} />
                <Label htmlFor="sc-sel">Apenas os selecionados ({selected.size})</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="filtered" id="sc-all" />
                <Label htmlFor="sc-all">Todos os produtos do filtro atual ({total})</Label>
              </div>
            </RadioGroup>}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={doBulk} disabled={busy || !!activeJob || !target || (!individual && scope === "selected" && selected.size === 0)}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ErrorsDialog({ job, companyId, fieldName, onClose, onRetried }: {
  job: CustomFieldJob; companyId: string; fieldName?: string; onClose: () => void; onRetried: () => void;
}) {
  const fnErrors = useServerFn(listCustomFieldJobErrors);
  const fnRetry = useServerFn(retryCustomFieldErrors);
  const errors = useQuery({
    queryKey: ["cf-errors", job.id, job.error_count],
    queryFn: () => fnErrors({ data: { company_id: companyId, job_id: job.id } }),
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function retry(productIds?: string[]) {
    setBusy(productIds?.[0] ?? "all");
    try {
      const r = await fnRetry({ data: { company_id: companyId, job_id: job.id, product_ids: productIds } });
      toast.success(`${r.retried} produto(s) enviados de novo ao Bling.`);
      onRetried();
      errors.refetch();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao refazer"); }
    finally { setBusy(null); }
  }

  const list = errors.data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{job.kind === "auto" ? "Erros na atualização automática" : `Erros na edição de "${fieldName ?? "campo"}"`}</DialogTitle>
          <DialogDescription>{job.kind === "push" && `Valor: "${job.valor ?? ""}". `}Refaça um produto ou todos de uma vez.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {errors.isLoading ? <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin" /> : list.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum produto com erro.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">SKU</th><th className="p-2">Produto</th><th className="p-2">Erro</th><th className="p-2" /></tr></thead>
              <tbody>
                {list.map((it) => (
                  <tr key={it.product_id} className="border-b align-top">
                    <td className="whitespace-nowrap p-2 font-mono">{it.codigo}</td>
                    <td className="max-w-[200px] p-2">{it.nome}</td>
                    <td className="max-w-[280px] break-words p-2 text-xs text-destructive">{it.erro}</td>
                    <td className="p-2">
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => retry([it.product_id])}>
                        {busy === it.product_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                        <span className="ml-1">Refazer</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button disabled={!!busy || list.length === 0} onClick={() => retry()}>
            {busy === "all" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Refazer todos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
