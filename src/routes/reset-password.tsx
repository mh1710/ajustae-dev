import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { changeMyPassword } from "@/lib/account-security.functions";
import { passwordPolicyIssues } from "@/lib/password-policy";
import { PasswordRequirements } from "@/components/login-security-steps";
import { clearSecurityState } from "@/lib/security-gate";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{"title": "Nova senha | Ajusta-Ê"}, {"name": "description", "content": "Defina uma nova senha para sua conta Ajusta-Ê."}, {"property": "og:title", "content": "Nova senha | Ajusta-Ê"}, {"property": "og:description", "content": "Defina uma nova senha para sua conta Ajusta-Ê."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }), component: ResetPassword });

function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const change = useServerFn(changeMyPassword);
  const valid = passwordPolicyIssues(password).length === 0 && password === confirmation;

  async function handle(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmation) return toast.error("As senhas não conferem.");
    setLoading(true);
    try {
      await change({ data: { new_password: password } });
      clearSecurityState();
      await supabase.auth.signOut({ scope: "local" });
      toast.success("Senha atualizada! Entre com a senha nova.");
      navigate({ to: "/auth", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a senha.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Definir nova senha</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handle} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pw">Nova senha</Label>
              <Input id="pw" type="password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
              <PasswordRequirements password={password} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw2">Repita a nova senha</Label>
              <Input id="pw2" type="password" required minLength={12} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading || !valid}>
              {loading ? "Salvando..." : "Salvar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
