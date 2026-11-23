import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import logo from "@/assets/ajusta-e-logo-new.png.asset.json";
import { getCompanySession } from "@/lib/company-session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ajusta-Ê | Catálogo de produtos" },
      { name: "description", content: "Organize e padronize os produtos das suas empresas para vender nos marketplaces." },
      { property: "og:title", content: "Ajusta-Ê | Catálogo de produtos" },
      { property: "og:description", content: "Organize e padronize os produtos das suas empresas para vender nos marketplaces." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  useEffect(() => {
    getCompanySession().then(session => {
      if (session) navigate({ to: session.restricted ? "/produtos" : "/dashboard", replace: true });
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <img src={logo.url} alt="Ajusta-Ê" className="h-20 w-auto object-contain" />
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link to="/auth">Entrar</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-foreground md:text-6xl">
          Seu catálogo{" "}
          <span className="bg-gradient-to-r from-[#00b894] to-[#42d1b2] bg-clip-text text-transparent">pronto para vender.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Ajusta-Ê organiza, corrige e padroniza os cadastros de produtos do seu ERP de acordo com as regras dos principais marketplaces.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/auth">Entrar</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}