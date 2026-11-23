import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SUPPLIER_IMPORT_FIELDS,
  DIMENSIONS_SUM_FIELD,
  conditionsForRule,
  createEvolusomDefaultValueMappings,
  createEligibilityFilterRules,
  detectSupplierSheet,
  mapSupplierRow,
  suggestSupplierMapping,
  type SupplierImportMapping,
  type SupplierImportCondition,
  type SupplierConditionField,
  type SupplierImportRule,
  type SupplierRuleAction,
  type SupplierRuleOperator,
  type SupplierSheetDetection,
  type SupplierValueMapping,
} from "@/lib/supplier-import-mapping";
import {
  applySupplierImport,
  createSupplierImportBatch,
  finishSupplierImportAnalysis,
  ingestSupplierMappedRows,
  listSupplierImportProfiles,
  listSupplierImportPrefixes,
  listSupplierImportRows,
  saveSupplierImportProfile,
} from "@/lib/supplier-imports.functions";
import { enqueueBlingPush } from "@/lib/bling-push.functions";
import { getCdnImagePropagationJob, propagateCdnImages } from "@/lib/cdn-portal.functions";

type RawRow = Record<string, unknown>;
type SupplierRef = { id: string; nome: string; codigo: string };
type ImportProfile = {
  id: string;
  name: string;
  mapping: SupplierImportMapping;
  value_mappings: SupplierValueMapping[];
  rules: SupplierImportRule[];
  header_signature: unknown;
  is_default: boolean;
};
type ImportSummary = {
  mode?: "all" | "existing_images";
  inserted?: number;
  valid?: number;
  existing?: number;
  filtered?: number;
  invalid?: number;
  applied?: { imported?: number; updated?: number; product_ids: string[]; updated_product_ids?: string[] };
  queued?: number;
};

const JOB_POLL_MS = 1500;
const MAX_JOB_POLLS = 1200;
type AnalyzedRow = {
  id: string;
  row_number: number;
  sku: string | null;
  parsed: Record<string, unknown> | null;
  action: string;
  match_type: string | null;
  error: string | null;
  transformation_log: string[] | null;
};

const PREVIEW_FIELDS = [
  ["nome", "Nome"], ["gtin", "EAN"], ["gtin_embalagem", "EAN embalagem"],
  ["preco_custo", "Preço de custo"], ["peso_liquido", "Peso"], ["largura", "Largura"],
  ["altura", "Altura"], ["profundidade", "Profundidade"], ["url_imagens_externas", "Imagens"],
] as const;

function missingPreviewFields(parsed: Record<string, unknown> | null) {
  if (!parsed) return "Dados não disponíveis";
  return PREVIEW_FIELDS.filter(([key]) => parsed[key] == null || String(parsed[key]).trim() === "")
    .map(([, label]) => label).join(", ");
}

function previewValue(value: unknown) {
  if (value == null || value === "") return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const CHUNK_SIZE = 400;

const RULE_OPERATORS: Array<{ value: SupplierRuleOperator; label: string }> = [
  { value: "always", label: "sempre" },
  { value: "equals", label: "é igual a" },
  { value: "not_equals", label: "é diferente de" },
  { value: "one_of", label: "é um de (separe por ;)" },
  { value: "not_one_of", label: "não é um de (separe por ;)" },
  { value: "contains", label: "contém" },
  { value: "not_contains", label: "não contém" },
  { value: "is_empty", label: "está vazio" },
  { value: "not_empty", label: "não está vazio" },
  { value: "greater_than", label: "é maior que" },
  { value: "greater_or_equal", label: "é maior ou igual a" },
  { value: "less_than", label: "é menor que" },
  { value: "less_or_equal", label: "é menor ou igual a" },
];

const RULE_ACTIONS: Array<{ value: SupplierRuleAction; label: string }> = [
  { value: "set", label: "definir como" },
  { value: "clear", label: "limpar" },
  { value: "multiply", label: "multiplicar por" },
  { value: "divide", label: "dividir por" },
  { value: "uppercase", label: "converter para maiúsculas" },
  { value: "lowercase", label: "converter para minúsculas" },
  { value: "strip_html", label: "remover HTML" },
  { value: "ignore", label: "ignorar esta linha" },
];

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

async function parseSpreadsheet(file: File): Promise<RawRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) throw new Error("A planilha não possui uma aba legível.");
    return XLSX.utils.sheet_to_json<RawRow>(firstSheet, { defval: "", raw: true });
  }
  return await new Promise((resolve, reject) => {
    Papa.parse<RawRow>(file, {
      header: true,
      delimiter: "",
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      complete: (result) => {
        if (result.errors.some((error) => error.type === "Delimiter")) {
          reject(new Error(result.errors[0].message));
          return;
        }
        resolve(result.data);
      },
      error: reject,
    });
  });
}

