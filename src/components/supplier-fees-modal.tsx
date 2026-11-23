import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { updateSupplierFees } from "@/lib/suppliers.functions";

export type SupplierFees = {
  id: string;
  nome: string;
  preco_embalagem: number | string | null;
  preco_transporte: number | string | null;
  taxa_devolucao: number | string | null;
  taxa_promocao: number | string | null;
  stock_cap?: number | string | null;
};

const FIELDS: { key: keyof SupplierFees; label: string; suffix: "R$" | "%" }[] = [
  { key: "preco_embalagem", label: "Preço da embalagem", suffix: "R$" },
  { key: "preco_transporte", label: "Preço do transporte", suffix: "R$" },
  { key: "taxa_devolucao", label: "Taxa de devolução", suffix: "%" },
  { key: "taxa_promocao", label: "Promoção", suffix: "%" },
];

function toNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function SupplierFeesModal({
  supplier,
  open,
  onOpenChange,
}: {
  supplier: SupplierFees | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const fnSave = useServerFn(updateSupplierFees);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [stockCap, setStockCap] = useState<string>("");

  useEffect(() => {
    if (!supplier) return;
    const next: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = supplier[f.key];
      next[f.key as string] = v == null ? "" : String(v).replace(".", ",");
    }
    setForm(next);
    setStockCap(supplier.stock_cap == null ? "" : String(supplier.stock_cap));
  }, [supplier]);

  async function handleSave() {
    if (!supplier) return;
    setSaving(true);
    try {
      const capTrim = stockCap.trim();
      const capParsed = capTrim === "" ? null : Math.max(0, Math.floor(Number(capTrim.replace(",", "."))));
      await fnSave({
        data: {
          id: supplier.id,
          preco_embalagem: toNum(form.preco_embalagem),
          preco_transporte: toNum(form.preco_transporte),
          taxa_devolucao: toNum(form.taxa_devolucao),
          taxa_promocao: toNum(form.taxa_promocao),
          stock_cap: capParsed != null && Number.isFinite(capParsed) ? capParsed : null,
        },
      });
      toast.success("Taxas atualizadas.");
      await qc.invalidateQueries({ queryKey: ["suppliers"] });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar taxas");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Taxas e Configurações — {supplier?.nome ?? ""}</DialogTitle>
          <DialogDescription>
            Custos logísticos e taxas específicas deste fornecedor. As margens de lucro por faixa de preço
            agora são definidas em <strong>Precificação → Política de Precificação</strong>.
          </DialogDescription>
        </DialogHeader>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <div key={f.key as string}>
              <Label className="text-xs">{f.label} ({f.suffix})</Label>
              <Input
                inputMode="decimal"
                value={form[f.key as string] ?? ""}
                onChange={(e) => setForm({ ...form, [f.key as string]: e.target.value })}
              />
            </div>
          ))}
          <div className="md:col-span-2">
            <Label className="text-xs">Teto de estoque deste fornecedor (opcional)</Label>
            <Input
              inputMode="numeric"
              placeholder="Sem teto"
              value={stockCap}
              onChange={(e) => setStockCap(e.target.value.replace(/[^0-9]/g, ""))}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Limita o estoque enviado ao Bling nas transformações. Substitui o teto padrão da empresa; um teto por produto pode substituir este.
            </p>
          </div>
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
