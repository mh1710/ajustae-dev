import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCompanyCatalogStatus } from "@/lib/mercadolivre.functions";

export function CompanyCatalogStatus({ companyId }: { companyId: string | undefined }) {
  const fetchStatus = useServerFn(getCompanyCatalogStatus);
  const status = useQuery({
    queryKey: ["company-catalog-status", companyId],
    queryFn: () => {
      if (!companyId) throw new Error("Selecione uma empresa.");
      return fetchStatus({ data: { company_id: companyId } });
    },
    enabled: !!companyId,
    refetchInterval: 6000,
  });
  return <section className="mt-6 grid max-w-2xl gap-4">
    {status.error && <p className="text-sm text-destructive">Não foi possível consultar as sincronizações.</p>}
    <Card>
      <CardHeader><CardTitle>Mercado Livre</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Badge variant="outline">{status.data?.ml.status ?? "Carregando..."}</Badge>
        {status.data?.mapping ? <div>Mapeamento: {status.data.mapping.status} · {status.data.mapping.processed} / {status.data.mapping.total} produtos</div> : <div className="text-muted-foreground">Nenhum mapeamento registrado para esta empresa.</div>}
        {status.data?.refresh.last_finished_at && <div className="text-muted-foreground">Última atualização do catálogo: {new Date(status.data.refresh.last_finished_at).toLocaleString("pt-BR")}</div>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Fornecedores no Bling</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {status.data?.supplier ? <>
          <Badge variant="outline">{status.data.supplier.status}</Badge>
          <div>{status.data.supplier.links_found} vínculos · {status.data.supplier.pages_done} páginas</div>
          {status.data.supplier.details_total > 0 && <div>{status.data.supplier.details_checked} / {status.data.supplier.details_total} produtos conferidos</div>}
          {status.data.supplier.last_error && <p className="text-destructive">{status.data.supplier.last_error}</p>}
        </> : <div className="text-muted-foreground">{status.isLoading ? "Carregando..." : "Nenhuma sincronização registrada."}</div>}
      </CardContent>
    </Card>
  </section>;
}