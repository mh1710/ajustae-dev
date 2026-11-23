import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import logo from "@/assets/ajusta-e-logo-new.png.asset.json";
import { getCompanySession } from "@/lib/company-session";

const searchSchema = z.object({ mode: z.enum(["login", "signup"]).optional() });

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{"title": "Entrar | Ajusta-Ê"}, {"name": "description", "content": "Acesse sua conta Ajusta-Ê e os dados da sua empresa."}, {"property": "og:title", "content": "Entrar | Ajusta-Ê"}, {"property": "og:description", "content": "Acesse sua conta Ajusta-Ê e os dados da sua empresa."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }),
  validateSearch: (s) => searchSchema.parse(s),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();

  useEffect(() => {
    getCompanySession().then(session => {
      if (session) navigate({ to: session.restricted ? "/produtos" : "/dashboard", replace: true });
    });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <img src={logo.url} alt="Ajusta-Ê" className="mx-auto mb-2 h-28 w-auto object-contain" />
          <CardTitle className="sr-only">Ajusta-Ê</CardTitle>
          <CardDescription>
            Entre com sua conta para acessar o painel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm onSuccess={async () => {
            const session = await getCompanySession();
            navigate({ to: session?.restricted ? "/produtos" : "/dashboard", replace: true });
          }} />
          <div className="mt-6 text-center text-sm">
            <Link to="/forgot-password" className="text-muted-foreground hover:text-foreground">
              Esqueci minha senha
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handle(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Bem-vindo!");
    onSuccess();
  }

  return (
    <form onSubmit={handle} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="login-email">E-mail</Label>
        <Input id="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">Senha</Label>
        <Input id="login-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}