function headersFromRows(rows: RawRow[]) {
  const headers = new Set<string>();
  for (const row of rows.slice(0, 50))
    Object.keys(row).forEach((key) => key.trim() && headers.add(key.trim()));
  return Array.from(headers);
}

export function SupplierSheetImport({
  companyId,
  supplier,
  suppliers = [],
  onSupplierChange,
  onComplete,
}: {
  companyId: string;
  supplier: SupplierRef;
  suppliers?: SupplierRef[];
  onSupplierChange?: (supplierId: string) => void;
  onComplete?: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const fetchProfiles = useServerFn(listSupplierImportProfiles);
  const fetchPrefixes = useServerFn(listSupplierImportPrefixes);
  const saveProfile = useServerFn(saveSupplierImportProfile);
  const createBatch = useServerFn(createSupplierImportBatch);
  const ingestRows = useServerFn(ingestSupplierMappedRows);
  const finishAnalysis = useServerFn(finishSupplierImportAnalysis);
  const fetchRows = useServerFn(listSupplierImportRows);
  const applyImport = useServerFn(applySupplierImport);
  const enqueue = useServerFn(enqueueBlingPush);
  const propagateImages = useServerFn(propagateCdnImages);
  const getImageJob = useServerFn(getCdnImagePropagationJob);

  const profiles = useQuery({
    queryKey: ["supplier-import-profiles", companyId, supplier.id],
    queryFn: () => fetchProfiles({ data: { company_id: companyId, fornecedor_id: supplier.id } }),
  });
  const supplierPrefixes = useQuery({
    queryKey: ["supplier-import-prefixes", companyId, supplier.id],
    queryFn: () =>
      fetchPrefixes({ data: { company_id: companyId, fornecedor_id: supplier.id } }),
    enabled: !!companyId && !!supplier.id,
  });

  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sheetDetection, setSheetDetection] = useState<SupplierSheetDetection | null>(null);
  const [mapping, setMapping] = useState<SupplierImportMapping>({});
  const [valueMappings, setValueMappings] = useState<SupplierValueMapping[]>([]);
  const [rules, setRules] = useState<SupplierImportRule[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [skuPrefix, setSkuPrefix] = useState("");
  // O perfil é opcional; a análise/importação não depende da persistência dele.
  const [saveAsProfile, setSaveAsProfile] = useState(false);
  const [sendToBling, setSendToBling] = useState(true);
  const [step, setStep] = useState<"mapping" | "review" | "done">("mapping");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  useEffect(() => {
    setFile(null);
    setRows([]);
    setHeaders([]);
    setSheetDetection(null);
    setMapping({});
    setValueMappings([]);
    setRules([]);
    setSkuPrefix("");
    setBatchId(null);
    setSummary(null);
    setStep("mapping");
    setOpen(false);
  }, [companyId, supplier.id]);

  useEffect(() => {
    const prefixes = supplierPrefixes.data?.prefixes ?? [];
    if (prefixes.length === 1) setSkuPrefix(prefixes[0]);
    else if (skuPrefix && !prefixes.includes(skuPrefix)) setSkuPrefix("");
  }, [supplierPrefixes.data?.prefixes, skuPrefix]);

  const mappedRows = useMemo(
    () => rows.map((row, index) => mapSupplierRow(row, mapping, index + 2, valueMappings, rules)),
    [rows, mapping, valueMappings, rules],
  );
  const localIssueCount = useMemo(
    () => mappedRows.filter((row) => row.issues.length > 0).length,
    [mappedRows],
  );

  const analyzedRows = useQuery({
    queryKey: ["supplier-import-rows", batchId],
    queryFn: () =>
      fetchRows({ data: { batch_id: batchId!, company_id: companyId, page: 1, page_size: 30, only_import: true } }),
    enabled: !!batchId && step !== "mapping",
  });

  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));

  async function waitForImagePropagation(productIds: string[]) {
    for (let index = 0; index < productIds.length; index += 20000) {
      const job = await propagateImages({
        data: { company_id: companyId, product_ids: productIds.slice(index, index + 20000) },
      });
      for (let attempt = 0; attempt < MAX_JOB_POLLS; attempt++) {
        const current = await getImageJob({ data: { job_id: job.id } });
        if (current.status === "concluido") {
          if (Number(current.error_products ?? 0) > 0) {
            throw new Error(
              `${current.error_products} produto(s) tiveram erro na propagação de imagens. Nenhum produto novo foi enviado ao Bling.`,
            );
          }
          break;
        }
        if (["erro", "cancelado"].includes(String(current.status))) {
          throw new Error(String(current.last_error ?? "A propagação de imagens não foi concluída."));
        }
        if (attempt === MAX_JOB_POLLS - 1) {
          throw new Error(
            "A propagação de imagens excedeu o tempo de espera. Nenhum produto novo foi enviado ao Bling.",
          );
        }
        await wait(JOB_POLL_MS);
      }
    }
  }

  async function handleFile(fileList: FileList | null) {
    const selected = fileList?.[0];
    if (!selected) return;
    try {
      const parsed = await parseSpreadsheet(selected);
      if (!parsed.length) throw new Error("A planilha não possui linhas de dados.");
      const nextHeaders = headersFromRows(parsed);
      if (!nextHeaders.length) throw new Error("Não foi possível identificar os cabeçalhos.");
      const exactProfile = (profiles.data as ImportProfile[] | undefined)?.find((profile) => {
        const saved = Array.isArray(profile.header_signature) ? profile.header_signature : [];
        return (
          saved.length === nextHeaders.length &&
          saved.every((header: string) => nextHeaders.includes(header))
        );
      });
      const defaultProfile = exactProfile;
      const detection = detectSupplierSheet(nextHeaders, supplier.codigo, parsed);
      const useEvolusomDefaults = detection.kind === "evolusom";
      setFile(selected);
      setRows(parsed);
      setHeaders(nextHeaders);
      setMapping(
        (defaultProfile?.mapping as SupplierImportMapping | undefined) ??
          suggestSupplierMapping(nextHeaders, supplier.codigo),
      );
      setSheetDetection(detection);
      setValueMappings(
        defaultProfile?.value_mappings ??
          (useEvolusomDefaults ? createEvolusomDefaultValueMappings(newId) : []),
      );
      setRules([]);
      setProfileId(defaultProfile?.id ?? null);
      setProfileName(
        defaultProfile?.name ?? `${supplier.nome} - ${selected.name.replace(/\.[^.]+$/, "")}`,
      );
      setStep("mapping");
      setBatchId(null);
      setSummary(null);
      setOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível ler a planilha.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function selectProfile(value: string) {
    if (value === "new") {
      const useEvolusomDefaults = sheetDetection?.kind === "evolusom";
      setProfileId(null);
      setMapping(suggestSupplierMapping(headers, supplier.codigo));
      setValueMappings(useEvolusomDefaults ? createEvolusomDefaultValueMappings(newId) : []);
      setRules([]);
      setProfileName(`${supplier.nome} - novo perfil`);
      return;
    }
    const profile = (profiles.data as ImportProfile[] | undefined)?.find(
      (item) => item.id === value,
    );
    if (!profile) return;
    setProfileId(profile.id);
    setProfileName(profile.name);
    setMapping(profile.mapping as SupplierImportMapping);
    setValueMappings(profile.value_mappings ?? []);
    setRules([]);
  }

  async function analyze() {
    const selectedFile = file;
    if (sheetDetection?.supplierMismatch) {
      toast.error("Selecione o fornecedor correspondente à assinatura desta planilha.");
      return;
    }
    if (!selectedFile || !mapping.codigo) {
      toast.error("Mapeie ao menos a coluna Código / SKU.");
      return;
    }
    if (!skuPrefix) {
      toast.error("Selecione o prefixo do fornecedor antes de analisar a planilha.");
      return;
    }
    const incompleteRule = rules.find(
      (rule) =>
        rule.enabled &&
        (conditionsForRule(rule).some(
          (condition) =>
            !["always", "is_empty", "not_empty"].includes(condition.operator) &&
            !condition.value.trim(),
        ) ||
          (["set", "multiply", "divide"].includes(rule.action) && !rule.actionValue.trim())),
    );
    if (incompleteRule) {
      toast.error(`Complete os valores da regra "${incompleteRule.name || "sem nome"}".`);
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      console.info("[supplier-import-ui] analyze-start", { companyId, supplierId: supplier.id, rows: mappedRows.length, file: selectedFile.name });
      let savedProfileId = profileId;
      if (saveAsProfile) {
        console.info("[supplier-import-ui] save-profile-start");
        try {
          const saved = await saveProfile({
            data: {
              id: profileId ?? undefined,
              company_id: companyId,
              fornecedor_id: supplier.id,
              name: profileName.trim() || `${supplier.nome} - perfil`,
              mapping: mapping as Record<string, string>,
              value_mappings: valueMappings,
              rules,
              headers,
              is_default: true,
            },
          });
          savedProfileId = saved.id;
          console.info("[supplier-import-ui] save-profile-complete", { profileId: saved.id });
          setProfileId(saved.id);
          await qc.invalidateQueries({
            queryKey: ["supplier-import-profiles", companyId, supplier.id],
          });
        } catch (error) {
          console.warn("[supplier-import-ui] save-profile-error; continuing without profile", error);
          savedProfileId = null;
          toast.info("Perfil não salvo. A análise continuará usando o mapeamento atual.");
        }
      }
      console.info("[supplier-import-ui] create-batch-start");
      const batch = await createBatch({
        data: {
          company_id: companyId,
          fornecedor_id: supplier.id,
          sku_prefix: skuPrefix,
          profile_id: savedProfileId,
          file: { name: selectedFile.name, size: selectedFile.size },
          mapping: mapping as Record<string, string>,
          value_mappings: valueMappings,
          rules,
          headers,
        },
      });
      console.info("[supplier-import-ui] create-batch-complete", { batchId: batch.id });
      setBatchId(batch.id);
      let totals = { inserted: 0, valid: 0, existing: 0, filtered: 0, invalid: 0 };
      for (let index = 0; index < mappedRows.length; index += CHUNK_SIZE) {
        console.info("[supplier-import-ui] ingest-start", { batchId: batch.id, chunk: Math.floor(index / CHUNK_SIZE) + 1, rows: Math.min(CHUNK_SIZE, mappedRows.length - index) });
        const result = await ingestRows({
          data: {
            batch_id: batch.id,
            company_id: companyId,
            fornecedor_id: supplier.id,
            sku_prefix: skuPrefix,
            file_name: selectedFile.name,
            rows: mappedRows.slice(index, index + CHUNK_SIZE),
          },
        });
        console.info("[supplier-import-ui] ingest-complete", { chunk: Math.floor(index / CHUNK_SIZE) + 1, result });
        totals = {
          inserted: totals.inserted + result.inserted,
          valid: totals.valid + result.valid,
          existing: totals.existing + result.existing,
          filtered: totals.filtered + result.filtered,
          invalid: totals.invalid + result.invalid,
        };
        setProgress(
          Math.round((Math.min(index + CHUNK_SIZE, mappedRows.length) / mappedRows.length) * 100),
        );
      }
      console.info("[supplier-import-ui] finish-analysis-start", { batchId: batch.id });
      const finished = await finishAnalysis({
        data: { batch_id: batch.id, company_id: companyId },
      });
      setSummary({ ...finished, ...totals });
      setStep("review");
      console.info("[supplier-import-ui] analyze-complete", { batchId: batch.id, totals });
      await qc.invalidateQueries({ queryKey: ["supplier-import-rows", batch.id] });
    } catch (error) {
      console.error("[supplier-import-ui] analyze-error", error);
      toast.error(error instanceof Error ? error.message : "Falha ao analisar a planilha.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    await confirmImportMode("all");
  }

  async function confirmImportMode(mode: "all" | "existing_images") {
    if (!batchId) return;
    setBusy(true);
    try {
      const applied = await applyImport({ data: { batch_id: batchId, company_id: companyId, mode } });
      const allProductIds = [...applied.product_ids, ...(applied.updated_product_ids ?? [])];
      const newProductIds = applied.product_ids;
      if (allProductIds.length > 0) {
        await waitForImagePropagation(allProductIds);
      }
      let queued = 0;
      if (sendToBling && mode === "all" && newProductIds.length > 0) {
        const result = await enqueue({
          data: {
            company_id: companyId,
            product_ids: newProductIds,
            scope: "criar",
            only_changed: false,
          },
        });
        queued = result.async ? newProductIds.length : (result.created_criar ?? 0);
      }
      setSummary((current) => ({ ...(current ?? {}), mode, applied, queued }));
      setStep("done");
      toast.success(
        mode === "existing_images"
          ? `${applied.updated ?? 0} produtos existentes foram atualizados com imagens.`
          :
        sendToBling
          ? `${applied.imported ?? applied.product_ids.length} produtos preparados e ${queued} enviados para a fila do Bling.`
          : `${applied.imported ?? applied.product_ids.length} produtos preparados.`,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["supplier-gap"] }),
        qc.invalidateQueries({ queryKey: ["supplier-gap-stats"] }),
        qc.invalidateQueries({ queryKey: ["products"] }),
      ]);
      onComplete?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao preparar os produtos.");
    } finally {
      setBusy(false);
    }
  }

  const groups = Array.from(new Set(SUPPLIER_IMPORT_FIELDS.map((field) => field.group)));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileSpreadsheet className="h-5 w-5" /> Importar produtos faltantes por planilha
          </CardTitle>
          <CardDescription>
            Envie uma planilha de {supplier.nome}, associe as colunas aos campos do produto e revise
            antes de criar no Bling.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid max-w-2xl gap-3 md:grid-cols-2">
            {suppliers.length > 1 && (
              <div className="space-y-1">
                <Label>Fornecedor da planilha</Label>
                <Select value={supplier.id} onValueChange={onSupplierChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.nome} ({item.codigo})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label>Prefixo do SKU *</Label>
              <Select
                value={skuPrefix}
                onValueChange={setSkuPrefix}
                disabled={supplierPrefixes.isLoading || !(supplierPrefixes.data?.prefixes.length ?? 0)}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={supplierPrefixes.isLoading ? "Carregando..." : "Selecione o prefixo"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(supplierPrefixes.data?.prefixes ?? []).map((prefix) => (
                    <SelectItem key={prefix} value={prefix}>
                      {prefix}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!supplierPrefixes.isLoading && !(supplierPrefixes.data?.prefixes.length ?? 0) && (
                <p className="text-xs text-destructive">
                  Cadastre um prefixo para este fornecedor antes de importar.
                </p>
              )}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(event) => handleFile(event.target.files)}
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={!companyId || !skuPrefix || supplierPrefixes.isLoading}
          >
            <Upload className="mr-2 h-4 w-4" /> Subir planilha e mapear
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
        <DialogContent className="max-w-[min(96vw,1100px)] max-h-[92vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {step === "mapping"
                ? "Mapear colunas da planilha"
                : step === "review"
                  ? "Revisar comparação"
                  : "Importação concluída"}
            </DialogTitle>
          </DialogHeader>

          {step === "mapping" && (
            <div className="min-h-0 flex-1 space-y-4 overflow-hidden">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="space-y-1">
                  <Label>Arquivo</Label>
                  <div className="truncate rounded-md border px-3 py-2 text-sm">{file?.name}</div>
                </div>
                <div className="space-y-1">
                  <Label>Perfil</Label>
                  <Select value={profileId ?? "new"} onValueChange={selectProfile}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">Novo mapeamento</SelectItem>
                      {(profiles.data as ImportProfile[] | undefined)?.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Nome do perfil</Label>
                  <Input
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Prefixo escolhido</Label>
                  <div className="rounded-md border px-3 py-2 text-sm font-medium">{skuPrefix}</div>
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="mb-1 flex flex-wrap items-center gap-2 font-medium text-foreground">
                    Layout detectado: {sheetDetection?.label ?? "não analisado"}
                    {sheetDetection?.kind !== "generic" && (
                      <Badge variant="secondary">
                        {Math.round((sheetDetection?.confidence ?? 0) * 100)}% de compatibilidade
                      </Badge>
                    )}
                  </div>
                  {sheetDetection?.supplierMismatch && (
                    <div className="mb-1 font-medium text-destructive">
                      A assinatura da planilha não corresponde ao fornecedor selecionado.
                    </div>
                  )}
                  Apenas o código precisa ser mapeado. Campos vazios serão buscados no cadastro do
                  fornecedor quando houver. O sistema reconhece layouts pela assinatura dos
                  cabeçalhos, não pelo nome do arquivo.
                </AlertDescription>
              </Alert>

              <Tabs defaultValue="columns" className="min-h-0">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="columns">1. Colunas</TabsTrigger>
                  <TabsTrigger value="values">2. De/Para ({valueMappings.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="columns">
                  <ScrollArea className="h-[43vh] rounded-md border">
                    <div className="p-4 space-y-5">
                      {groups.map((group) => (
                        <section key={group}>
                          <h3 className="mb-2 text-sm font-semibold">{group}</h3>
                          <div className="grid gap-x-4 gap-y-2 md:grid-cols-2">
                            {SUPPLIER_IMPORT_FIELDS.filter((field) => field.group === group).map(
                              (field) => (
                                <div
                                  key={field.key}
                                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] items-center gap-2"
                                >
                                  <Label className="text-xs">
                                    {field.label}{" "}
                                    <span className="text-muted-foreground">
                                      (
                                      {field.type === "number"
                                        ? "número"
                                        : field.type === "date"
                                          ? "data"
                                          : "texto"}
                                      )
                                    </span>
                                  </Label>
                                  <Select
                                    value={mapping[field.key] ?? "unmapped"}
                                    onValueChange={(value) =>
                                      setMapping((current) => ({
                                        ...current,
                                        [field.key]: value === "unmapped" ? undefined : value,
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="h-8">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="unmapped">Não mapear</SelectItem>
                                      {headers.map((header) => (
                                        <SelectItem key={header} value={header}>
                                          {header}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              ),
                            )}
                          </div>
                        </section>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="values">
                  <ValueMappingsEditor items={valueMappings} onChange={setValueMappings} />
                </TabsContent>
              </Tabs>

              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="flex gap-2">
                  <Badge variant="secondary">{rows.length.toLocaleString("pt-BR")} linhas</Badge>
                  <Badge variant={localIssueCount ? "destructive" : "outline"}>
                    {localIssueCount} com problema de tipo
                  </Badge>
                </div>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={saveAsProfile}
                    onCheckedChange={(value) => setSaveAsProfile(value === true)}
                  />
                  Salvar colunas, de/para e regras como padrão
                </label>
              </div>
              {localIssueCount > 0 && (
                <div className="max-h-24 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                  {mappedRows
                    .filter((row) => row.issues.length)
                    .slice(0, 8)
                    .map((row) => (
                      <div key={row.row_number}>
                        <b>Linha {row.row_number}:</b> {row.issues.join(" ")}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {step === "review" && (
            <div className="min-h-0 flex-1 space-y-4 overflow-auto">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Metric label="Linhas" value={summary?.inserted ?? 0} />
                <Metric label="Prontos para criar" value={summary?.valid ?? 0} tone="success" />
                <Metric label="Já cadastrados" value={summary?.existing ?? 0} />
                <Metric label="Filtrados" value={summary?.filtered ?? 0} />
                <Metric
                  label="Com problemas"
                  value={summary?.invalid ?? 0}
                  tone={summary?.invalid ? "danger" : undefined}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Esta lista mostra somente os produtos que realmente entrarão no banco. Produtos
                filtrados, já cadastrados ou com problemas aparecem nos totais acima e não entram.
              </p>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <b>Preparar produtos</b> grava os produtos aprovados na base interna. Se a opção
                  de envio estiver marcada, depois disso eles também serão colocados na fila de
                  criação do Bling. O envio ao Bling ainda é processado pela integração.
                </AlertDescription>
              </Alert>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2">Linha</th>
                      <th className="px-3 py-2">SKU</th>
                      {Array.from(
                        new Set(
                          ((analyzedRows.data?.rows as AnalyzedRow[] | undefined) ?? []).flatMap(
                            (row) => Object.keys(row.parsed ?? {}),
                          ),
                        ),
                      ).map((key) => (
                        <th key={key} className="px-3 py-2 whitespace-nowrap">{key}</th>
                      ))}
                      <th className="px-3 py-2">Imagens R2</th>
                      <th className="px-3 py-2">Dados faltantes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(analyzedRows.data?.rows as AnalyzedRow[] | undefined)?.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2">{row.row_number}</td>
                        <td className="px-3 py-2 font-mono text-xs">{row.sku ?? "—"}</td>
                        {Array.from(
                          new Set(
                            ((analyzedRows.data?.rows as AnalyzedRow[] | undefined) ?? []).flatMap(
                              (item) => Object.keys(item.parsed ?? {}),
                            ),
                          ),
                        ).map((key) => (
                          <td key={key} className="max-w-[280px] px-3 py-2 align-top text-xs">
                            <div className="max-h-20 overflow-auto whitespace-pre-wrap">{previewValue(row.parsed?.[key])}</div>
                          </td>
                        ))}
                        <td className="px-3 py-2 align-top text-xs">
                          <Badge variant={row.parsed?.r2_image_status === "encontradas" ? "secondary" : "outline"}>
                            {String(row.parsed?.r2_image_status ?? "não verificado")}
                          </Badge>
                          {Array.isArray(row.parsed?.r2_image_keys) && row.parsed.r2_image_keys.length > 0 && (
                            <div className="mt-1 max-w-[220px] break-all text-muted-foreground">{row.parsed.r2_image_keys.join(" | ")}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-amber-700">
                          {missingPreviewFields(row.parsed) || "nenhum"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(analyzedRows.data?.count ?? 0) > 30 && (
                <p className="text-xs text-muted-foreground">
                  Exibindo os primeiros 30 produtos de {analyzedRows.data?.count} que entrarão no banco.
                </p>
              )}
              <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
                <Checkbox
                  checked={sendToBling}
                  onCheckedChange={(value) => setSendToBling(value === true)}
                />
                Enviar os produtos preparados para a fila de criação do Bling
              </label>
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-600" />
              <div className="text-lg font-semibold">Processamento concluído</div>
              <p className="max-w-lg text-sm text-muted-foreground">
                {summary?.applied?.imported ?? summary?.applied?.product_ids?.length ?? 0} produtos
                foram preparados.
                {sendToBling
                  ? ` ${summary?.queued ?? 0} itens entraram na fila do Bling.`
                  : " O envio ao Bling não foi solicitado."}
              </p>
            </div>
          )}

          {busy && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
              <div className="space-y-3 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                <div className="font-medium">
                  {step === "mapping"
                    ? `Analisando planilha... ${progress}%`
                    : "Preparando produtos..."}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {step === "mapping" && (
              <Button onClick={analyze} disabled={busy || !mapping.codigo}>
                Analisar e comparar
              </Button>
            )}
            {step === "review" && (
              <>
                <Button variant="outline" onClick={() => setStep("mapping")} disabled={busy}>
                  Voltar ao mapeamento
                </Button>
                <Button onClick={confirmImport} disabled={busy || !summary?.valid}>
                  Preparar {summary?.valid ?? 0} produtos
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => confirmImportMode("existing_images")}
                  disabled={busy || !(summary?.existing ?? 0)}
                >
                  Atualizar somente imagens existentes
                </Button>
              </>
            )}
            {step === "done" && <Button onClick={() => setOpen(false)}>Fechar</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "danger";
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-xl font-semibold ${tone === "success" ? "text-emerald-600" : tone === "danger" ? "text-destructive" : ""}`}
      >
        {Number(value ?? 0).toLocaleString("pt-BR")}
      </div>
    </div>
  );
}

function ValueMappingsEditor({
  items,
  onChange,
}: {
  items: SupplierValueMapping[];
  onChange: (items: SupplierValueMapping[]) => void;
}) {
  function update(id: string, values: Partial<SupplierValueMapping>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...values } : item)));
  }

  return (
    <ScrollArea className="h-[43vh] rounded-md border">
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Conversão de valores</h3>
            <p className="text-xs text-muted-foreground">
              Troque valores exatos da planilha antes da validação. Ex.: UNIDADE → UN ou CAIXA → CX.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onChange([...items, { id: newId(), field: "unidade", from: "", to: "" }])
            }
          >
            <Plus className="mr-2 h-4 w-4" /> Adicionar de/para
          </Button>
        </div>

        {items.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nenhuma conversão configurada. Valores da planilha serão mantidos como estão.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="grid gap-2 rounded-md border p-3 md:grid-cols-[1.1fr_1fr_auto_1fr_auto] md:items-end"
              >
                <div className="space-y-1">
                  <Label className="text-xs">Campo</Label>
                  <FieldSelect
                    value={item.field}
                    onChange={(field) => update(item.id, { field })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor na planilha</Label>
                  <Input
                    value={item.from}
                    placeholder="Ex.: UNIDADE"
                    onChange={(event) => update(item.id, { from: event.target.value })}
                  />
                </div>
                <ArrowRight className="mb-2 hidden h-4 w-4 text-muted-foreground md:block" />
                <div className="space-y-1">
                  <Label className="text-xs">Valor no sistema</Label>
                  <Input
                    value={item.to}
                    placeholder="Ex.: UN"
                    onChange={(event) => update(item.id, { to: event.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Excluir conversão"
                  onClick={() => onChange(items.filter((current) => current.id !== item.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function RulesEditor({
  items,
  onChange,
}: {
  items: SupplierImportRule[];
  onChange: (items: SupplierImportRule[]) => void;
}) {
  function update(id: string, values: Partial<SupplierImportRule>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...values } : item)));
  }

  function updateConditions(item: SupplierImportRule, conditions: SupplierImportCondition[]) {
    const first = conditions[0];
    if (!first) return;
    update(item.id, {
      conditions,
      conditionField: first.field,
      operator: first.operator,
      conditionValue: first.value,
    });
  }

  return (
    <ScrollArea className="h-[43vh] rounded-md border">
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Regras condicionais</h3>
            <p className="text-xs text-muted-foreground">
              As regras rodam de cima para baixo após o de/para. Use regras separadas para alterar
              vários campos do mesmo tipo de produto.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              O modelo padrão usa peso &lt; 30 kg, L+A+P &lt; 200 cm, preço &lt; R$ 1.000, unidade
              PC/UN e origem PR. Todos os valores podem ser alterados abaixo.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const template = createEligibilityFilterRules(newId);
                onChange([
                  ...items,
                  ...template.filter(
                    (rule) => !items.some((current) => current.name === rule.name),
                  ),
                ]);
              }}
            >
              Aplicar limites padrão
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                onChange([
                  ...items,
                  {
                    id: newId(),
                    name: `Regra ${items.length + 1}`,
                    enabled: true,
                    conditionField: "unidade",
                    operator: "equals",
                    conditionValue: "",
                    conditionLogic: "and",
                    conditions: [
                      {
                        id: newId(),
                        field: "unidade",
                        operator: "equals",
                        value: "",
                      },
                    ],
                    targetField: "peso_liquido",
                    action: "clear",
                    actionValue: "",
                  },
                ])
              }
            >
              <Plus className="mr-2 h-4 w-4" /> Adicionar regra
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nenhuma regra configurada. Todos os campos mapeados serão importados normalmente.
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item, index) => {
              const conditions = conditionsForRule(item);
              const needsActionValue = ["set", "multiply", "divide"].includes(item.action);
              return (
                <div key={item.id} className="space-y-3 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={item.enabled}
                      onCheckedChange={(value) => update(item.id, { enabled: value === true })}
                    />
                    <Input
                      value={item.name}
                      className="h-8 font-medium"
                      aria-label={`Nome da regra ${index + 1}`}
                      onChange={(event) => update(item.id, { name: event.target.value })}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Excluir regra"
                      onClick={() => onChange(items.filter((current) => current.id !== item.id))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">Quando</Label>
                        {conditions.length > 1 && (
                          <Select
                            value={item.conditionLogic ?? "and"}
                            onValueChange={(conditionLogic) =>
                              update(item.id, { conditionLogic: conditionLogic as "and" | "or" })
                            }
                          >
                            <SelectTrigger className="h-8 w-44">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="and">todas forem verdadeiras (E)</SelectItem>
                              <SelectItem value="or">qualquer uma for verdadeira (OU)</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          updateConditions(item, [
                            ...conditions,
                            {
                              id: newId(),
                              field: "preco_custo",
                              operator: "greater_than",
                              value: "",
                            },
                          ])
                        }
                      >
                        <Plus className="mr-2 h-4 w-4" /> Adicionar condição
                      </Button>
                    </div>

                    {conditions.map((condition, conditionIndex) => {
                      const needsConditionValue = !["always", "is_empty", "not_empty"].includes(
                        condition.operator,
                      );
                      const updateCondition = (values: Partial<SupplierImportCondition>) =>
                        updateConditions(
                          item,
                          conditions.map((current) =>
                            current.id === condition.id ? { ...current, ...values } : current,
                          ),
                        );
                      return (
                        <div
                          key={condition.id}
                          className="grid gap-2 rounded-md bg-muted/30 p-2 md:grid-cols-[auto_1fr_1fr_1fr_auto] md:items-end"
                        >
                          <div className="pb-2 text-xs font-semibold text-muted-foreground">
                            {conditionIndex === 0
                              ? "SE"
                              : (item.conditionLogic ?? "and").toUpperCase()}
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Campo</Label>
                            <ConditionFieldSelect
                              value={condition.field}
                              disabled={condition.operator === "always"}
                              onChange={(field) => updateCondition({ field })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Comparação</Label>
                            <Select
                              value={condition.operator}
                              onValueChange={(operator) =>
                                updateCondition({ operator: operator as SupplierRuleOperator })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {RULE_OPERATORS.map((operator) => (
                                  <SelectItem key={operator.value} value={operator.value}>
                                    {operator.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Valor</Label>
                            <Input
                              value={condition.value}
                              disabled={!needsConditionValue}
                              placeholder={condition.operator === "one_of" ? "UN;CX;KIT" : "Valor"}
                              onChange={(event) => updateCondition({ value: event.target.value })}
                            />
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            disabled={conditions.length === 1}
                            aria-label="Excluir condição"
                            onClick={() =>
                              updateConditions(
                                item,
                                conditions.filter((current) => current.id !== condition.id),
                              )
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid gap-2 border-t pt-3 md:grid-cols-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Então no campo</Label>
                      <FieldSelect
                        value={item.targetField}
                        disabled={item.action === "ignore"}
                        onChange={(targetField) => update(item.id, { targetField })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Ação</Label>
                      <Select
                        value={item.action}
                        onValueChange={(action) =>
                          update(item.id, { action: action as SupplierRuleAction })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RULE_ACTIONS.map((action) => (
                            <SelectItem key={action.value} value={action.value}>
                              {action.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Valor da ação</Label>
                      <Input
                        value={item.actionValue}
                        disabled={!needsActionValue}
                        placeholder={
                          item.action === "multiply" || item.action === "divide"
                            ? "Ex.: 1000"
                            : "Novo valor"
                        }
                        onChange={(event) => update(item.id, { actionValue: event.target.value })}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function FieldSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: SupplierValueMapping["field"];
  onChange: (field: SupplierValueMapping["field"]) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={String(value)}
      disabled={disabled}
      onValueChange={(field) => onChange(field as SupplierValueMapping["field"])}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SUPPLIER_IMPORT_FIELDS.map((field) => (
          <SelectItem key={String(field.key)} value={String(field.key)}>
            {field.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ConditionFieldSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: SupplierConditionField;
  onChange: (field: SupplierConditionField) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={String(value)}
      disabled={disabled}
      onValueChange={(field) => onChange(field as SupplierConditionField)}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DIMENSIONS_SUM_FIELD}>Soma das dimensões (L + A + P em cm)</SelectItem>
        {SUPPLIER_IMPORT_FIELDS.map((field) => (
          <SelectItem key={String(field.key)} value={String(field.key)}>
            {field.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
