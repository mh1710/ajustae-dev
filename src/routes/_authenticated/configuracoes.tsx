import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { useServerFn } from "@tanstack/react-start";
import { changeMyPassword } from "@/lib/account-security.functions";
import { passwordPolicyIssues } from "@/lib/password-policy";
import { PasswordRequirements } from "@/components/login-security-steps";
import { signInAfterPasswordChange } from "@/lib/security-gate";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({ meta: [{"title": "Configurações | Ajusta-Ê"}, {"name": "description", "content": "Gerencie as configurações da sua conta Ajusta-Ê."}, {"property": "og:title", "content": "Configurações | Ajusta-Ê"}, {"property": "og:description", "content": "Gerencie as configurações da sua conta Ajusta-Ê."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  const { user } = Route.useRouteContext();
  const { access, isLoading: accessLoading } = useAccess();
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const changePasswordFn = useServerFn(changeMyPassword);

  useEffect(() => {
    if (accessLoading || access.company_restricted) return;
    supabase
      .from("profiles")
      .select("nome, telefone")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setNome(data.nome ?? "");
          setTelefone(data.telefone ?? "");
        }
      });
  }, [user.id, accessLoading, access.company_restricted]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (accessLoading || access.company_restricted) return;
    setLoading(true);
    const { error } = await supabase
      .from("profiles")
      .update({ nome, telefone })
      .eq("id", user.id);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Perfil atualizado!");
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmation) return toast.error("As novas senhas não conferem.");
    const issues = passwordPolicyIssues(password);
    if (issues.length) return toast.error(`A senha precisa ter ${issues.join(", ")}.`);
    if (password === currentPassword) return toast.error("Escolha uma senha diferente da atual.");
    setChangingPassword(true);
    try {
      const result = await changePasswordFn({ data: { new_password: password, current_password: currentPassword } });
      // A troca encerra as sessões abertas; entramos de novo com a senha nova.
      await signInAfterPasswordChange(result.email, password);
      setCurrentPassword("");
      setPassword("");
      setConfirmation("");
      toast.success("Senha alterada com sucesso!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar a senha. Tente novamente.");
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
      </div>

      {!accessLoading && !access.company_restricted && <Card className="mb-6 max-w-xl">
        <CardHeader>
          <CardTitle>Meu perfil</CardTitle>
          <CardDescription>Atualize suas informações.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input value={user.email ?? ""} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tel">Telefone</Label>
              <Input id="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? "Salvando..." : "Salvar"}
            </Button>
          </form>
        </CardContent>
      </Card>}
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Alterar senha</CardTitle>
          <CardDescription>A senha vale por 365 dias; depois disso o sistema pede uma nova ao entrar.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Senha atual</Label>
              <Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required disabled={changingPassword} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Nova senha</Label>
              <Input id="new-password" type="password" autoComplete="new-password" minLength={12} value={password} onChange={e => setPassword(e.target.value)} required disabled={changingPassword} />
              <PasswordRequirements password={password} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirmar nova senha</Label>
              <Input id="confirm-password" type="password" autoComplete="new-password" minLength={12} value={confirmation} onChange={e => setConfirmation(e.target.value)} required disabled={changingPassword} />
            </div>
            <Button type="submit" disabled={changingPassword}>
              {changingPassword ? "Alterando..." : "Alterar senha"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}