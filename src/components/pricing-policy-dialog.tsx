import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Percent } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getPricingSettings } from "@/lib/pricing.functions";
import { listMarketplaces } from "@/lib/marketplaces.functions";

function brl(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/** Mostra a política de precificação vigente e pede confirmação antes de aplicar/enviar preços. */
export function PricingPolicyDialog({
  open,
  onOpenChange,
  companyId,
  title,
  description,
  confirmLabel,
  onConfirm,
  confirming,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string | undefined;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  confirming?: boolean;
}) {
  const fetchSettings = useServerFn(getPricingSettings);
  const fetchMarketplaces = useServerFn(listMarketplaces);
  const settings = useQuery({
    queryKey: ["pricing-settings", companyId],
    queryFn: () => fetchSettings({ data: { company_id: companyId! } }),
    enabled: !!companyId && open,
  });
  const marketplaces = useQuery({
    queryKey: ["marketplaces", companyId],
    queryFn: () => companyId ? fetchMarketplaces({ data: { company_id: companyId } }) : Promise.resolve([]),
    enabled: open && !!companyId,
  });

  const s = settings.data;
  const defaultMk = marketplaces.data?.find((m) => m.id === s?.default_marketplace_id) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" /> {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {settings.isLoading || !s ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando política…
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <Item label="Embalagem padrão" value={brl(s.embalagem_default)} />
              <Item label="Transporte padrão" value={brl(s.transporte_default)} />
              <Item label="Taxa operacional" value={brl(s.taxa_operacional_valor)} />
              <Item label="Aplicar taxa se custo ≥" value={brl(s.taxa_operacional_min_custo)} />
              <Item label="Frete médio" value={pct(s.frete_medio_percent)} />
              <Item label="Custo fixo" value={pct(s.custo_fixo_percent)} />
              <Item label="Marketplace padrão (comissão)" value={defaultMk ? `${defaultMk.nome} · ${pct(defaultMk.taxa_percent)}` : "— não definido"} />
              <Item label="Teto de estoque padrão" value={s.stock_cap_default == null ? "sem teto" : String(s.stock_cap_default)} />
            </div>

            <div>
              <div className="mb-1 font-medium">Faixas de lucro</div>
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1 text-left">De</th>
                      <th className="px-2 py-1 text-left">Até</th>
                      <th className="px-2 py-1 text-right">Margem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.profit_bands.length === 0 ? (
                      <tr><td className="px-2 py-2 text-muted-foreground" colSpan={3}>Nenhuma faixa definida.</td></tr>
                    ) : s.profit_bands.map((b, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1">{brl(b.min)}</td>
                        <td className="px-2 py-1">{b.max == null ? "∞" : brl(b.max)}</td>
                        <td className="px-2 py-1 text-right font-mono">{pct(b.margin_percent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {s.price_anchors.length > 0 && (
              <div>
                <div className="mb-1 font-medium">Âncoras de preço</div>
                <ul className="list-disc space-y-0.5 pl-5 text-xs">
                  {s.price_anchors.map((a, i) => (
                    <li key={i}>
                      Entre {brl(a.min)} e {brl(a.max)} → preço fixo {brl(a.price)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Fórmula: custo completo ÷ (1 − margem − comissão − devolução − promoção), com âncoras aplicadas ao final.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onConfirm} disabled={!!confirming || settings.isLoading}>
            {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded border px-3 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}
