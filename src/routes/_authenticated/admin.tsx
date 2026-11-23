import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldCheck, UserPlus, Trash2, KeyRound, Loader2 } from "lucide-react";

import {
  adminListUsers,
  adminCreateUser,
  adminUpdatePermissions,
  adminSetRole,
  adminResetPassword,
  adminDeleteUser,
  type AdminUser,
} from "@/lib/admin.functions";
import { useAccess } from "@/hooks/use-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminCdnSecurity } from "@/components/admin-cdn-security";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Painel de administração — Ajusta-Ê" },
      {
        name: "description",
        content: "Gerencie contas, permissões e prazos de acesso do sistema.",
      },
      { property: "og:title", content: "Painel de administração — Ajusta-Ê" },
      {
        property: "og:description",
        content: "Gerencie contas, permissões e prazos de acesso do sistema.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AdminPage() {
  const { access, isLoading: loadingAccess } = useAccess();
  const qc = useQueryClient();

  const fnList = useServerFn(adminListUsers);
  const fnCreate = useServerFn(adminCreateUser);
  const fnPerms = useServerFn(adminUpdatePermissions);
  const fnRole = useServerFn(adminSetRole);
  const fnPassword = useServerFn(adminResetPassword);
  const fnDelete = useServerFn(adminDeleteUser);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ nome: "", email: "", password: "", is_admin: false });
  const [pwdUser, setPwdUser] = useState<AdminUser | null>(null);
  const [newPwd, setNewPwd] = useState("");

  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => fnList({}),
    enabled: access.is_admin,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const createMut = useMutation({
    mutationFn: () => fnCreate({ data: form }),
    onSuccess: () => {
      toast.success("Usuário criado. As permissões nascem desativadas.");
      setCreateOpen(false);
      setForm({ nome: "", email: "", password: "", is_admin: false });
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao criar usuário"),
  });

  async function patch(user_id: string, patchData: Record<string, unknown>) {
    try {
      await fnPerms({ data: { user_id, ...patchData } });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar permissão");
    }
  }

  async function toggleAdmin(u: AdminUser, value: boolean) {
    try {
      await fnRole({ data: { user_id: u.id, is_admin: value } });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao alterar papel");
    }
  }

  async function handlePassword() {
    if (!pwdUser) return;
    try {
      await fnPassword({ data: { user_id: pwdUser.id, password: newPwd } });
      toast.success("Senha atualizada.");
      setPwdUser(null);
      setNewPwd("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao redefinir senha");
    }
  }

  async function handleDelete(u: AdminUser) {
    if (!confirm(`Excluir definitivamente ${u.email}?`)) return;
    try {
      await fnDelete({ data: { user_id: u.id } });
      toast.success("Usuário excluído.");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir usuário");
    }
  }

  if (loadingAccess) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (!access.is_admin) {
    return (
      <div className="p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Acesso restrito</CardTitle>
            <CardDescription>
              Somente administradores do sistema podem abrir este painel.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const rows = (users.data ?? []) as AdminUser[];

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Painel de administração</h1>
        </div>
        <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" /> Novo usuário
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Contas do sistema</CardTitle>
          <CardDescription>
            Novos usuários entram sem permissão de baixar planilhas, enviar ao Bling ou usar IA.
            Ative aqui e, se quiser, defina uma data de expiração do acesso.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {users.isLoading ? (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando usuários…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead className="text-center">Admin</TableHead>
                  <TableHead className="text-center">Ativo</TableHead>
                  <TableHead className="text-center">Planilhas</TableHead>
                  <TableHead className="text-center">Enviar ao Bling</TableHead>
                  <TableHead className="text-center">IA</TableHead>
                  <TableHead>Acesso até</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => {
                  const expired =
                    !!u.access_expires_at && new Date(u.access_expires_at).getTime() < Date.now();
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="font-medium">{u.nome || "—"}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                        <div className="mt-1 flex gap-1">
                          <Badge variant="outline" className="text-[10px]">
                            {u.companies} empresa(s)
                          </Badge>
                          {expired && (
                            <Badge variant="destructive" className="text-[10px]">
                              expirado
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={u.is_admin}
                          onCheckedChange={(v) => toggleAdmin(u, v)}
                          aria-label="Administrador"
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={u.active}
                          onCheckedChange={(v) => patch(u.id, { active: v })}
                          aria-label="Acesso ativo"
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={u.can_download_sheets}
                          onCheckedChange={(v) => patch(u.id, { can_download_sheets: v })}
                          aria-label="Baixar planilhas"
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={u.can_push_bling}
                          onCheckedChange={(v) => patch(u.id, { can_push_bling: v })}
                          aria-label="Enviar ao Bling"
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={u.can_use_ai}
                          onCheckedChange={(v) => patch(u.id, { can_use_ai: v })}
                          aria-label="Funções de IA"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="datetime-local"
                          className="h-8 w-[190px]"
                          value={toLocalInput(u.access_expires_at)}
                          onChange={(e) =>
                            patch(u.id, {
                              access_expires_at: e.target.value
                                ? new Date(e.target.value).toISOString()
                                : null,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setPwdUser(u);
                              setNewPwd("");
                            }}
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(u)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      Nenhum usuário encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AdminCdnSecurity />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo usuário</DialogTitle>
            <DialogDescription>
              O usuário é criado já confirmado, sem permissão de planilhas, Bling ou IA.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>E-mail</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Senha (mínimo 8 caracteres)</Label>
              <Input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_admin}
                onCheckedChange={(v) => setForm({ ...form, is_admin: v })}
                id="new-admin"
              />
              <Label htmlFor="new-admin">Criar como administrador</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !form.email || form.password.length < 8}
            >
              {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar usuário
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pwdUser} onOpenChange={(o) => !o && setPwdUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
            <DialogDescription>{pwdUser?.email}</DialogDescription>
          </DialogHeader>
          <Input
            type="text"
            placeholder="Nova senha"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdUser(null)}>
              Cancelar
            </Button>
            <Button onClick={handlePassword} disabled={newPwd.length < 8}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
