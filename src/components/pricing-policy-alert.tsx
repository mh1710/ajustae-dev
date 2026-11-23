import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getPricingPolicyStatus } from "@/lib/pricing.functions";

export function usePricingPolicyStatus(companyId: string | undefined) {
  const fetchStatus = useServerFn(getPricingPolicyStatus);
  return useQuery({
    queryKey: ["pricing-policy-status", companyId],
    queryFn: () => fetchStatus({ data: { company_id: companyId! } }),
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

/**
 * Alerta exibido em qualquer fluxo que dependa da política de preços
 * (transformações de preço, vinculação em multilojas, sincronização com o Bling).
 */
export function PricingPolicyAlert({
  companyId,
  className,
}: {
  companyId: string | undefined;
  className?: string;
}) {
  const status = usePricingPolicyStatus(companyId);
  if (!companyId || status.isLoading || !status.data || status.data.ok) return null;

  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Política de preços incompleta — a precificação pode sair errada</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">
          {status.data.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        <p className="mt-2 text-sm">
          Defina a política de preços antes de precificar, vincular multilojas ou sincronizar com o Bling.
        </p>
        <Button asChild size="sm" variant="outline" className="mt-2">
          <Link to="/precificacao">Abrir Política de Precificação</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
