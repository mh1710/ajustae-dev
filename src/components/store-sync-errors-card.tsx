import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { listStoreSyncPageErrors, retryStoreSyncPage } from "@/lib/bling-stores.functions";

export function StoreSyncErrorsCard({ companyId }: { companyId: string | null }) {
  const fetchErrors = useServerFn(listStoreSyncPageErrors);
  const doRetry = useServerFn(retryStoreSyncPage);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);

  const errors = useQuery({
    queryKey: ["store-sync-page-errors", companyId],
    queryFn: () => fetchErrors({ data: { company_id: companyId!, include_resolved: false } }),
    enabled: !!companyId,
    refetchInterval: 15000,
  });

  const rows = errors.data ?? [];

  async function retryOne(id: string) {
    if (!companyId) return;
    setRetrying(id);
    try {
      const r = await doRetry({ data: { company_id: companyId, error_id: id } });
      if (r.ok) toast.success(`Página ${r.page} reprocessada · ${r.saved} vínculo(s) salvos.`);
      else toast.error(`Página ${r.page}: ${r.error ?? "falhou novamente."}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao reprocessar.");
    } finally {
      setRetrying(null);
      await errors.refetch();
    }
  }

  async function retryAll() {
    if (!companyId) return;
    setRetryingAll(true);
    let ok = 0;
    let fail = 0;
    try {
      for (const r of rows) {
        try {
          const res = await doRetry({ data: { company_id: companyId, error_id: r.id } });
          if (res.ok) ok++; else fail++;
        } catch { fail++; }
      }
      toast[fail ? "warning" : "success"](`${ok} página(s) reprocessada(s)${fail ? `, ${fail} ainda com erro.` : "."}`);
    } finally {
      setRetryingAll(false);
      await errors.refetch();
    }
  }

  if (!companyId) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          {rows.length > 0
            ? <AlertTriangle className="h-4 w-4 text-destructive" />
            : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          Páginas com erro na sincronização
          {rows.length > 0 && <Badge variant="destructive">{rows.length}</Badge>}
        </CardTitle>
        {rows.length > 0 && (
          <Button size="sm" onClick={retryAll} disabled={retryingAll || !!retrying}>
            {retryingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Reprocessar todas
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {errors.isLoading ? (
          <div className="text-xs text-muted-foreground">Carregando...</div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma página pendente — a sincronização está completa, sem falhas em aberto.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Estas páginas falharam e foram puladas para não travar a sincronização. Reprocesse uma a uma
              (ou todas) até a lista ficar vazia.
            </p>
            <div className="divide-y rounded-md border">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 p-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">
                      Página {r.page}
                      {r.http_status ? <span className="text-muted-foreground"> · HTTP {r.http_status}</span> : null}
                      {r.attempts > 1 ? <span className="text-muted-foreground"> · {r.attempts} tentativas</span> : null}
                    </div>
                    <div className="truncate text-xs text-destructive">{r.error_message ?? "Erro desconhecido."}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => retryOne(r.id)}
                    disabled={retrying === r.id || retryingAll}
                  >
                    {retrying === r.id
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <RefreshCw className="mr-2 h-4 w-4" />}
                    Reprocessar
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
