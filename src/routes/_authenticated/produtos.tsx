import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Trash2, Download, ShieldCheck, Pencil, Wand2, Store } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { listMyCompanies } from "@/lib/companies.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import { listProducts, listProductIds } from "@/lib/bling-sync.functions";
import { listBlingChannels, listDistinctStores } from "@/lib/bling-stores.functions";
import {
  enqueueBlingLinkStore,
  enqueueBlingInativar,
} from "@/lib/bling-push.functions";
import { ProductStoresModal } from "@/components/product-stores-modal";
import { StoreCodeSheetCard } from "@/components/store-code-sheet-card";
import { StoreCodeMarketplaceDialog } from "@/components/store-code-marketplace-dialog";
import type { StoreCodeMarketplace } from "@/lib/bling-push.functions";
import {
  dedupeProductsBySku,
  duplicateCompanyProducts,
  deleteProducts,
  deleteAllProducts,
  transformStripHtml,
  transformFillDescComplementar,
  transformFillGarantiaAnatel,
  transformUpdateAnatelCode,
  transformRemoveGarantiaAnatel,
  transformUpdatePriceStock,
  transformFillEanFromSupplier,
  transformTrimImages,
  transformRemoveInvalidImageUrls,
  transformZeroStock,
  transformFillDimensionsFromSupplier,
  transformFillBrandFromSupplier,
  transformSetCrossdocking,
  transformSetUnidadeCentimetros,
  transformSetFixedField,
  autoFixAllErrors,
  listChangedProductIds,
} from "@/lib/products-tools.functions";
import {
  aiListLongTitleIds,
  aiListWarrantyCandidateIds,
  aiListShortDescriptionIds,
  aiListMissingEanIds,
} from "@/lib/ai-transforms.functions";
import { enqueueAiTransformJob, type AiJobKind } from "@/lib/ai-jobs.functions";
import { applyCrossCompanyFix, CROSS_COMPANY_RULE_FIELDS } from "@/lib/cross-company-fix.functions";
import { AI_FEATURES_ENABLED, AI_FIX_RULE_SLUGS, AI_DISABLED_MESSAGE } from "@/lib/ai-features";
import { exportProducts } from "@/lib/exports.functions";
import { startAuditRun, runAuditBatch, listAuditRunResults, getAuditRun, cancelAuditRun } from "@/lib/audit.functions";
import { PricingPolicyAlert } from "@/components/pricing-policy-alert";
import { listAuditIssueTypes, listAuditRuns } from "@/lib/audit.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ProductEditModal } from "@/components/product-edit-modal";
import { AlternativeSuppliersCard } from "@/components/alternative-suppliers-card";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { PageNumbers } from "@/components/page-numbers";
import { BlingPushCard } from "@/components/bling-push-card";
import { AssistedTransformCard } from "@/components/assisted-transform-card";
import { TransformLogDialog } from "@/components/transform-log-dialog";
import { CrossCompanyImportCard } from "@/components/cross-company-import-card";
import { EanSuggestDialog } from "@/components/ean-suggest-dialog";
import { BlingExistenceProgress } from "@/components/bling-existence-progress";
import { startExistenceJob } from "@/lib/bling-existence.functions";
import { NcmSuggestDialog } from "@/components/ncm-suggest-dialog";
import { MlImagesDialog } from "@/components/ml-images-dialog";
import { useAccess } from "@/hooks/use-access";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

type StoresFilter = "all" | "0" | "1" | "2" | "3" | "4plus" | "any";


