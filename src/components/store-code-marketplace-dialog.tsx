import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  applyMarketplaceStoreCode,
  previewMarketplaceStoreCode,
  type StoreCodeMarketplace,
  type StoreCodeMarketplacePreview,
} from "@/lib/bling-push.functions";

export function StoreCodeMarketplaceDialog({
  open,
  onOpenChange,
  companyId,
  productIds,
  marketplace,
  onQueued,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  productIds?: string[];
  marketplace: StoreCodeMarketplace;
  onQueued: () => void;
}) {
  const previewFn = useServerFn(previewMarketplaceStoreCode);
  const applyFn = useServerFn(applyMarketplaceStoreCode);
  const [preview, setPreview] = useState<StoreCodeMarketplacePreview | null>(null);
  const [updateMode, setUpdateMode] = useState<"new" | "all">("new");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const label = marketplace === "kabum" ? "Kabum" : "Web Continental";
  const rule = marketplace === "kabum" ? "SKU do produto" : "ID da própria loja";

  async function loadPreview() {
    setLoading(true);
    try {
      const result = await previewFn({ data: { company_id: companyId, product_ids: productIds, marketplace } });
      setUpdateMode("new");
      setPreview(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar a prévia.");
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    setApplying(true);
    try {
      const result = await applyFn({
        data: {
          company_id: companyId,
          product_ids: productIds,
          marketplace,
          force_existing: updateMode === "all",
        },
      });
      toast.success(
        `${result.enqueued.toLocaleString("pt-BR")} vínculo(s) enfileirado(s) para confirmação no Bling.` +
          (result.existing_enqueued
            ? ` ${result.existing_enqueued.toLocaleString("pt-BR")} já constavam como corretos na base.`
            : ""),
      );
      onQueued();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível iniciar a atualização.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPreview(null);
          setUpdateMode("new");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Atualizar ID na loja — {label}</DialogTitle>
          <DialogDescription>
            O ID na loja será definido pelo {rule}. Preço, estoque e outros campos não serão alterados.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="rounded-md border p-4 text-sm text-muted-foreground">
            Gere a prévia para conferir quantos vínculos serão alterados antes da confirmação.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Stat label="Vínculos encontrados" value={preview.total} />
              <Stat label="Serão atualizados" value={preview.to_update} />
              <Stat label="Já corretos" value={preview.already_correct} />
              <Stat label="Ignorados" value={preview.skipped} />
            </div>
            {preview.already_correct > 0 && (
              <RadioGroup
                value={updateMode}
                onValueChange={(value) => setUpdateMode(value as "new" | "all")}
                className="rounded-md border p-3"
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <RadioGroupItem value="new" className="mt-0.5" />
                  <span>
                    <span className="block font-medium">Atualizar apenas os novos</span>
                    <span className="text-xs text-muted-foreground">
                      Envia {preview.to_update.toLocaleString("pt-BR")} vínculo(s) que ainda estão diferentes.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <RadioGroupItem value="all" className="mt-0.5" />
                  <span>
                    <span className="block font-medium">Atualizar todos mesmo assim</span>
                    <span className="text-xs text-muted-foreground">
                      Reenvia também {preview.already_correct.toLocaleString("pt-BR")} vínculo(s) que já
                      constam como corretos na base.
                    </span>
                  </span>
                </label>
              </RadioGroup>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>Cancelar</Button>
          {!preview ? (
            <Button onClick={loadPreview} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Gerar prévia
            </Button>
          ) : (
            <Button
              onClick={confirm}
              disabled={
                applying ||
                (preview.to_update === 0 && (updateMode !== "all" || preview.already_correct === 0))
              }
            >
              {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar {(preview.to_update + (updateMode === "all" ? preview.already_correct : 0)).toLocaleString("pt-BR")} atualização(ões)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value.toLocaleString("pt-BR")}</div>
    </div>
  );
}