import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, RefreshCw } from "lucide-react";
import { listMyCompanies } from "@/lib/companies.functions";
import { getActiveSyncLock } from "@/lib/sync-lock.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import { useEffect } from "react";

/** Balão flutuante indicando qual empresa está sendo alterada. */
export function SelectedCompanyBadge() {
  const fetchCompanies = useServerFn(listMyCompanies);
  const companies = useQuery({ queryKey: ["companies"], queryFn: () => fetchCompanies() });
  const [companyId, setCompanyId] = useSelectedCompany();
  useEffect(() => {
    if (companies.data?.length && !companies.data.some(company => company.id === companyId)) setCompanyId(companies.data[0].id);
  }, [companies.data, companyId, setCompanyId]);
  const fetchLock = useServerFn(getActiveSyncLock);
  const lock = useQuery({
    queryKey: ["sync-lock", companyId],
    queryFn: () => {
      if (!companyId) throw new Error('Selecione a empresa.');
      return fetchLock({ data: { company_id: companyId } });
    },
    enabled: !!companyId,
    refetchInterval: 6_000,
  });

  const company = companies.data?.find((c) => c.id === companyId);
  if (!company) return null;
  const active = lock.data;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {active ? (
        <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 shadow-lg backdrop-blur">
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-600" />
          <div className="leading-tight">
            <div className="text-[10px] uppercase tracking-wide text-amber-700">
              Sincronização em andamento
            </div>
            <div className="max-w-[240px] truncate text-sm font-medium">
              {active.label}
              {active.detail ? ` · ${active.detail}` : ""}
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-background/90 px-4 py-2 shadow-lg backdrop-blur">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
          <Building2 className="h-3.5 w-3.5 text-primary" />
        </span>
        <div className="leading-tight">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Empresa ativa
          </div>
          <div className="max-w-[200px] truncate text-sm font-medium">{company.nome}</div>
        </div>
      </div>
    </div>
  );
}

