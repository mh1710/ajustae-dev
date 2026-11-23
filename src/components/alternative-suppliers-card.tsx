import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Barcode, ShoppingCart } from "lucide-react";
import { getAlternativeSuppliers, type AlternativeSupplierRow } from "@/lib/suppliers.functions";
import { fmtBRL } from "@/lib/pricing/cost";
import { getMlSupplierQuote, refreshMlSupplierQuote } from "@/lib/mercadolivre.functions";
import { useAccess } from "@/hooks/use-access";

export function AlternativeSuppliersCard({
  sku,
  ean,
  nome,
  productId,
  precoVenda,
}: {
  sku: string | null | undefined;
  ean: string | null | undefined;
  nome?: string | null;
  productId?: string | null;
  precoVenda?: number | null;
}) {
  const fn = useServerFn(getAlternativeSuppliers);
  const q = useQuery({
    queryKey: ["alt-suppliers", sku ?? "", ean ?? ""],
    queryFn: () => fn({ data: { sku: sku ?? null, ean: ean ?? null } }),
    enabled: !!(sku || ean),
  });

  return (
    <div className="rounded-md border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold">Fornecedores alternativos</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Barcode className="h-3 w-3" />
            {q.data?.ean ? `Consulta pelo EAN ${q.data.ean}` : "Produto sem EAN — só o fornecedor principal pode ser localizado pelo SKU."}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {q.isLoading && <div className="text-sm text-muted-foreground">Consultando fornecedores…</div>}
      {q.error && <div className="text-sm text-destructive">{(q.error as Error).message}</div>}

      {q.data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {q.data.rows.map((r, i) => <SupplierTile key={r.fornecedor_id} row={r} index={i + 1} precoVenda={precoVenda} />)}
        </div>
      )}

      <MercadoLivreTile productId={productId} sku={sku} ean={ean} precoVenda={precoVenda} />
    </div>
  );
}

function marginPct(custo: number | null | undefined, precoVenda?: number | null): number | null {
  if (custo == null || precoVenda == null || custo <= 0 || precoVenda <= 0) return null;
  return Math.round(((precoVenda - custo) / precoVenda) * 1000) / 10;
}

function MarginRow({ custo, precoVenda }: { custo: number | null | undefined; precoVenda?: number | null }) {
  const m = marginPct(custo, precoVenda);
  if (m == null) return null;
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">Margem</span>
      <Badge variant={m > 0 ? "secondary" : "destructive"}>{m.toFixed(1)}%</Badge>
    </div>
  );
}

function MercadoLivreTile({
  productId,
  sku,
  ean,
  precoVenda,
}: {
  productId?: string | null;
  sku: string | null | undefined;
  ean: string | null | undefined;
  precoVenda?: number | null;
}) {
  const { access } = useAccess();
  const fn = useServerFn(getMlSupplierQuote);
  const refreshFn = useServerFn(refreshMlSupplierQuote);
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const queryKey = ["ml-supplier-quote", productId ?? "", sku ?? "", ean ?? ""];
  const q = useQuery({
    queryKey,
    queryFn: () => fn({ data: { product_id: productId ?? null, sku: sku ?? null, ean: ean ?? null } }),
    enabled: !!(productId || sku || ean),
    staleTime: 5 * 60 * 1000,
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const fresh = await refreshFn({
        data: { product_id: productId ?? null, sku: sku ?? null, ean: ean ?? null },
      });
      qc.setQueryData(queryKey, fresh);
    } catch {
      await q.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium flex items-center gap-2">
          <ShoppingCart className="h-4 w-4" /> Mercado Livre
          {q.data?.zip && <Badge variant="outline">CEP {q.data.zip}</Badge>}
        </div>
        {!access.company_restricted && <Button
          size="sm"
          variant="ghost"
          title="Atualizar preços direto no Mercado Livre"
          onClick={handleRefresh}
          disabled={q.isFetching || refreshing}
        >
          {q.isFetching || refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>}
      </div>

      {q.isLoading && <div className="text-sm text-muted-foreground">Carregando dados do mapeamento…</div>}
      {q.data?.error && <div className="text-sm text-muted-foreground">{q.data.error}</div>}

      {q.data && !q.data.mapped && (
        <div className="text-sm text-muted-foreground">
          Este produto ainda não foi mapeado no Mercado Livre.
        </div>
      )}

      {q.data && q.data.mapped && q.data.offers.length === 0 && (
        <div className="text-sm text-muted-foreground">
          Nenhum anúncio Full com estoque no último mapeamento.
        </div>
      )}

      {q.data && q.data.offers.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {q.data.offers.slice(0, 3).map((o, i) => (
              <a
                key={o.item_id}
                href={o.permalink ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border p-3 text-sm hover:bg-muted/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">Mercado Livre {i + 1}</div>
                  {i === 0 && <Badge variant="default">Mais barato</Badge>}
                </div>
                <div className="mt-2 space-y-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">Preço total</span>
                    <span className="font-semibold">{fmtBRL(o.total_price)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Estoque</span>
                    <Badge variant="secondary">{o.available_quantity}</Badge>
                  </div>
                  <MarginRow custo={o.total_price} precoVenda={precoVenda} />
                  <div className="text-[11px] text-muted-foreground">
                    {fmtBRL(o.price)} + frete {o.shipping_cost > 0 ? fmtBRL(o.shipping_cost) : "grátis"} · Full
                  </div>
                </div>
              </a>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {q.data.match_by ? `Localizado por ${q.data.match_by === "ean" ? "EAN" : "título"}. ` : ""}
            {q.data.checked_at ? `Mapeado em ${new Date(q.data.checked_at).toLocaleString("pt-BR")}.` : ""}
          </div>
        </div>
      )}
    </div>
  );
}


function SupplierTile({ row, index, precoVenda }: { row: AlternativeSupplierRow; index: number; precoVenda?: number | null }) {
  const stock = row.qt_estoque;
  const stockVariant = stock == null ? "outline" : stock > 0 ? "secondary" : "destructive";
  return (
    <div className={`rounded-md border p-3 text-sm ${row.found ? "" : "opacity-60"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">Fornecedor {index}: {row.fornecedor_nome}</div>
        {row.primary && <Badge variant="secondary">Cadastrado</Badge>}
      </div>
      {row.found ? (
        <div className="mt-2 space-y-1">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Preço</span>
            <span className="font-semibold">{row.preco != null ? fmtBRL(row.preco) : "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Estoque</span>
            <Badge variant={stockVariant}>{stock != null ? stock : (row.estoque ?? "—")}</Badge>
          </div>
          <MarginRow custo={row.preco} precoVenda={precoVenda} />
          <div className="text-xs text-muted-foreground truncate" title={row.titulo ?? ""}>
            Cód. {row.codigo}{row.marca ? ` · ${row.marca}` : ""}
          </div>
          {row.titulo && <div className="text-xs truncate" title={row.titulo}>{row.titulo}</div>}
          {row.matched_by === "codigo" && (
            <div className="text-[11px] text-muted-foreground">Localizado pelo código do SKU (EAN não bateu).</div>
          )}
        </div>
      ) : (
        <div className="mt-2 text-xs text-muted-foreground">
          {row.last_sync_at ? "Não encontrado na base deste fornecedor." : "Base do fornecedor ainda não sincronizada."}
        </div>
      )}
    </div>
  );
}
