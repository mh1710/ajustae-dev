import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import logo from "@/assets/ajusta-e-logo-new.png.asset.json";
import { LoginCodeStep, NewPasswordStep } from "@/components/login-security-steps";
import type { SecurityState } from "@/lib/account-security.functions";
import { clearSecurityState, fetchSecurityState, rememberSecurityState } from "@/lib/security-gate";

const searchSchema = z.object({ mode: z.enum(["login", "signup"]).optional() });

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{"title": "Entrar | Ajusta-Ê"}, {"name": "description", "content": "Acesse sua conta Ajusta-Ê e os dados da sua empresa."}, {"property": "og:title", "content": "Entrar | Ajusta-Ê"}, {"property": "og:description", "content": "Acesse sua conta Ajusta-Ê e os dados da sua empresa."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }),
  validateSearch: (s) => searchSchema.parse(s),
  component: AuthPage,
});

type Step = "loading" | "login" | "code" | "password";

const DESCRIPTIONS: Record<Step, string> = {
  loading: "Conferindo seu acesso…",
  login: "Entre com sua conta para acessar o painel.",
  code: "Confirme que é você com o código enviado por e-mail.",
  password: "Defina uma senha nova para continuar.",
};

function AuthPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("loading");
  const [state, setState] = useState<SecurityState | null>(null);
  const [loginPassword, setLoginPassword] = useState<string | undefined>();

  const proceed = useCallback((next: SecurityState) => {
    setState(next);
    if (next.ok) {
      rememberSecurityState(next);
      setLoginPassword(undefined);
      navigate({ to: next.restricted ? "/produtos" : "/dashboard", replace: true });
      return;
    }
    setStep(next.mfa_verified ? "password" : "code");
  }, [navigate]);

  const check = useCallback(async () => {
    try {
      const next = await fetchSecurityState(true);
      if (!next) return setStep("login");
      proceed(next);
    } catch {
      setStep("login");
    }
  }, [proceed]);

  useEffect(() => { void check(); }, [check]);

  async function signOut() {
    clearSecurityState();
    setLoginPassword(undefined);
    await supabase.auth.signOut({ scope: "local" });
    setState(null);
    setStep("login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <img src={logo.url} alt="Ajusta-Ê" className="mx-auto mb-2 h-28 w-auto object-contain" />
          <CardTitle className="sr-only">Ajusta-Ê</CardTitle>
          <CardDescription>{DESCRIPTIONS[step]}</CardDescription>
        </CardHeader>
        <CardContent>
          {step === "loading" && (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {step === "login" && (
            <>
              <LoginForm onSuccess={async (password) => {
                setLoginPassword(password);
                await check();
              }} />
              <div className="mt-6 text-center text-sm">
                <Link to="/forgot-password" className="text-muted-foreground hover:text-foreground">
                  Esqueci minha senha
                </Link>
              </div>
            </>
          )}
          {step === "code" && state && <LoginCodeStep state={state} onVerified={proceed} onCancel={signOut} />}
          {step === "password" && (
            <NewPasswordStep
              currentPassword={loginPassword}
              reason="Por segurança, a senha precisa ter pelo menos 12 caracteres com letra, número e caractere especial, e é trocada uma vez por ano. Escolha uma senha nova para esta conta."
              onDone={proceed}
              onCancel={signOut}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LoginForm({ onSuccess }: { onSuccess: (password: string) => void | Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handle(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    clearSecurityState();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      return toast.error(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
    }
    await onSuccess(password);
    setLoading(false);
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