export const Route = createFileRoute("/_authenticated/produtos")({
  head: () => ({ meta: [{"title": "Produtos | Ajusta-Ê"}, {"name": "description", "content": "Consulte o catálogo da empresa, filtros e resultados de auditoria."}, {"property": "og:title", "content": "Produtos | Ajusta-Ê"}, {"property": "og:description", "content": "Consulte o catálogo da empresa, filtros e resultados de auditoria."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }),
  component: ProdutosPage,
});


function ProdutosPage() {
  const { access } = useAccess();
  const readOnly = access.company_restricted;
  const qc = useQueryClient();
  const fetchCompanies = useServerFn(listMyCompanies);
  const fetchList = useServerFn(listProducts);
  const fetchAllIds = useServerFn(listProductIds);
  const doDedupe = useServerFn(dedupeProductsBySku);
  const doDuplicate = useServerFn(duplicateCompanyProducts);
  const doDelete = useServerFn(deleteProducts);
  const doDeleteAll = useServerFn(deleteAllProducts);
  const doExport = useServerFn(exportProducts);
  const doAuditStart = useServerFn(startAuditRun);
  const doAuditBatch = useServerFn(runAuditBatch);
  const fetchProductAudit = useServerFn(getAuditRun);
  const cancelProductAudit = useServerFn(cancelAuditRun);
  const fetchIssueTypes = useServerFn(listAuditIssueTypes);
  const fetchAuditResults = useServerFn(listAuditRunResults);
  const doStripHtml = useServerFn(transformStripHtml);
  const doFillDesc = useServerFn(transformFillDescComplementar);
  const doFillGarantiaAnatel = useServerFn(transformFillGarantiaAnatel);
  const doUpdateAnatelCode = useServerFn(transformUpdateAnatelCode);
  const doRemoveGarantiaAnatel = useServerFn(transformRemoveGarantiaAnatel);
  const doSyncSupplier = useServerFn(transformUpdatePriceStock);
  const doFillEanSupplier = useServerFn(transformFillEanFromSupplier);
  const doTrimImages = useServerFn(transformTrimImages);
  const doRemoveInvalidImages = useServerFn(transformRemoveInvalidImageUrls);
  const doInativarBling = useServerFn(enqueueBlingInativar);
  const [confirmInativar, setConfirmInativar] = useState(false);
  const doZeroStock = useServerFn(transformZeroStock);
  const doFillDimensions = useServerFn(transformFillDimensionsFromSupplier);
  const doFillBrand = useServerFn(transformFillBrandFromSupplier);
  const doSetCrossdocking = useServerFn(transformSetCrossdocking);
  const doSetUnidadeCm = useServerFn(transformSetUnidadeCentimetros);
  const doSetFixedField = useServerFn(transformSetFixedField);
  const doAutoFix = useServerFn(autoFixAllErrors);
  const doAiListLongTitles = useServerFn(aiListLongTitleIds);
  const doAiListWarranty = useServerFn(aiListWarrantyCandidateIds);
  const doAiListShortDesc = useServerFn(aiListShortDescriptionIds);
  const doAiListMissingEan = useServerFn(aiListMissingEanIds);
  const doEnqueueAiJob = useServerFn(enqueueAiTransformJob);

  const doCrossCompanyFix = useServerFn(applyCrossCompanyFix);
  const [crossFixingRule, setCrossFixingRule] = useState<string | null>(null);
  const [crossFixProgress, setCrossFixProgress] = useState<{ processed: number; total: number; updated: number } | null>(null);
  const [crossFixAskRule, setCrossFixAskRule] = useState<string | null>(null);
  const [crossFixSource, setCrossFixSource] = useState<string>("__all__");
  const [imageFixSource, setImageFixSource] = useState("supplier_ml");

  const [supplierReport, setSupplierReport] = useState<Awaited<ReturnType<typeof transformUpdatePriceStock>> | null>(null);
  const [fixingRule, setFixingRule] = useState<string | null>(null);
  const [reauditOpen, setReauditOpen] = useState(false);
  const [auditScopeOpen, setAuditScopeOpen] = useState(false);
  const [auditScope, setAuditScope] = useState<"active" | "all">("active");
  const auditPendingIds = useRef<string[] | null>(null);
  const lastAuditOnlyActive = useRef(true);
  const [auditSkipImages, setAuditSkipImages] = useState(false);
  const lastAuditSkipImages = useRef(false);
  const [productAudit, setProductAudit] = useState<{ id: string | null; total: number; checked: number; phase: string; error?: string } | null>(null);
  const productAuditCancelled = useRef(false);
  const productAuditRunning = useRef(false);
  const [auditCancelling, setAuditCancelling] = useState(false);
  const productAuditQuery = useQuery({
    queryKey: ["audit-run", productAudit?.id],
    queryFn: () => {
      if (!productAudit?.id) throw new Error("Auditoria não iniciada.");
      return fetchProductAudit({ data: { run_id: productAudit.id } });
    },
    enabled: !!productAudit?.id,
    refetchInterval: 1500,
  });
  useEffect(() => {
    const run = productAuditQuery.data as (Awaited<ReturnType<typeof getAuditRun>> & { image_scan_checked?: number; image_scan_started?: boolean; image_scan_done?: boolean }) | undefined;
    if (!run || run.id !== productAudit?.id) return;
    if (run.status === "cancelada" || run.status === "concluida") {
      productAuditCancelled.current = true;
      setProductAudit(null);
      return;
    }
    setProductAudit(current => current ? {
      ...current,
      checked: Math.max(current.checked, run.image_scan_checked ?? 0, run.processed_products ?? 0),
      phase: run.image_scan_started && !run.image_scan_done ? "Verificando fotos" : "Conferindo regras de auditoria",
    } : null);
  }, [productAuditQuery.data, productAudit?.id]);

  async function stopProductAudit() {
    if (!productAudit?.id) return;
    setAuditCancelling(true);
    try {
      await cancelProductAudit({ data: { run_id: productAudit.id } });
      productAuditCancelled.current = true;
      setProductAudit(null);
      toast.info("Auditoria cancelada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível cancelar a auditoria.");
    } finally { setAuditCancelling(false); }
  }

  /** Cria a transformação em segundo plano e devolve o controle da tela. */
  const startAiJob = async (
    kind: AiJobKind,
    label: string,
    candidates: string[],
    params?: Record<string, string | number | boolean>,
  ) => {
    if (!companyId) return;
    if (candidates.length === 0) {
      toast.info("Nenhum produto elegível para esta correção.");
      return;
    }
    const r = await doEnqueueAiJob({
      data: { company_id: companyId, kind, product_ids: candidates, params },
    });
    toast.success(
      `${label}: ${r.queued.toLocaleString("pt-BR")} produto(s) na fila. O processamento continua em segundo plano.`,
    );
    qc.invalidateQueries({ queryKey: ["ai-jobs"] });
  };




  const companies = useQuery({ queryKey: ["companies"], queryFn: () => fetchCompanies() });
  const [companyId, setCompanyId] = useSelectedCompany();
  // Same cache entry as the floating audit badge: one run per company at a time.
  const fetchAuditRuns = useServerFn(listAuditRuns);
  const companyAuditRuns = useQuery({
    queryKey: ["audit-runs", companyId],
    queryFn: () => fetchAuditRuns({ data: { company_id: companyId! } }),
    enabled: !!companyId,
    refetchInterval: 1500,
  });
  const companyAuditRunning = !!companyAuditRuns.data?.some((r: { status: string }) => r.status === "processando");
  useEffect(() => {
    if (!companyId && companies.data && companies.data.length > 0) setCompanyId(companies.data[0].id);
  }, [companies.data, companyId]);

  const [search, setSearch] = useState("");
  const [situacao, setSituacao] = useState<string>("all");
  const [detailFilter, setDetailFilter] = useState<"all" | "synced" | "pending">("all");
  const [storesFilter, setStoresFilter] = useState<StoresFilter>("all");
  const [blingStoreId, setBlingStoreId] = useState("all");
  useEffect(() => { setBlingStoreId("all"); }, [companyId]);
  const [auditRule, setAuditRule] = useState<string>("all");
  const [auditStatus, setAuditStatus] = useState<"any" | "error" | "warning">("any");
  const [page, setPage] = useState(1);

  const issueTypes = useQuery({
    queryKey: ["audit-issue-types", companyId],
    queryFn: () => fetchIssueTypes({ data: { company_id: companyId! } }),
    enabled: !!companyId,
  });
  const auditRunId = issueTypes.data?.run_id ?? undefined;

  const auditFilterReady = auditRule === "all" || !!auditRunId;
  const auditProblems = useQuery({
    queryKey: ["audit-problems", auditRunId, auditRule, auditStatus],
    queryFn: () => fetchAuditResults({ data: { run_id: auditRunId!, offset: 0, limit: 1000 } }),
    enabled: !!auditRunId && auditRule !== "all",
  });
  const fetchChannels = useServerFn(listBlingChannels);
  const channels = useQuery({
    queryKey: ["product-store-channels", companyId],
    queryFn: () => fetchChannels({ data: { company_id: companyId! } }),
    enabled: !!companyId,
  });
  const products = useQuery({
    queryKey: ["products", companyId, search, situacao, detailFilter, storesFilter, blingStoreId, auditRule, auditStatus, auditRunId, page],
    queryFn: () =>
      fetchList({
        data: {
          company_id: companyId!,
          search: search || undefined,
          situacao: situacao === "all" ? undefined : situacao,
          detail_filter: detailFilter,
          stores_filter: storesFilter,
          bling_store_id: blingStoreId === "all" ? undefined : blingStoreId,
          audit_rule_slug: auditRule === "all" ? undefined : auditRule,
          audit_status: auditRule === "all" ? undefined : auditStatus,
          audit_run_id: auditRule === "all" ? undefined : auditRunId,
          page,
          page_size: 25,
        },
      }),
    enabled: !!companyId && auditFilterReady,
    staleTime: 0,
  });

  const [dedupeKeep, setDedupeKeep] = useState<"newest" | "oldest">("newest");
  const [dedupeOpen, setDedupeOpen] = useState(false);
  const [dedupeBusy, setDedupeBusy] = useState(false);
  const [sourceCompany, setSourceCompany] = useState<string | undefined>();
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [dupProgress, setDupProgress] = useState<{ processed: number; total: number; copied: number; skipped: number } | null>(null);

  async function handleDedupe() {
    if (!companyId) return;
    setDedupeBusy(true);
    try {
      const r = await doDedupe({ data: { company_id: companyId, keep: dedupeKeep } });
      toast.success(`Duplicados removidos: ${r.deleted} (em ${r.groups_with_duplicates} SKUs).`);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover duplicados.");
    } finally {
      setDedupeBusy(false);
      setDedupeOpen(false);
    }
  }

  async function handleDuplicate() {
    if (!companyId || !sourceCompany) return;
    setDuplicateBusy(true);
    setDupProgress({ processed: 0, total: 0, copied: 0, skipped: 0 });
    try {
      let offset = 0;
      let total = 0;
      let copied = 0;
      let skipped = 0;
      // Loop paginado — cada chamada processa até 200 linhas para não estourar o CPU do worker.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let r: any = null;
        let attempt = 0;
        // retry transiente (timeout do worker) até 3 vezes
        while (attempt < 3) {
          try {
            r = await doDuplicate({
              data: {
                source_company_id: sourceCompany,
                target_company_id: companyId,
                overwrite,
                offset,
                page_size: 50,
              },
            });
            break;
          } catch (err) {
            attempt++;
            if (attempt >= 3) throw err;
            await new Promise((res) => setTimeout(res, 1500 * attempt));
          }
        }
        if (typeof r.total === "number") total = r.total;
        copied += r.copied ?? 0;
        skipped += r.skipped ?? 0;
        setDupProgress({ processed: r.processed ?? offset, total, copied, skipped });
        if (r.next_offset == null) break;
        offset = r.next_offset;
      }
      toast.success(`Produtos copiados: ${copied}${skipped ? ` (ignorados: ${skipped})` : ""}.`);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao duplicar produtos.");
    } finally {
      setDuplicateBusy(false);
      setTimeout(() => setDupProgress(null), 1200);
    }
  }

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"single" | "1000">("single");
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [storesModal, setStoresModal] = useState<{ id: string; nome: string | null; codigo: string | null; blingId: string | null } | null>(null);
  useEffect(() => { setSelected(new Set()); }, [companyId, page, search, situacao, detailFilter, storesFilter, blingStoreId, auditRule, auditStatus]);

  function toggle(id: string) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  }
  function toggleAllVisible() {
    const rows = products.data?.rows ?? [];
    const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }

  async function selectAllFiltered() {
    if (!companyId) return;
    setSelectingAll(true);
    try {
      const r = await fetchAllIds({
        data: {
          company_id: companyId,
          search: search || undefined,
          situacao: situacao === "all" ? undefined : situacao,
          detail_filter: detailFilter,
          stores_filter: storesFilter,
          bling_store_id: blingStoreId === "all" ? undefined : blingStoreId,
          audit_rule_slug: auditRule === "all" ? undefined : auditRule,
          audit_status: auditRule === "all" ? undefined : auditStatus,
          audit_run_id: auditRule === "all" ? undefined : auditRunId,
        },
      });
      setSelected(new Set(r.ids));
      toast.success(`${r.ids.length.toLocaleString("pt-BR")} produto(s) selecionado(s).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao selecionar todos.");
    } finally {
      setSelectingAll(false);
    }
  }

  async function bulkDelete() {
    if (selected.size === 0 || !companyId) return;
    if (!confirm(`Excluir ${selected.size} produto(s) selecionado(s)?`)) return;
    setBulkBusy(true);
    try {
      const r = await doDelete({ data: { company_id: companyId, product_ids: Array.from(selected) } });
      toast.success(`${r.deleted} produto(s) excluído(s).`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally { setBulkBusy(false); }
  }

  async function bulkDeleteAll() {
    if (!companyId) return;
    if (!confirm("Excluir TODOS os produtos desta empresa? Esta ação é irreversível.")) return;
    setBulkBusy(true);
    try {
      const r = await doDeleteAll({ data: { company_id: companyId } });
      toast.success(`${r.deleted} produto(s) excluído(s).`);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally { setBulkBusy(false); }
  }

  async function bulkExport() {
    if (!companyId) return;
    setExportOpen(false);
    setBulkBusy(true);
    try {
      // Se nada estiver selecionado, exporta tudo o que o filtro atual retorna.
      let ids: string[];
      if (selected.size > 0) {
        ids = Array.from(selected);
      } else {
        setExportProgress({ done: 0, total: products.data?.count ?? 0 });
        const r = await fetchAllIds({
          data: {
            company_id: companyId,
            search: search || undefined,
            situacao: situacao === "all" ? undefined : situacao,
            detail_filter: detailFilter,
            stores_filter: storesFilter,
            bling_store_id: blingStoreId === "all" ? undefined : blingStoreId,
            audit_rule_slug: auditRule === "all" ? undefined : auditRule,
            audit_status: auditRule === "all" ? undefined : auditStatus,
            audit_run_id: auditRule === "all" ? undefined : auditRunId,
          },
        });
        ids = r.ids;
      }
      if (ids.length === 0) { toast.info("Nada para exportar."); return; }
      setExportProgress({ done: 0, total: ids.length });
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const parts: string[] = [];
      const zip = exportMode === "1000" ? new JSZip() : null;
      let totalCount = 0;
      // UUIDs deixam a chamada grande rapidamente. Blocos pequenos mantêm
      // tanto a requisição quanto a resposta abaixo dos limites do servidor.
      const requestSize = 100;
      for (let start = 0; start < ids.length; start += requestSize) {
        const productIds = ids.slice(start, start + requestSize);
        const r = await doExport({
          data: {
            company_id: companyId,
            filter: "selected",
            product_ids: productIds,
            total_override: ids.length,
            next_offset_override: start + productIds.length < ids.length ? start + productIds.length : null,
            offset: start,
            limit: requestSize,
            include_header: exportMode === "1000" ? start % 1000 === 0 : start === 0,
          },
        });
        totalCount += r.count;
        setExportProgress({ done: totalCount, total: ids.length });
        if (r.csv && r.count > 0) {
          if (zip) {
            const fileIndex = Math.floor(start / 1000) + 1;
            const fileName = `Produtos_selecionados_${timestamp}_${String(fileIndex).padStart(3, "0")}.csv`;
            const current = zip.file(fileName);
            if (current) {
              const previous = await current.async("string");
              zip.file(fileName, previous + r.csv);
            } else {
              zip.file(fileName, r.csv);
            }
          } else {
            parts.push(r.csv);
          }
        }
      }
      if (totalCount === 0) { toast.info("Nada para exportar."); return; }
      if (zip) {
        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
        downloadBlob(blob, `Produtos_selecionados_${timestamp}.zip`);
      } else {
        downloadBlob(
          new Blob(parts, { type: "text/csv;charset=utf-8" }),
          `Produtos_selecionados_${timestamp}.csv`,
        );
      }
      toast.success(
        exportMode === "single"
          ? `Exportado ${totalCount.toLocaleString("pt-BR")} produto(s) em uma planilha.`
          : `Exportado ${totalCount.toLocaleString("pt-BR")} produto(s) em ${Math.ceil(totalCount / 1000)} planilhas no ZIP.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setBulkBusy(false);
      setTimeout(() => setExportProgress(null), 1000);
    }
  }

  function requestAudit(overrideIds?: string[]) {
    auditPendingIds.current = overrideIds ?? (selected.size > 0 ? Array.from(selected) : []);
    setAuditScope("active");
    setAuditScopeOpen(true);
  }

  async function bulkAudit(overrideIds?: string[], onlyActive?: boolean, correctedOnly = false) {
    if (!companyId || companyAuditRunning || productAuditRunning.current || productAudit) return;
    productAuditRunning.current = true;
    productAuditCancelled.current = false;
    const generation = ++auditGeneration.current;
    setProductAudit({ id: null, total: 0, checked: 0, phase: "Preparando auditoria" });
    const ids = overrideIds ?? (selected.size > 0 ? Array.from(selected) : []);
    const scopeOnlyActive = onlyActive ?? lastAuditOnlyActive.current;
    lastAuditOnlyActive.current = scopeOnlyActive;
    setBulkBusy(true);
    try {
      const run = await doAuditStart({ data: { company_id: companyId, product_ids: ids, rule_ids: [], only_active: scopeOnlyActive, skip_images: lastAuditSkipImages.current, corrected_only: correctedOnly } });
      setProductAudit({ id: run.run_id, total: run.total, checked: 0, phase: "Conferindo produtos" });
      toast.info(`Auditando ${run.total} produto(s)...`);
      while (true) {
        if (productAuditCancelled.current || generation !== auditGeneration.current) return;
        const r = await doAuditBatch({ data: { run_id: run.run_id, batch_size: 25 } });
        if (r.cancelled || productAuditCancelled.current || generation !== auditGeneration.current) return;
        setProductAudit(current => current ? { ...current, checked: Math.max(current.checked, r.processed), phase: "phase" in r && r.phase === "imagens" ? "Verificando fotos" : "Conferindo regras de auditoria" } : null);
        if (r.done) break;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      setProductAudit(null);
      toast.success("Auditoria concluída.");
      await qc.invalidateQueries({ queryKey: ["audit-issue-types", companyId] });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro na auditoria";
      setProductAudit(current => current?.id ? { ...current, error: message } : null);
      toast.error(message);
    } finally {
      if (generation === auditGeneration.current) { productAuditRunning.current = false; setBulkBusy(false); }
    }
  }

  // Trocar de empresa só para de acompanhar aqui; a auditoria segue no servidor
  // e continua visível no botão flutuante.
  const auditGeneration = useRef(0);
  useEffect(() => {
    auditGeneration.current++;
    productAuditRunning.current = false;
    setProductAudit(null);
    setBulkBusy(false);
  }, [companyId]);

  const [eanIds, setEanIds] = useState<string[] | null>(null);
  const [ncmIds, setNcmIds] = useState<string[] | null>(null);
  const [mlImgIds, setMlImgIds] = useState<string[] | null>(null);

  async function autoFixByRule(slug: string) {
    if (!companyId) return;
    const supported = new Set([
      "descricao-complementar-igual-nome",
      "descricao-curta-minima",
      "garantia-duplicada-desc-curta",
      "garantia-anatel-desc-complementar",
      "titulo-maximo",
      "imagens-maximo",
      "imagens-extensao",
      "produto-em-fornecedor",
      "dimensoes-peso-obrigatorios",
      "crossdocking-minimo",
      "ean-obrigatorio",
      "ncm-obrigatorio",
      "marca-obrigatoria",
      "imagens-minimo",
      "imagem-placeholder",
      "unidade-medida-centimetros",
      "condicao-novo",
      "producao-terceiros",
    ]);

    if (!supported.has(slug)) { toast.info("Sem correção automática para essa regra."); return; }
    if (!AI_FEATURES_ENABLED && AI_FIX_RULE_SLUGS.has(slug)) { toast.info(AI_DISABLED_MESSAGE); return; }
    setFixingRule(slug);
    try {
      // "produto-em-fornecedor": só inativa os que têm prefixo padrão e não estão
      // na base do fornecedor (status error). Os avisos (SKU sem prefixo padrão)
      // são mantidos e nunca inativados.
      const statuses =
        slug === "crossdocking-minimo"
          ? ["warning", "error"]
          : slug === "produto-em-fornecedor"
            ? ["error"]
            : ["error", "warning"];
      let ids: string[] = [];
      for (const st of statuses) {
        const r = await fetchAllIds({
          data: {
            company_id: companyId,
            audit_rule_slug: slug,
            audit_status: st,
            audit_run_id: auditRunId,
          },
        });
        if (r.ids.length > 0) { ids = r.ids; break; }
      }
      if (ids.length === 0) { toast.info("Nenhum produto para corrigir."); return; }

      if (slug === "descricao-complementar-igual-nome") {
        const r2 = await doFillDesc({ data: { company_id: companyId, product_ids: ids } });
        toast.success(`Descrição complementar corrigida em ${r2.updated} produto(s).`);
      } else if (slug === "descricao-curta-minima") {
        const { ids: candidates } = await doAiListShortDesc({
          data: { company_id: companyId, product_ids: ids, min_length: 150 },
        });
        await startAiJob("expand_short_desc", "Descrições curtas", candidates, { min_length: 150 });
      } else if (slug === "garantia-duplicada-desc-curta") {
        const { ids: candidates } = await doAiListWarranty({
          data: { company_id: companyId, product_ids: ids },
        });
        await startAiJob("remove_warranty", "Remoção garantia/Anatel", candidates);
        const r3 = await doFillGarantiaAnatel({ data: { company_id: companyId, product_ids: ids } });
        toast.success(`Garantia + Anatel + Anvisa: Isento repreenchidos em ${r3.updated} produto(s).`);
      } else if (slug === "garantia-anatel-desc-complementar") {
        const r2 = await doFillGarantiaAnatel({ data: { company_id: companyId, product_ids: ids } });
        toast.success(`Garantia + Anatel + Anvisa: Isento preenchidos em ${r2.updated} produto(s).`);
      } else if (slug === "titulo-maximo") {
        const { ids: candidates } = await doAiListLongTitles({
          data: { company_id: companyId, product_ids: ids, max_length: 60 },
        });
        await startAiJob("shorten_title", "Títulos", candidates, { max_length: 60 });
      } else if (slug === "imagens-maximo") {
        const r2 = await doTrimImages({ data: { company_id: companyId, product_ids: ids, max: 18 } });
        toast.success(`Reduzido para 18 imagens em ${r2.updated} produto(s).`);
      } else if (slug === "imagens-extensao") {
        const r2 = await doRemoveInvalidImages({ data: { company_id: companyId, product_ids: ids } });
        toast.success(`${r2.removed} imagem(ns) sem .png/.jpg removida(s) em ${r2.updated} produto(s).`);
      } else if (slug === "produto-em-fornecedor") {
        const r2 = await doInativarBling({ data: { company_id: companyId, product_ids: ids } });
        const partes = [`${r2.enqueued} produto(s) enviados para inativação no Bling`];
        if (r2.excluidos_local > 0) {
          partes.push(`${r2.excluidos_local} excluído(s) da base interna (não existem no Bling)`);
        }
        if (r2.enqueued === 0 && r2.excluidos_local === 0) {
          toast.info("Nenhum produto ativo para inativar — já estavam inativos.");
        } else {
          toast.success(partes.join("; ") + ".");
        }
      } else if (slug === "dimensoes-peso-obrigatorios") {
        const r2 = await doFillDimensions({ data: { company_id: companyId, product_ids: ids } });
        if (r2.updated > 0) toast.success(`Peso e dimensões atualizados em ${r2.updated} produto(s); ${r2.resolved} completos.`);
        if (r2.not_found > 0 || r2.supplier_incomplete > 0) {
          toast.warning(`${r2.not_found} produto(s) sem código correspondente no fornecedor; ${r2.supplier_incomplete} com peso ou medidas ausentes no próprio fornecedor.`);
        } else if (r2.updated === 0) toast.info("Nenhum peso ou medida pendente para preencher.");
      } else if (slug === "marca-obrigatoria") {
        const r2 = await doFillBrand({ data: { company_id: companyId, product_ids: ids } });
        if (r2.updated > 0) toast.success(`Marca preenchida pelo fornecedor em ${r2.updated} produto(s).`);
        if (r2.not_found > 0 || r2.supplier_incomplete > 0) toast.warning(`${r2.not_found} produto(s) sem código correspondente no fornecedor; ${r2.supplier_incomplete} sem marca no próprio fornecedor.`);
        else if (r2.updated === 0) toast.info("Nenhuma marca pendente para preencher.");
      } else if (slug === "crossdocking-minimo") {
        const r2 = await doSetCrossdocking({ data: { company_id: companyId, product_ids: ids, dias: 3 } });
        toast.success(`Crossdocking ajustado para 3 dias em ${r2.updated} produto(s).`);
      } else if (slug === "unidade-medida-centimetros") {
        const r2 = await doSetUnidadeCm({ data: { company_id: companyId, product_ids: ids } });
        toast.success(`Unidade de medida definida como Centímetros em ${r2.updated} produto(s).`);
      } else if (slug === "condicao-novo" || slug === "producao-terceiros") {
        const isCond = slug === "condicao-novo";
        const r2 = await doSetFixedField({ data: { company_id: companyId, product_ids: ids, field: isCond ? "condicao" : "producao" } });
        toast.success(`${isCond ? "Condição definida como Novo" : "Produção definida como Terceiros"} em ${r2.updated} produto(s).`);
      } else if (slug === "ean-obrigatorio") {
        const { ids: candidates } = await doAiListMissingEan({
          data: { company_id: companyId, product_ids: ids },
        });
        if (candidates.length === 0) { toast.info("Nenhum produto sem EAN."); return; }
        setEanIds(candidates);
        return;
      } else if (slug === "ncm-obrigatorio") {
        setNcmIds(ids);
        return;
      } else if (slug === "imagens-minimo" || slug === "imagem-placeholder") {
        setImageFixSource("supplier_ml");
        setMlImgIds(ids);
        return;
      }


      qc.invalidateQueries({ queryKey: ["products"] });
      setReauditOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao corrigir.");
    } finally {
      setFixingRule(null);
    }
  }

  /** Corrige usando o mesmo SKU já correto em outra empresa da conta. */
  async function fixByOtherCompany(slug: string, sourceCompanyId?: string) {
    if (!companyId) return;
    if (!CROSS_COMPANY_RULE_FIELDS[slug]) {
      toast.info("Esta regra não pode ser corrigida com dados de outra empresa.");
      return;
    }
    setCrossFixingRule(slug);
    setCrossFixProgress({ processed: 0, total: 0, updated: 0 });
    try {
      let ids: string[] = [];
      for (const st of ["error", "warning"]) {
        const r = await fetchAllIds({
          data: {
            company_id: companyId,
            audit_rule_slug: slug,
            audit_status: st,
            audit_run_id: auditRunId,
          },
        });
        if (r.ids.length > 0) { ids = r.ids; break; }
      }
      if (ids.length === 0) { toast.info("Nenhum produto para corrigir."); return; }
      if (CROSS_COMPANY_RULE_FIELDS[slug]?.includes("url_imagens_externas")) {
        setImageFixSource(sourceCompanyId ?? "__all__");
        setMlImgIds(ids);
        return;
      }
      setCrossFixProgress({ processed: 0, total: ids.length, updated: 0 });

      const CHUNK = 2000;
      const r = { updated: 0, sources: [] as string[] };
      const sourceSet = new Set<string>();
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = await doCrossCompanyFix({
          data: {
            company_id: companyId,
            rule_slug: slug,
            product_ids: ids.slice(i, i + CHUNK),
            dry_run: false,
            ...(sourceCompanyId ? { source_company_ids: [sourceCompanyId] } : {}),
          },
        });
        r.updated += part.updated;
        for (const s of part.sources) sourceSet.add(s);
        const processed = Math.min(i + CHUNK, ids.length);
        setCrossFixProgress({ processed, total: ids.length, updated: r.updated });
      }
      r.sources = [...sourceSet];
      if (r.updated === 0) {
        toast.info("Nenhum produto com o mesmo SKU já correto em outra empresa.");
        return;
      }
      toast.success(
        `${r.updated.toLocaleString("pt-BR")} produto(s) corrigidos com dados de: ${r.sources.join(", ")}.`,
      );
      qc.invalidateQueries({ queryKey: ["products"] });
      setReauditOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao corrigir com outra empresa.");
    } finally {
      setCrossFixingRule(null);
      setTimeout(() => setCrossFixProgress(null), 1200);
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Produtos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {readOnly ? "Produtos da empresa" : "Gerencie, transforme e audite os produtos da empresa. Para trazer novos produtos, use a página Importações."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && <TransformLogDialog companyId={companyId} onSelectIds={(ids) => setSelected(new Set(ids))} />}
          <div className="w-64">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger><SelectValue placeholder="Empresa..." /></SelectTrigger>
            <SelectContent>
              {companies.data?.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          </div>
        </div>
      </div>


      {!readOnly && <AssistedTransformCard companyId={companyId} onSelectIds={(ids) => setSelected(new Set(ids))} />}

      {/* Erros da última auditoria — com correção automática por regra */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Erros da última auditoria</CardTitle>
          <CardDescription>
            {readOnly ? "Erros e avisos encontrados na auditoria." : 'Tipos de erros encontrados. Use "Corrigir automaticamente" onde houver correção disponível, ou "Filtrar" para revisar os produtos afetados na lista abaixo.'}
          </CardDescription>
          <div>
            <Button
              variant="outline"
              className="h-auto whitespace-normal text-left"
              disabled={!companyId || bulkBusy || companyAuditRunning || !!productAudit || fixingRule !== null || crossFixingRule !== null}
              title={companyAuditRunning ? "Já existe uma auditoria em andamento nesta empresa" : "Auditar todas as correções pendentes desta empresa, mantendo os resultados dos demais produtos"}
              onClick={() => void bulkAudit([], false, true)}
            >
              <ShieldCheck className="mr-2 h-4 w-4 shrink-0" />
              Auditar corrigidos recentemente
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {issueTypes.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {issueTypes.data && issueTypes.data.issues.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {issueTypes.data.run_id ? "Nenhum erro/aviso na última auditoria." : "Execute uma auditoria para ver os erros aqui."}
            </p>
          )}
          {(issueTypes.data?.issues.length ?? 0) > 0 && (
            <div className="divide-y rounded-md border">
              {(issueTypes.data?.issues ?? []).flatMap((i) => {
                const fixableLabels: Record<string, string> = {
                  "descricao-complementar-igual-nome": "Copiar nome → descrição complementar",
                  "descricao-curta-minima": "Expandir descrição curta com IA (mín. 150)",
                  "garantia-duplicada-desc-curta": "Remover Garantia/Anatel (IA) e repreencher",
                  "garantia-anatel-desc-complementar": "Preencher Garantia + Código Anatel + Anvisa: Isento",
                  "titulo-maximo": "Encurtar título com IA (máx. 60)",
                  "imagens-maximo": "Reduzir para no máximo 18 imagens",
                  "imagens-extensao": "Remover apenas as imagens sem .png/.jpg",
                  "dimensoes-peso-obrigatorios": "Buscar peso e dimensões na base do fornecedor",
                  "crossdocking-minimo": "Definir crossdocking para 3 dias",
                  "unidade-medida-centimetros": "Definir unidade de medida como Centímetros",
                  "condicao-novo": "Definir condição como Novo",
                  "producao-terceiros": "Definir produção como Terceiros",
                  "produto-em-fornecedor": "Inativar no Bling os produtos fora da base do fornecedor",
                  "ean-obrigatorio": "Buscar EAN no Mercado Livre ou com IA (com revisão)",
                  "ncm-obrigatorio": "Buscar NCM no fornecedor (com revisão)",
                  "marca-obrigatoria": "Preencher marca pelo fornecedor",
                  "imagens-minimo": "Buscar imagens no fornecedor; alternativa: Mercado Livre por EAN (com revisão)",
                  "imagem-placeholder": "Trocar fotos inválidas: fornecedor ou Mercado Livre por EAN (com revisão)",
                };
                const aiBlocked = !AI_FEATURES_ENABLED && AI_FIX_RULE_SLUGS.has(i.rule_slug);

                type Row = {
                  key: string;
                  title: string;
                  errorCount: number;
                  warningCount: number;
                  note: string;
                  fixable: boolean;
                  filterStatus: "error" | "warning";
                };

                const isFornecedor = i.rule_slug === "produto-em-fornecedor";
                const rows: Row[] = isFornecedor
                  ? [
                      ...(i.error_count > 0
                        ? [
                            {
                              key: `${i.rule_slug}:error`,
                              title: `${i.name} — SKU com prefixo padrão`,
                              errorCount: i.error_count,
                              warningCount: 0,
                              note: "Prefixo reconhecido e código ausente na base do fornecedor. Correção: inativar no Bling.",
                              fixable: true,
                              filterStatus: "error" as const,
                            },
                          ]
                        : []),
                      ...(i.warning_count > 0
                        ? [
                            {
                              key: `${i.rule_slug}:warning`,
                              title: `${i.name} — SKU sem prefixo padrão`,
                              errorCount: 0,
                              warningCount: i.warning_count,
                              note: "Fora do padrão de prefixos da empresa: não são inativados, apenas revise manualmente.",
                              fixable: false,
                              filterStatus: "warning" as const,
                            },
                          ]
                        : []),
                    ]
                  : [
                      {
                        key: i.rule_slug,
                        title: i.name,
                        errorCount: i.error_count,
                        warningCount: i.warning_count,
                        note: aiBlocked
                          ? AI_DISABLED_MESSAGE
                          : (fixableLabels[i.rule_slug] ?? "Sem correção automática"),
                        fixable: !!fixableLabels[i.rule_slug],
                        filterStatus: "error" as const,
                      },
                    ];

                return rows.map((row) => (
                  <div key={row.key} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{row.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        {row.errorCount > 0 && <Badge variant="destructive">{row.errorCount.toLocaleString("pt-BR")} erro(s)</Badge>}
                        {row.warningCount > 0 && <Badge variant="outline" className="border-amber-500 text-amber-700">{row.warningCount.toLocaleString("pt-BR")} aviso(s)</Badge>}
                        <Badge variant="secondary">{i.category}</Badge>
                        {!readOnly && <span className="text-muted-foreground">{row.note}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setAuditRule(i.rule_slug); setAuditStatus(row.filterStatus); setPage(1); }}>
                        Filtrar
                      </Button>
                      {!readOnly && row.fixable && (
                        <Button
                          size="sm"
                          disabled={aiBlocked || fixingRule !== null || !companyId}
                          onClick={() => {
                            if (i.rule_slug === "produto-em-fornecedor") { setConfirmInativar(true); return; }
                            autoFixByRule(i.rule_slug);
                          }}
                        >
                          {fixingRule === i.rule_slug ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                          Corrigir automaticamente
                        </Button>
                      )}
                      {!readOnly && row.filterStatus === "error" && CROSS_COMPANY_RULE_FIELDS[i.rule_slug] && (
                        <Button
                          size="sm"
                          variant="secondary"
                          title="Copia o dado do mesmo SKU já correto em outra empresa da conta"
                          disabled={crossFixingRule !== null || !companyId}
                          onClick={() => { setCrossFixSource("__all__"); setCrossFixAskRule(i.rule_slug); }}
                        >
                          {crossFixingRule === i.rule_slug ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                          Corrigir com outra empresa
                        </Button>
                      )}
                    </div>
                  </div>
                ));
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {auditRule !== "all" && (
        <Card>
          <CardHeader>
            <CardTitle>Produtos com problemas</CardTitle>
            <CardDescription>
              Lista dos produtos afetados pelo filtro selecionado e o motivo registrado na auditoria.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {auditProblems.isLoading ? <p className="text-sm text-muted-foreground">Carregando problemas...</p> : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left"><tr><th className="px-3 py-2">Código</th><th className="px-3 py-2">Produto</th><th className="px-3 py-2">Regra</th><th className="px-3 py-2">Problema</th></tr></thead>
                  <tbody>
                    {(auditProblems.data?.items ?? []).filter((item: any) => item.regra === auditRule && (auditStatus === "any" || item.severidade === auditStatus)).map((item: any, index: number) => (
                      <tr key={`${item.codigo}-${index}`} className="border-t"><td className="px-3 py-2 font-mono text-xs">{item.codigo || "—"}</td><td className="px-3 py-2">{item.produto || "—"}</td><td className="px-3 py-2"><Badge variant="secondary">{item.regra}</Badge></td><td className="px-3 py-2 text-amber-700">{item.mensagem || "Problema sem descrição"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={crossFixAskRule !== null} onOpenChange={(o) => { if (!o) setCrossFixAskRule(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Corrigir com dados de qual empresa?</DialogTitle>
            <DialogDescription>
              Escolha de qual empresa os dados corretos do mesmo SKU devem ser copiados. Só é copiado o
              campo da regra selecionada.
            </DialogDescription>
          </DialogHeader>
          <Select value={crossFixSource} onValueChange={setCrossFixSource}>
            <SelectTrigger><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Qualquer empresa (a primeira correta)</SelectItem>
              {companies.data?.filter((c) => c.id !== companyId).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCrossFixAskRule(null)}>Cancelar</Button>
            <Button
              onClick={() => {
                const slug = crossFixAskRule;
                setCrossFixAskRule(null);
                if (slug) fixByOtherCompany(slug, crossFixSource === "__all__" ? undefined : crossFixSource);
              }}
            >
              Corrigir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmInativar} onOpenChange={setConfirmInativar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Inativar produtos no Bling?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é mais grave: serão inativados no Bling e na base somente os produtos ativos
              com SKU no padrão de prefixo da empresa que não foram encontrados na base do fornecedor.
              Os SKUs fora do padrão de prefixo continuam ativos e não são tocados. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => { setConfirmInativar(false); await autoFixByRule("produto-em-fornecedor"); }}
            >
              Sim, inativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {companyId && eanIds && (
        <EanSuggestDialog
          open={!!eanIds}
          onOpenChange={(v) => { if (!v) setEanIds(null); }}
          companyId={companyId}
          productIds={eanIds}
          onApplied={() => { qc.invalidateQueries({ queryKey: ["products"] }); setReauditOpen(true); }}
        />
      )}

      {companyId && mlImgIds && (
        <MlImagesDialog
          open={!!mlImgIds}
          onOpenChange={(v) => { if (!v) setMlImgIds(null); }}
          companyId={companyId}
          productIds={mlImgIds}
          companies={companies.data ?? []}
          initialSource={imageFixSource}
          min={3}
          max={18}
          onApplied={() => { qc.invalidateQueries({ queryKey: ["products"] }); setReauditOpen(true); }}
        />
      )}

      {companyId && ncmIds && (
        <NcmSuggestDialog
          open={!!ncmIds}
          onOpenChange={(v) => { if (!v) setNcmIds(null); }}
          companyId={companyId}
          productIds={ncmIds}
          onApplied={() => { qc.invalidateQueries({ queryKey: ["products"] }); setReauditOpen(true); }}
        />
      )}


      <Dialog open={auditScopeOpen} onOpenChange={setAuditScopeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Escopo da auditoria</DialogTitle>
            <DialogDescription>
              Quais produtos devem entrar na auditoria? Algumas correções consistem em inativar o produto.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={auditScope} onValueChange={(v) => setAuditScope(v as "active" | "all")} className="gap-3 py-2">
            <div className="flex items-start gap-2">
              <RadioGroupItem value="active" id="audit-scope-active" className="mt-1" />
              <Label htmlFor="audit-scope-active" className="cursor-pointer leading-snug">
                Apenas produtos ativos
                <span className="block text-xs text-muted-foreground">Ignora produtos inativos (recomendado).</span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="all" id="audit-scope-all" className="mt-1" />
              <Label htmlFor="audit-scope-all" className="cursor-pointer leading-snug">
                Todos os produtos
                <span className="block text-xs text-muted-foreground">Inclui inativos — útil para decidir o que inativar.</span>
              </Label>
            </div>
          </RadioGroup>
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={auditSkipImages} onChange={(e) => { setAuditSkipImages(e.target.checked); lastAuditSkipImages.current = e.target.checked; }} />
            <span><span className="font-medium">Auditoria rápida (sem conferir fotos)</span>
              <span className="block text-xs text-muted-foreground">Pula a verificação de imagem padrão e fotos inacessíveis.</span></span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAuditScopeOpen(false)}>Cancelar</Button>
            <Button
              onClick={async () => {
                setAuditScopeOpen(false);
                const ids = auditPendingIds.current ?? [];
                auditPendingIds.current = null;
                await bulkAudit(ids, auditScope === "active");
              }}
            >
              Iniciar auditoria
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={reauditOpen} onOpenChange={setReauditOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reauditar produtos?</AlertDialogTitle>
            <AlertDialogDescription>
              As correções foram aplicadas. Deseja rodar a auditoria novamente para atualizar a lista de erros?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Agora não</AlertDialogCancel>
            <AlertDialogAction disabled={companyAuditRunning || !!productAudit} onClick={async () => { setReauditOpen(false); await bulkAudit([], false, true); }}>
              Auditar corrigidos recentemente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {!readOnly && <>
      <CrossCompanyImportCard companyId={companyId} />

      <TransformacoesCard
        companyId={companyId}
        selectedIds={Array.from(selected)}
        onStripHtml={async (ids) => {
          if (!companyId) return;
          const r = await doStripHtml({ data: { company_id: companyId, product_ids: ids } });
          toast.success(`HTML removido em ${r.updated} produto(s).`);
          qc.invalidateQueries({ queryKey: ["products"] });
        }}
        onFillDesc={async (ids) => {
          if (!companyId) return;
          const r = await doFillDesc({ data: { company_id: companyId, product_ids: ids } });
          toast.success(`Descrição complementar preenchida em ${r.updated} produto(s).`);
          qc.invalidateQueries({ queryKey: ["products"] });
        }}
        onFillGarantiaAnatel={async (ids) => {
          if (!companyId) return;
          const r = await doFillGarantiaAnatel({ data: { company_id: companyId, product_ids: ids } });
          toast.success(`Garantia, Código Anatel e Anvisa: Isento preenchidos em ${r.updated} produto(s).`);
          qc.invalidateQueries({ queryKey: ["products"] });
        }}
        onUpdateAnatelCode={async (ids) => {
          if (!companyId) return;
          const r = await doUpdateAnatelCode({ data: { company_id: companyId, product_ids: ids } });
          toast.success(`Código Anatel atualizado em ${r.updated} produto(s).`);
          qc.invalidateQueries({ queryKey: ["products"] });
        }}
        onRemoveGarantiaAnatel={async (ids) => {
          if (!companyId) return;
          const r = await doRemoveGarantiaAnatel({ data: { company_id: companyId, product_ids: ids } });
          toast.success(`Bloco Garantia/Anatel removido de ${r.updated} produto(s).`);
          qc.invalidateQueries({ queryKey: ["products"] });
        }}
        onSyncSupplier={async (ids, includeStores, mode = "ambos", considerMlStock = true) => {
          if (!companyId) return;
          const r = await doSyncSupplier({
            data: {
              company_id: companyId,
              product_ids: ids,
              include_stores: !!includeStores,
              only_price: mode === "preco",
              only_stock: mode === "estoque",
              consider_ml_stock: considerMlStock,
            },
          });
          setSupplierReport(r);
          const extra = includeStores
            ? ` • ${(r.stores_updated ?? 0).toLocaleString("pt-BR")} preço(s) atualizados nas multilojas`
            : "";
          toast.success(`Sincronização concluída em ${r.total} produto(s).${extra}`);
          if (r.no_default_marketplace) {
            toast.warning("Nenhuma loja marcada como padrão em Multilojas — preço de venda não foi recalculado.");
          }
          qc.invalidateQueries({ queryKey: ["products"] });
          // Toda precificação dispara uma auditoria automática no escopo alterado.
          toast.info("Rodando auditoria após a precificação...");
          await bulkAudit(ids ?? []);
          qc.invalidateQueries({ queryKey: ["low-margin"] });
        }}
        onFillEanSupplier={async (ids) => {
          if (!companyId) return;
          const r = await doFillEanSupplier({ data: { company_id: companyId, product_ids: ids } });
          toast.success(
            `EAN preenchido em ${r.updated} produto(s). ${r.not_found} sem correspondência na base do fornecedor.`,
          );
          qc.invalidateQueries({ queryKey: ["products"] });
        }}
        onTrimImages={async (ids) => {
          if (!companyId) return;
          const r = await doTrimImages({ data: { company_id: companyId, product_ids: ids, max: 18 } });
          toast.success(
            `Reduzido para no máximo ${r.max} imagens em ${r.updated} produto(s). ${r.removed} link(s) removido(s).`,
          );
          qc.invalidateQueries({ queryKey: ["products"] });
        }}
        onZeroStock={async (ids) => {
          if (!companyId) return;
          const r = await doZeroStock({ data: { company_id: companyId, product_ids: ids } });
          toast.success(`Estoque zerado em ${r.updated.toLocaleString("pt-BR")} produto(s).`);
          qc.invalidateQueries({ queryKey: ["products"] });
        }}
        onAutoFix={async (ids) => {
          if (!companyId) return;
          const r = await doAutoFix({ data: { company_id: companyId, product_ids: ids } });
          toast.success(`${r.fixed} erro(s) auto-corrigido(s).`);
          qc.invalidateQueries({ queryKey: ["products"] });
        }}
        onAiShortenTitles={async (ids) => {
          if (!companyId) return;
          const { ids: candidates } = await doAiListLongTitles({
            data: { company_id: companyId, product_ids: ids, max_length: 60 },
          });
          await startAiJob("shorten_title", "Títulos", candidates, { max_length: 60 });
        }}
        onAiRemoveWarranty={async (ids) => {
          if (!companyId) return;
          const { ids: candidates } = await doAiListWarranty({
            data: { company_id: companyId, product_ids: ids },
          });
          await startAiJob("remove_warranty", "Garantia/Anatel", candidates);
        }}
        onAiExpandShortDesc={async (ids) => {
          if (!companyId) return;
          const { ids: candidates } = await doAiListShortDesc({
            data: { company_id: companyId, product_ids: ids, min_length: 150 },
          });
          await startAiJob("expand_short_desc", "Descrições curtas", candidates, { min_length: 150 });
        }}
      />


      <SupplierSyncReportDialog report={supplierReport} onClose={() => setSupplierReport(null)} />



      <BlingPushCard companyId={companyId} selectedIds={Array.from(selected)} />



      <Card>
        <CardHeader>
          <CardTitle>Ferramentas de base de dados</CardTitle>
          <CardDescription>Limpe duplicados por SKU ou copie a base de outra empresa.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3 rounded-md border p-4">
            <div className="font-medium">Excluir duplicados (por SKU)</div>
            <p className="text-xs text-muted-foreground">
              Agrupa produtos com o mesmo Código e mantém apenas um por grupo.
            </p>
            <Select value={dedupeKeep} onValueChange={(v) => setDedupeKeep(v as "newest" | "oldest")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Manter o mais recente</SelectItem>
                <SelectItem value="oldest">Manter o mais antigo</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="destructive"
              disabled={!companyId || dedupeBusy}
              onClick={() => setDedupeOpen(true)}
            >
              {dedupeBusy ? "Removendo..." : "Excluir duplicados"}
            </Button>
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <div className="font-medium">Duplicar base de outra empresa</div>
            <p className="text-xs text-muted-foreground">
              Copia todos os produtos da empresa selecionada para esta empresa. SKUs já existentes são preservados
              (marque "sobrescrever" para atualizar).
            </p>
            <Select value={sourceCompany} onValueChange={setSourceCompany}>
              <SelectTrigger><SelectValue placeholder="Empresa de origem..." /></SelectTrigger>
              <SelectContent>
                {companies.data?.filter((c) => c.id !== companyId).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              Sobrescrever SKUs já existentes nesta empresa
            </label>
            <Button
              disabled={!companyId || !sourceCompany || duplicateBusy}
              onClick={handleDuplicate}
            >
              {duplicateBusy ? "Copiando..." : "Duplicar produtos"}
            </Button>
          </div>
        </CardContent>
      </Card>

      </>}
      <AlertDialog open={dedupeOpen} onOpenChange={setDedupeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir duplicados?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação vai remover permanentemente os produtos duplicados por SKU,
              mantendo apenas o {dedupeKeep === "newest" ? "mais recente" : "mais antigo"} de cada grupo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDedupe}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {dupProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-[min(92vw,480px)] rounded-lg border bg-background p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div className="font-semibold">Duplicando produtos...</div>
            </div>
            <p className="text-sm text-muted-foreground">
              Não feche esta janela até o processo terminar.
            </p>
            <Progress
              value={dupProgress.total > 0 ? Math.min(100, (dupProgress.processed / dupProgress.total) * 100) : 0}
            />
            <div className="text-sm">
              <div>
                <span className="font-medium">{dupProgress.processed.toLocaleString("pt-BR")}</span>
                {" de "}
                <span className="font-medium">{(dupProgress.total || dupProgress.processed).toLocaleString("pt-BR")}</span>
                {" produtos processados"}
              </div>
              <div className="text-muted-foreground text-xs mt-1">
                Copiados: {dupProgress.copied.toLocaleString("pt-BR")}
                {dupProgress.skipped > 0 && ` · Ignorados: ${dupProgress.skipped.toLocaleString("pt-BR")}`}
              </div>
            </div>
          </div>
        </div>
      )}

      {crossFixProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-[min(92vw,480px)] rounded-lg border bg-background p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div className="font-semibold">Corrigindo com dados de outra empresa...</div>
            </div>
            <p className="text-sm text-muted-foreground">
              Não feche esta janela até o processo terminar.
            </p>
            <Progress
              value={crossFixProgress.total > 0 ? Math.min(100, (crossFixProgress.processed / crossFixProgress.total) * 100) : 0}
            />
            <div className="text-sm">
              <div>
                <span className="font-medium">{crossFixProgress.processed.toLocaleString("pt-BR")}</span>
                {" de "}
                <span className="font-medium">{crossFixProgress.total.toLocaleString("pt-BR")}</span>
                {" produtos analisados"}
                {crossFixProgress.total > 0 && (
                  <span className="text-muted-foreground">
                    {` · faltam ${Math.max(0, crossFixProgress.total - crossFixProgress.processed).toLocaleString("pt-BR")}`}
                  </span>
                )}
              </div>
              <div className="text-muted-foreground text-xs mt-1">
                Corrigidos: {crossFixProgress.updated.toLocaleString("pt-BR")}
              </div>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lista de produtos</CardTitle>
          <CardDescription>{products.data?.count ?? 0} produtos sincronizados</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Buscar</label>
              <Input placeholder="Nome, código ou GTIN..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Situação</label>
              <Select value={situacao} onValueChange={(v) => { setSituacao(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="Situação" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as situações</SelectItem>
                  <SelectItem value="A">Ativo</SelectItem>
                  <SelectItem value="I">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Detalhes do Bling</label>
              <Select value={detailFilter} onValueChange={(v) => { setDetailFilter(v as "all" | "synced" | "pending"); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os detalhes</SelectItem>
                  <SelectItem value="synced">Detalhes sincronizados</SelectItem>
                  <SelectItem value="pending">Detalhes pendentes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Lojas vinculadas</label>
              <Select value={storesFilter} onValueChange={(v) => { setStoresFilter(v as StoresFilter); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as quantidades</SelectItem>
                  <SelectItem value="0">Sem loja vinculada</SelectItem>
                  <SelectItem value="any">Com pelo menos 1 loja</SelectItem>
                  <SelectItem value="1">Exatamente 1 loja</SelectItem>
                  <SelectItem value="2">Exatamente 2 lojas</SelectItem>
                  <SelectItem value="3">Exatamente 3 lojas</SelectItem>
                  <SelectItem value="4plus">4 ou mais lojas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Multiloja específica</label>
              <Select value={blingStoreId} onValueChange={(value) => { setBlingStoreId(value); setPage(1); }} disabled={!companyId || channels.isLoading}>
                <SelectTrigger><SelectValue placeholder="Todas as multilojas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as multilojas</SelectItem>
                  {(channels.data ?? []).map((store: { bling_store_id: string; descricao: string | null }) => (
                    <SelectItem key={store.bling_store_id} value={store.bling_store_id}>
                      {store.descricao || `Loja ${store.bling_store_id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Tipo de erro/aviso</label>
              <Select value={auditRule} onValueChange={(v) => { setAuditRule(v); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo de erro/aviso" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos (sem filtro de auditoria)</SelectItem>
                  {issueTypes.data?.run_id && (
                    <SelectItem value="__clean__">Sem erros nem avisos</SelectItem>
                  )}
                  {issueTypes.data?.issues.map((i) => (
                    <SelectItem key={i.rule_slug} value={i.rule_slug}>
                      {i.name} — {i.error_count > 0 ? `${i.error_count} erro(s)` : ""}
                      {i.error_count > 0 && i.warning_count > 0 ? " · " : ""}
                      {i.warning_count > 0 ? `${i.warning_count} aviso(s)` : ""}
                    </SelectItem>
                  ))}
                  {issueTypes.data && issueTypes.data.issues.length === 0 && (
                    <SelectItem value="__none" disabled>
                      {issueTypes.data.run_id ? "Sem erros na última auditoria" : "Execute uma auditoria primeiro"}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Severidade da auditoria</label>
              <Select
                value={auditStatus}
                onValueChange={(v) => { setAuditStatus(v as "any" | "error" | "warning"); setPage(1); }}
                disabled={auditRule === "all" || auditRule === "__clean__"}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Erros e avisos</SelectItem>
                  <SelectItem value="error">Somente erros</SelectItem>
                  <SelectItem value="warning">Somente avisos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2 text-sm">
            <span className="px-2 text-muted-foreground">
              {selected.size > 0 ? `${selected.size} selecionado(s)` : "Selecione produtos para ações em lote"}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkBusy || selectingAll || !companyId || (products.data?.count ?? 0) === 0}
              onClick={selectAllFiltered}
            >
              {selectingAll ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Selecionar todos ({(products.data?.count ?? 0).toLocaleString("pt-BR")})
            </Button>
            {selected.size > 0 && (
              <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
                Limpar seleção
              </Button>
            )}
            {!readOnly && <Button size="sm" variant="outline" disabled={bulkBusy || !companyId || (products.data?.count ?? 0) === 0} onClick={() => setExportOpen(true)}>
              <Download className="mr-1 h-3.5 w-3.5" /> Exportar {selected.size > 0 ? "selecionados" : "filtrados"}
            </Button>}
            <Button size="sm" variant="outline" disabled={bulkBusy || companyAuditRunning} title={companyAuditRunning ? "Já existe uma auditoria em andamento nesta empresa." : undefined} onClick={() => requestAudit()}>
              <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Auditar {selected.size > 0 ? "selecionados" : "todos"}
            </Button>
            {!readOnly && <>
            <Button size="sm" variant="destructive" disabled={bulkBusy || selected.size === 0} onClick={bulkDelete}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Excluir selecionados
            </Button>
            <Button size="sm" variant="destructive" disabled={bulkBusy || !companyId} onClick={bulkDeleteAll}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Excluir todos
            </Button>
            </>}
          </div>
          {exportProgress && (
            <div className="space-y-2 rounded-md border p-3">
              <Progress value={exportProgress.total > 0 ? (exportProgress.done / exportProgress.total) * 100 : 0} />
              <p className="text-xs text-muted-foreground">
                {exportProgress.done.toLocaleString("pt-BR")} de {exportProgress.total.toLocaleString("pt-BR")} produtos exportados
              </p>
            </div>
          )}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase">
                <tr>
                  <th className="px-3 py-2">
                    <Checkbox
                      checked={
                        (products.data?.rows.length ?? 0) > 0 &&
                        products.data!.rows.every((r) => selected.has(r.id))
                      }
                      onCheckedChange={toggleAllVisible}
                    />
                  </th>
                  <th className="px-3 py-2">Imagem</th>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Marca</th>
                  <th className="px-3 py-2">Situação</th>
                  <th className="px-3 py-2">Preço</th>
                  <th className="px-3 py-2">GTIN</th>
                  <th className="px-3 py-2">Lojas</th>
                  <th className="px-3 py-2">Auditoria</th>
                  <th className="px-3 py-2">Forn.</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {products.data?.rows.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="px-3 py-2">
                      <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                    </td>
                    <td className="px-3 py-2">
                      {(() => {
                        const raw = String(p.url_imagens_externas ?? "");
                        const fromList = raw.split(/[|\n\r]+/).map((s) => s.trim()).find((u) => /^https?:\/\//i.test(u));
                        const picked = fromList ?? p.imagem_principal_url ?? null;
                        // Encoda espaços e outros caracteres inseguros que quebram <img src="">
                        const src = picked ? picked.replace(/\s/g, "%20") : null;
                        return src ? (
                          <img src={src} alt="" className="h-10 w-10 rounded object-cover" referrerPolicy="no-referrer" loading="lazy" />
                        ) : (
                          <div className="h-10 w-10 rounded bg-muted" />
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{p.codigo ?? "—"}</td>
                    <td className="px-3 py-2">{p.nome ?? "—"}</td>
                    <td className="px-3 py-2">{p.marca ?? "—"}</td>
                    <td className="px-3 py-2">{p.situacao ?? "—"}</td>
                    <td className="px-3 py-2">{p.preco != null ? Number(p.preco).toFixed(2) : "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.gtin ?? "—"}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setStoresModal({ id: p.id, nome: p.nome ?? null, codigo: p.codigo ?? null, blingId: (p as any).bling_product_id ?? null })}
                        className="text-xs underline-offset-2 hover:underline"
                      >
                        {(p.stores_count ?? 0) > 0 ? `${p.stores_count} lojas` : "Nenhuma loja"}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      {p.last_audit_at == null ? (
                        <Badge variant="secondary">—</Badge>
                      ) : (p.last_audit_errors ?? 0) > 0 ? (
                        <Badge variant="destructive">{p.last_audit_errors} erros</Badge>
                      ) : (p.last_audit_warnings ?? 0) > 0 ? (
                        <Badge variant="outline" className="border-amber-500 text-amber-700">{p.last_audit_warnings} avisos</Badge>
                      ) : (
                        <Badge className="bg-emerald-600">OK</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-md border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="Fornecedores alternativos"
                          >
                            <Store className="h-4 w-4" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" sideOffset={4} className="w-[560px] max-w-[90vw] p-0">
                          <div className="max-h-[70vh] overflow-y-auto">
                            <AlternativeSuppliersCard
                              sku={p.codigo}
                              ean={p.gtin}
                              nome={p.nome}
                              productId={p.id}
                              precoVenda={p.preco != null ? Number(p.preco) : null}
                            />
                          </div>
                        </PopoverContent>
                      </Popover>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setEditingId(p.id)}
                        className="inline-flex items-center rounded-md border px-2 py-1 text-xs hover:bg-accent"
                      >
                        <Pencil className="mr-1 h-3 w-3" /> {readOnly ? "Visualizar" : "Editar"}
                      </button>
                    </td>
                  </tr>
                ))}
                {products.data && products.data.rows.length === 0 && (
                  <tr><td colSpan={12} className="px-3 py-8 text-center text-muted-foreground">Nenhum produto encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <PageNumbers
            page={page}
            pageSize={25}
            total={products.data?.count ?? 0}
            onChange={setPage}
          />
        </CardContent>
      </Card>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Como deseja exportar?</DialogTitle>
            <DialogDescription>
              {selected.size > 0
                ? `Escolha o formato para os ${selected.size.toLocaleString("pt-BR")} produtos selecionados.`
                : `Nenhum produto selecionado — exportaremos os ${(products.data?.count ?? 0).toLocaleString("pt-BR")} produtos que correspondem ao filtro atual.`}
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={exportMode} onValueChange={(value) => setExportMode(value as "single" | "1000")} className="space-y-3">
            <div className="flex items-start gap-3 rounded-md border p-4">
              <RadioGroupItem value="single" id="export-single" />
              <Label htmlFor="export-single" className="grid cursor-pointer gap-1">
                <span>Uma única planilha</span>
                <span className="font-normal text-muted-foreground">Todos os produtos em um arquivo CSV.</span>
              </Label>
            </div>
            <div className="flex items-start gap-3 rounded-md border p-4">
              <RadioGroupItem value="1000" id="export-zip" />
              <Label htmlFor="export-zip" className="grid cursor-pointer gap-1">
                <span>Várias planilhas em ZIP</span>
                <span className="font-normal text-muted-foreground">Um CSV para cada grupo de até 1.000 produtos.</span>
              </Label>
            </div>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>Cancelar</Button>
            <Button onClick={bulkExport}><Download className="mr-2 h-4 w-4" />Exportar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProductEditModal
        productId={editingId}
        companyId={companyId}
        open={!!editingId}
        onOpenChange={(v) => { if (!v) setEditingId(null); }}
      />
      {storesModal && companyId && (
        <ProductStoresModal
          open={!!storesModal}
          onOpenChange={(v) => { if (!v) setStoresModal(null); }}
          companyId={companyId}
          productId={storesModal.id}
          productName={storesModal.nome}
          productCode={storesModal.codigo}
          blingProductId={storesModal.blingId}
        />
      )}
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{children}</div>
    </div>
  );
}

function TransformacoesCard({
  companyId,
  selectedIds,
  onStripHtml,
  onFillDesc,
  onFillGarantiaAnatel,
  onUpdateAnatelCode,
  onRemoveGarantiaAnatel,
  onSyncSupplier,
  onFillEanSupplier,
  onTrimImages,
  onZeroStock,
  onAutoFix,
  onAiShortenTitles,
  onAiRemoveWarranty,
  onAiExpandShortDesc,
}: {
  companyId: string | undefined;
  selectedIds: string[];
  onStripHtml: (ids?: string[]) => Promise<void>;
  onFillDesc: (ids?: string[]) => Promise<void>;
  onFillGarantiaAnatel: (ids?: string[]) => Promise<void>;
  onUpdateAnatelCode: (ids?: string[]) => Promise<void>;
  onRemoveGarantiaAnatel: (ids?: string[]) => Promise<void>;
  onSyncSupplier: (
    ids: string[] | undefined,
    includeStores: boolean,
    mode?: "ambos" | "preco" | "estoque",
    considerMlStock?: boolean,
  ) => Promise<void>;
  onFillEanSupplier: (ids?: string[]) => Promise<void>;
  onTrimImages: (ids?: string[]) => Promise<void>;
  onZeroStock: (ids?: string[]) => Promise<void>;
  onAutoFix: (ids?: string[]) => Promise<void>;
  onAiShortenTitles: (ids?: string[]) => Promise<void>;
  onAiRemoveWarranty: (ids?: string[]) => Promise<void>;
  onAiExpandShortDesc: (ids?: string[]) => Promise<void>;
}) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<"all" | "selected" | "changed">(selectedIds.length > 0 ? "selected" : "all");
  useEffect(() => {
    if (selectedIds.length > 0) setScope("selected");
    else setScope((s) => (s === "changed" ? "changed" : "all"));
  }, [selectedIds.length]);
  type Kind = "html" | "desc" | "garantia" | "atualizar-anatel" | "remover-garantia" | "supplier" | "preco" | "estoque" | "ean" | "trim-imgs" | "zero-stock" | "fix" | "ai-title" | "ai-warranty" | "ai-expand" | "store-code" | "verify-existence";
  const [busy, setBusy] = useState<null | Kind>(null);
  const [priceStockTarget, setPriceStockTarget] = useState<"bling" | "multilojas">("bling");
  const [considerMlStock, setConsiderMlStock] = useState(true);
  const [selectedTransform, setSelectedTransform] = useState<Kind>("html");
  const [storeCodeMarketplace, setStoreCodeMarketplace] = useState<StoreCodeMarketplace>("kabum");
  const [storeCodeDialogOpen, setStoreCodeDialogOpen] = useState(false);
  const [existenceConfirm, setExistenceConfirm] = useState(false);
  const [existenceIds, setExistenceIds] = useState<string[] | undefined>();
  const startExistenceFn = useServerFn(startExistenceJob);
  const fetchChangedIds = useServerFn(listChangedProductIds);
  const changedQuery = useQuery({
    queryKey: ["changed-product-ids", companyId],
    queryFn: () => fetchChangedIds({ data: { company_id: companyId! } }),
    enabled: !!companyId && scope === "changed",
    staleTime: 30_000,
  });
  const changedIds = changedQuery.data?.ids ?? [];
  const ids = scope === "selected" ? selectedIds : scope === "changed" ? changedIds : undefined;
  const disabledScope =
    (scope === "selected" && selectedIds.length === 0) ||
    (scope === "changed" && (changedQuery.isLoading || changedIds.length === 0));
  async function run(kind: Kind, fn: () => Promise<void>) {
    setBusy(kind);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setBusy(null); }
  }


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Wand2 className="h-5 w-5" /> Transformações</CardTitle>
        <CardDescription>Aplique correções em massa nos produtos desta empresa.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PricingPolicyAlert companyId={companyId} />
        <div className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <div className="font-medium">Aplicar em</div>
            <div className="text-xs text-muted-foreground">
              {scope === "selected"
                ? `${selectedIds.length.toLocaleString("pt-BR")} produto(s) selecionado(s)`
                : scope === "changed"
                  ? changedQuery.isLoading
                    ? "Carregando produtos alterados..."
                    : `${changedIds.length.toLocaleString("pt-BR")} produto(s) alterado(s) desde a última sincronização`
                  : "Todos os produtos desta empresa"}
            </div>
          </div>
          <Select value={scope} onValueChange={(v) => setScope(v as "all" | "selected" | "changed")}>
            <SelectTrigger className="w-full sm:w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os produtos</SelectItem>
              <SelectItem value="selected" disabled={selectedIds.length === 0}>
                Somente selecionados ({selectedIds.length.toLocaleString("pt-BR")})
              </SelectItem>
              <SelectItem value="changed">Somente o que mudou (não sincronizado)</SelectItem>
            </SelectContent>
          </Select>

        </div>

        {(() => {
          type Item = { key: Kind; label: string; ai?: boolean; desc: string; extra?: React.ReactNode; run: () => Promise<void>; variant?: "default" | "secondary" | "outline" };
          const items: Item[] = [
            { key: "verify-existence", label: "Verificar produtos excluídos do Bling", desc: "Verifica cada produto no Bling e exclui do Ajusta-Ê somente os que não existem mais. Produtos sem ID e falhas de acesso são mantidos.", run: async () => { setExistenceIds(ids ? [...ids] : undefined); setExistenceConfirm(true); }, variant: "outline" },
            { key: "html", label: "Remover HTML dos campos", desc: "Converte descrição curta, complementar, observações e informações adicionais em texto puro.", run: () => onStripHtml(ids) },
            { key: "desc", label: "Descrição complementar = nome", desc: "Copia o nome do produto para o campo descrição complementar.", run: () => onFillDesc(ids) },
            { key: "garantia", label: "Preencher Garantia + Código Anatel + Anvisa: Isento", desc: 'Adiciona "Garantia: 3 meses", o "Código Anatel" e "Anvisa: Isento" na descrição curta. Busca o código na base ANATEL pelo SKU; se não encontrar, preenche o código com "isento".', run: () => onFillGarantiaAnatel(ids) },
            { key: "atualizar-anatel", label: "Atualizar Código Anatel (só esse campo)", desc: 'Atualiza apenas o "Código Anatel" na descrição curta, com o valor da base ANATEL (ou "isento" quando não encontrar). Garantia, Anvisa e o restante do texto não são alterados.', run: () => onUpdateAnatelCode(ids), variant: "secondary" },
            { key: "remover-garantia", label: "Remover Garantia + Anatel (determinístico)", desc: 'Remove trechos com "Garantia" e "Anatel" da descrição curta.', run: () => onRemoveGarantiaAnatel(ids), variant: "outline" },
            {
              key: "preco",
              label: "Atualizar preço (via fornecedor)",
              desc: "Atualiza apenas custo, preço de compra e preço de venda (pela Política de Precificação) a partir da base do fornecedor. O estoque não é alterado.",
              extra: (
                <div>
                  <Label className="text-xs text-muted-foreground">Também recalcular preço nas multilojas</Label>
                  <Select value={priceStockTarget} onValueChange={(v) => setPriceStockTarget(v as "bling" | "multilojas")}>
                    <SelectTrigger className="w-full sm:w-[320px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bling">Somente o produto (não mexe nas multilojas)</SelectItem>
                      <SelectItem value="multilojas">Produto + preço das multilojas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ),
              run: () => onSyncSupplier(ids, priceStockTarget === "multilojas", "preco"),
            },
            {
              key: "estoque",
              label: "Atualizar estoque (via fornecedor)",
              desc: "Atualiza apenas o estoque a partir da base do fornecedor (respeitando o limite de estoque configurado). Nenhum preço é alterado.",
              extra: (
                <div className="flex items-center gap-2">
                  <Switch id="transform-stock-ml" checked={considerMlStock} onCheckedChange={setConsiderMlStock} disabled={busy !== null} />
                  <Label htmlFor="transform-stock-ml">Considerar estoque do Mercado Livre</Label>
                </div>
              ),
              run: () => onSyncSupplier(ids, false, "estoque", considerMlStock),
              variant: "secondary",
            },
            { key: "ean", label: "Pesquisar EAN no fornecedor", desc: "Busca o GTIN/EAN na base do fornecedor pelo prefixo do SKU e preenche apenas os produtos sem GTIN.", run: () => onFillEanSupplier(ids), variant: "secondary" },
            { key: "trim-imgs", label: "Reduzir imagens para no máximo 18", desc: "Mantém apenas as 18 primeiras imagens de cada produto (na ordem cadastrada) e remove o restante.", run: () => onTrimImages(ids), variant: "secondary" },
            {
              key: "store-code",
              label: "Atualizar ID na loja",
              desc: "Atualiza somente o ID na loja dos vínculos do marketplace escolhido e confirma o valor diretamente no Bling.",
              extra: (
                <div>
                  <Label className="text-xs text-muted-foreground">Marketplace</Label>
                  <Select value={storeCodeMarketplace} onValueChange={(value) => setStoreCodeMarketplace(value as StoreCodeMarketplace)}>
                    <SelectTrigger className="w-full sm:w-[320px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kabum">Kabum — usar o SKU</SelectItem>
                      <SelectItem value="web_continental">Web Continental — usar o ID da loja</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ),
              run: async () => setStoreCodeDialogOpen(true),
              variant: "secondary",
            },
            { key: "fix", label: "Corrigir todos os erros auto-corrigíveis", desc: "Aplica todas as correções automáticas disponíveis no escopo selecionado.", run: () => onAutoFix(ids), variant: "secondary" },
            { key: "ai-title", label: "IA · Encurtar títulos (> 60 caracteres)", ai: true, desc: "Reescreve com IA títulos que passam de 60 caracteres, preservando marca, modelo e especificações.", run: () => onAiShortenTitles(ids) },
            { key: "ai-warranty", label: "IA · Remover Garantia / Anatel da descrição curta", ai: true, desc: "A IA remove menções a garantia e Anatel; a limpeza final é validada de forma determinística.", run: () => onAiRemoveWarranty(ids) },
            { key: "ai-expand", label: "IA · Expandir descrições curtas (< 150) com SEO", ai: true, desc: "A IA reescreve descrições curtas curtas demais mantendo informações do produto e enriquecendo com palavras-chave até no mínimo 150 caracteres.", run: () => onAiExpandShortDesc(ids) },
          ];
          const current = items.find((x) => x.key === selectedTransform) ?? items[0];
          const aiBlocked = !AI_FEATURES_ENABLED && !!current.ai;
          return (
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Transformação</Label>
                <Select value={selectedTransform} onValueChange={(v) => setSelectedTransform(v as Kind)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((x) => (
                      <SelectItem key={x.key} value={x.key} disabled={!AI_FEATURES_ENABLED && !!x.ai}>
                        {x.ai ? "🪄 " : ""}{x.label}{!AI_FEATURES_ENABLED && x.ai ? " (desativado)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className={`space-y-3 rounded-md border p-4 ${current.ai ? "bg-primary/5" : ""}`}>
                <p className="text-sm text-muted-foreground">{current.desc}</p>
                {aiBlocked && (
                  <p className="text-sm font-medium text-amber-600">{AI_DISABLED_MESSAGE}</p>
                )}
                {current.extra}
                <div>
                  <Button
                    variant={current.variant ?? "default"}
                    disabled={!companyId || !!busy || disabledScope || aiBlocked}
                    onClick={() => run(current.key, current.run)}
                  >
                    {busy === current.key ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Aplicar transformação
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}
        <LinkStoreCard
          companyId={companyId}
          ids={ids}
          disabledScope={disabledScope}
          busy={busy}
          setBusy={setBusy}
        />
        <BlingExistenceProgress companyId={companyId} />
        <AlertDialog open={existenceConfirm} onOpenChange={setExistenceConfirm}>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Verificar produtos no Bling?</AlertDialogTitle>
            <AlertDialogDescription>{existenceIds ? `${existenceIds.length} produtos selecionados` : "Todos os produtos desta empresa"} serão verificados. Os que o Bling confirmar como inexistentes serão excluídos definitivamente do Ajusta-Ê, junto dos vínculos locais. Nada será excluído no Bling. Falhas de conexão não causam exclusão.</AlertDialogDescription>
          </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Agora não</AlertDialogCancel>
            <AlertDialogAction onClick={() => run("verify-existence", async () => {
              if(!companyId) return;
              await startExistenceFn({data:{company_id:companyId,product_ids:existenceIds,confirm_delete:true}});
              await qc.invalidateQueries({queryKey:["bling-existence",companyId]});
              toast.success("Verificação iniciada. Acompanhe os produtos verificados e restantes abaixo.");
            })}>Verificar e remover os inexistentes</AlertDialogAction>
          </AlertDialogFooter></AlertDialogContent>
        </AlertDialog>
        <StoreCodeSheetCard companyId={companyId} />
        {companyId ? (
          <StoreCodeMarketplaceDialog
            open={storeCodeDialogOpen}
            onOpenChange={setStoreCodeDialogOpen}
            companyId={companyId}
            productIds={ids}
            marketplace={storeCodeMarketplace}
            onQueued={() => qc.invalidateQueries({ queryKey: ["bling-push-progress"] })}
          />
        ) : null}

      </CardContent>

    </Card>
  );
}

function LinkStoreCard({
  companyId,
  ids,
  disabledScope,
  busy,
  setBusy,
}: {
  companyId: string | undefined;
  ids: string[] | undefined;
  disabledScope: boolean;
  busy: string | null;
  setBusy: (v: any) => void;
}) {
  const qc = useQueryClient();
  const fetchStores = useServerFn(listDistinctStores);
  const fnLinkStore = useServerFn(enqueueBlingLinkStore);
  const [storeId, setStoreId] = useState<string>("");
  const stores = useQuery({
    queryKey: ["distinct-stores-transform", companyId],
    queryFn: () => fetchStores({ data: { company_id: companyId! } }),
    enabled: !!companyId,
  });

  async function run(action: "link" | "unlink") {
    if (!companyId || !storeId) return;
    const scoped = ids ?? [];
    if (scoped.length === 0) {
      toast.error("Selecione pelo menos um produto (ou mude o escopo para todos e selecione manualmente).");
      return;
    }
    setBusy(action === "link" ? "vincular-loja" : "desvincular-loja");
    try {
      const r = await fnLinkStore({
        data: { company_id: companyId, product_ids: scoped, bling_store_id: storeId, action },
      });
      if (action === "link") {
        toast.success(`${r.enqueued} produto(s) enfileirados para vincular. ${r.skipped ? `${r.skipped} ignorado(s) (sem preço calculável).` : ""}`);
      } else {
        toast.success(`${r.enqueued} produto(s) enfileirados para desvincular.`);
      }
      qc.invalidateQueries({ queryKey: ["bling-push-progress"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-4 bg-primary/5">
      <div className="font-medium">Vincular / Desvincular multiloja</div>
      <p className="text-xs text-muted-foreground">
        Vincular usa o preço da <strong>Política de Precificação</strong> com a comissão do marketplace configurado para a loja escolhida em Multilojas.
        O <strong>preço promocional</strong> é calculado como preço de venda − taxa promocional do fornecedor.
        A ação é enfileirada em <em>Sincronização Bling</em>.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[260px] flex-1">
          <div className="text-xs mb-1 text-muted-foreground">Loja no Bling</div>
          <Select value={storeId} onValueChange={setStoreId} disabled={!companyId || stores.isLoading}>
            <SelectTrigger><SelectValue placeholder="Selecione uma loja..." /></SelectTrigger>
            <SelectContent>
              {(stores.data ?? []).map((s: any) => (
                <SelectItem key={s.bling_store_id} value={s.bling_store_id}>
                  {s.store_name ?? s.bling_store_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          disabled={!companyId || !storeId || !!busy || disabledScope}
          onClick={() => run("link")}
        >
          {busy === "vincular-loja" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Vincular à loja
        </Button>
        <Button
          variant="outline"
          disabled={!companyId || !storeId || !!busy || disabledScope}
          onClick={() => run("unlink")}
        >
          {busy === "desvincular-loja" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Desvincular da loja
        </Button>
      </div>
    </div>
  );
}

type SupplierReport = {
  total: number; encontrados: number; nao_encontrados: number; sem_fornecedor: number;
  preco_atualizado: number; estoque_atualizado: number; preco_e_estoque_atualizados: number; inalterados: number;
  stores_updated?: number; no_default_marketplace?: boolean; estoque_via_ml?: number;
  items: Array<{
    sku: string; nome: string; fornecedor: string | null; status: string;
    preco_atual: number | null; preco_novo: number | null;
    estoque_atual: number | null; estoque_novo: number | null;
    estoque_origem?: "fornecedor" | "mercado_livre";
    preco_atual_venda?: number | null; preco_novo_venda?: number | null;
  }>;
};

function SupplierSyncReportDialog({ report, onClose }: { report: SupplierReport | null; onClose: () => void }) {
  if (!report) return null;
  const items = report.items ?? [];
  const badgeFor = (s: string) => {
    if (s === "nao_encontrado" || s === "sem_fornecedor") return <Badge variant="destructive">{s === "sem_fornecedor" ? "sem fornecedor" : "não encontrado"}</Badge>;
    if (s === "inalterado") return <Badge variant="secondary">inalterado</Badge>;
    return <Badge>{s.replaceAll("_", " ")}</Badge>;
  };
  function downloadCsv() {
    const header = ["sku","nome","fornecedor","status","preco_atual","preco_novo","estoque_atual","estoque_novo","estoque_origem","preco_atual_venda","preco_novo_venda"];
    const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const body = items.map((i) => header.map((h) => esc((i as any)[h])).join(",")).join("\n");
    downloadBlob(new Blob([header.join(",") + "\n" + body], { type: "text/csv;charset=utf-8" }), "sync-fornecedor.csv");
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Histórico da sincronização com fornecedor</DialogTitle>
          <DialogDescription>
            {report.total.toLocaleString("pt-BR")} produto(s) processado(s).
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Stat label="Encontrados" value={report.encontrados} />
          <Stat label="Não encontrados" value={report.nao_encontrados} tone="destructive" />
          <Stat label="Sem fornecedor" value={report.sem_fornecedor} tone="destructive" />
          <Stat label="Inalterados" value={report.inalterados} />
          <Stat label="Preço atualizado" value={report.preco_atualizado} />
          <Stat label="Estoque atualizado" value={report.estoque_atualizado} />
          <Stat label="Estoque pelo Mercado Livre (mín. 4)" value={report.estoque_via_ml ?? 0} />
          <Stat label="Preço + Estoque" value={report.preco_e_estoque_atualizados} />
          <Stat label="Multilojas atualizadas" value={report.stores_updated ?? 0} />
        </div>
        {report.no_default_marketplace ? (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
            Nenhuma loja marcada como padrão em Multilojas — o preço de venda não foi recalculado. Vincule um marketplace padrão para habilitar o cálculo.
          </div>
        ) : null}
        <div className="max-h-[50vh] overflow-auto rounded border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left">SKU</th>
                <th className="px-2 py-1 text-left">Nome</th>
                <th className="px-2 py-1 text-left">Fornecedor</th>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-right">Custo</th>
                <th className="px-2 py-1 text-right">Estoque</th>
                <th className="px-2 py-1 text-left">Origem do estoque</th>
                <th className="px-2 py-1 text-right">Preço venda</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 1000).map((i) => (
                <tr key={i.sku} className="border-t">
                  <td className="px-2 py-1 font-mono">{i.sku}</td>
                  <td className="px-2 py-1 truncate max-w-[280px]" title={i.nome}>{i.nome}</td>
                  <td className="px-2 py-1">{i.fornecedor ?? "—"}</td>
                  <td className="px-2 py-1">{badgeFor(i.status)}</td>
                  <td className="px-2 py-1 text-right">{i.preco_atual ?? "—"} → {i.preco_novo ?? "—"}</td>
                  <td className="px-2 py-1 text-right">{i.estoque_atual ?? "—"} → {i.estoque_novo ?? "—"}</td>
                  <td className="px-2 py-1">
                    {i.estoque_novo == null
                      ? "—"
                      : i.estoque_origem === "mercado_livre"
                        ? <Badge variant="secondary">Mercado Livre (mín. 4)</Badge>
                        : <Badge variant="outline">Fornecedor</Badge>}
                  </td>
                  <td className="px-2 py-1 text-right">{i.preco_atual_venda ?? "—"} → {i.preco_novo_venda ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length > 1000 && (
            <div className="p-2 text-xs text-muted-foreground">Mostrando 1.000 de {items.length.toLocaleString("pt-BR")}. Baixe o CSV para ver tudo.</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={downloadCsv}>Baixar CSV completo</Button>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "destructive" }) {
  return (
    <div className={`rounded border p-2 ${tone === "destructive" ? "border-destructive/40" : ""}`}>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold text-sm">{(value ?? 0).toLocaleString("pt-BR")}</div>
    </div>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
