import { createFileRoute } from "@tanstack/react-router";
import { StockAutomationCard } from "@/components/automations/StockAutomationCard";
import { StockDepositsCard } from "@/components/automations/StockDepositsCard";

export const Route = createFileRoute("/_authenticated/automacoes")({
  component: AutomacoesPage,
  head: () => ({
    meta: [
      { title: "Automações | Ajusta-Ê" },
      { name: "description", content: "Programe a automação de estoque para várias empresas e acompanhe o progresso de cada uma." },
      { property: "og:title", content: "Automações | Ajusta-Ê" },
      { property: "og:description", content: "Automação de estoque multiempresa com acompanhamento de progresso em tempo real." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function AutomacoesPage() {
  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Automações</h1>
        <p className="text-muted-foreground">
          Programe a atualização de estoque das empresas e acompanhe o andamento de cada uma.
        </p>
      </div>

      <StockAutomationCard />

      <StockDepositsCard />
    </div>
  );
}
