import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Building2, Trash2, Pencil } from "lucide-react";
import { listMyCompanies, createCompany, deleteCompany, updateCompany } from "@/lib/companies.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/empresas")({
  head: () => ({ meta: [{"title": "Empresas | Ajusta-Ê"}, {"name": "description", "content": "Consulte e gerencie as empresas vinculadas à sua conta."}, {"property": "og:title", "content": "Empresas | Ajusta-Ê"}, {"property": "og:description", "content": "Consulte e gerencie as empresas vinculadas à sua conta."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }), component: EmpresasPage });

function EmpresasPage() {
  const fetchCompanies = useServerFn(listMyCompanies);
  const create = useServerFn(createCompany);
  const remove = useServerFn(deleteCompany);
  const update = useServerFn(updateCompany);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["companies"], queryFn: () => fetchCompanies() });

  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [nomeFantasia, setNomeFantasia] = useState("");
  const [cnpj, setCnpj] = useState("");

  const [editing, setEditing] = useState<{ id: string; nome: string; nome_fantasia: string; cnpj: string } | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      create({ data: { nome, nome_fantasia: nomeFantasia || null, cnpj: cnpj || null } }),
    onSuccess: () => {
      toast.success("Empresa criada!");
      qc.invalidateQueries({ queryKey: ["companies"] });
      setOpen(false);
      setNome(""); setNomeFantasia(""); setCnpj("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (companyId: string) => remove({ data: { company_id: companyId } }),
    onSuccess: () => {
      toast.success("Empresa excluída.");
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      update({
        data: {
          company_id: editing!.id,
          nome: editing!.nome,
          nome_fantasia: editing!.nome_fantasia || null,
          cnpj: editing!.cnpj || null,
        },
      }),
    onSuccess: () => {
      toast.success("Empresa atualizada.");
      qc.invalidateQueries({ queryKey: ["companies"] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Empresas</h1>
          <p className="mt-1 text-sm text-muted-foreground">Gerencie as empresas da sua conta.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Nova empresa</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova empresa</DialogTitle></DialogHeader>
            <form
              onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="nome">Razão social *</Label>
                <Input id="nome" required value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nf">Nome fantasia</Label>
                <Input id="nf" value={nomeFantasia} onChange={(e) => setNomeFantasia(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cnpj">CNPJ</Label>
                <Input id="cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? "Criando..." : "Criar"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Carregando...</p>
      ) : data && data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base">{c.nome}</CardTitle>
                  <Badge variant="secondary">{c.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <div className="space-y-1">
                  {c.nome_fantasia && <div>{c.nome_fantasia}</div>}
                  {c.cnpj && <div>CNPJ: {c.cnpj}</div>}
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={deleteMutation.isPending}>
                      <Trash2 className="mr-2 h-4 w-4" /> Excluir empresa
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Excluir empresa?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta ação remove a empresa, a integração Bling, sincronizações e produtos vinculados a ela.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteMutation.mutate(c.id)}>
                        Excluir
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-2"
                  onClick={() =>
                    setEditing({ id: c.id, nome: c.nome, nome_fantasia: c.nome_fantasia ?? "", cnpj: c.cnpj ?? "" })
                  }
                >
                  <Pencil className="mr-2 h-4 w-4" /> Editar
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-lg font-medium">Nenhuma empresa cadastrada</p>
            <p className="mt-1 text-sm text-muted-foreground">Crie sua primeira empresa para começar.</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar empresa</DialogTitle></DialogHeader>
          {editing && (
            <form
              onSubmit={(e) => { e.preventDefault(); editMutation.mutate(); }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="e-nome">Razão social *</Label>
                <Input id="e-nome" required value={editing.nome} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-nf">Nome fantasia</Label>
                <Input id="e-nf" value={editing.nome_fantasia} onChange={(e) => setEditing({ ...editing, nome_fantasia: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-cnpj">CNPJ</Label>
                <Input id="e-cnpj" value={editing.cnpj} onChange={(e) => setEditing({ ...editing, cnpj: e.target.value })} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={editMutation.isPending}>
                  {editMutation.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}