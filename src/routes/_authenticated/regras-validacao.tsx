import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { useAccess } from "@/hooks/use-access";
import {
  listValidationRules,
  toggleValidationRule,
  upsertValidationRule,
  deleteValidationRule,
} from "@/lib/audit.functions";

export const Route = createFileRoute("/_authenticated/regras-validacao")({
  head: () => ({ meta: [{"title": "Regras de validação | Ajusta-Ê"}, {"name": "description", "content": "Consulte as regras de qualidade e padronização do catálogo."}, {"property": "og:title", "content": "Regras de validação | Ajusta-Ê"}, {"property": "og:description", "content": "Consulte as regras de qualidade e padronização do catálogo."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }), component: RegrasPage });

type RuleForm = {
  id?: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  severity: "error" | "warning";
  active: boolean;
  config: Record<string, unknown>;
};

const EMPTY: RuleForm = {
  slug: "",
  name: "",
  description: "",
  category: "conteudo",
  severity: "error",
  active: true,
  config: {},
};

function RegrasPage() {
  const { access } = useAccess();
  const readOnly = access.company_restricted;
  const qc = useQueryClient();
  const fetchRules = useServerFn(listValidationRules);
  const doToggle = useServerFn(toggleValidationRule);
  const doUpsert = useServerFn(upsertValidationRule);
  const doDelete = useServerFn(deleteValidationRule);

  const rules = useQuery({
    queryKey: ["validation-rules"],
    queryFn: () => fetchRules({ data: {} }),
  });

  const [editing, setEditing] = useState<RuleForm | null>(null);
  const [configText, setConfigText] = useState("{}");

  function openNew() {
    setEditing({ ...EMPTY });
    setConfigText("{}");
  }
  function openEdit(r: any) {
    setEditing({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description ?? "",
      category: r.category,
      severity: r.severity,
      active: r.active,
      config: r.config ?? {},
    });
    setConfigText(JSON.stringify(r.config ?? {}, null, 2));
  }

  async function handleToggle(id: string, active: boolean) {
    await doToggle({ data: { id, active } });
    qc.invalidateQueries({ queryKey: ["validation-rules"] });
  }

  async function handleSave() {
    if (!editing) return;
    let cfg: Record<string, unknown> = {};
    try {
      cfg = configText.trim() ? JSON.parse(configText) : {};
    } catch {
      toast.error("Config JSON inválido.");
      return;
    }
    try {
      await doUpsert({
        data: {
          id: editing.id,
          slug: editing.slug.trim(),
          name: editing.name.trim(),
          description: editing.description || null,
          category: editing.category,
          severity: editing.severity,
          active: editing.active,
          config: cfg,
        },
      });
      toast.success("Regra salva.");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["validation-rules"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Excluir a regra "${name}"?`)) return;
    try {
      await doDelete({ data: { id } });
      toast.success("Regra excluída.");
      qc.invalidateQueries({ queryKey: ["validation-rules"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Regras de validação</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Regras globais aplicadas às auditorias de todas as empresas.
          </p>
        </div>
        {!readOnly && <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" /> Nova regra
        </Button>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Regras cadastradas</CardTitle>
          {!readOnly && <CardDescription>Ative/desative, ajuste limites ou exclua regras.</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase">
                <tr>
                  <th className="px-3 py-2">Ativo</th>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Categoria</th>
                  <th className="px-3 py-2">Severidade</th>
                  <th className="px-3 py-2">Configuração</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rules.data?.map((r: any) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2">
                      <Switch disabled={readOnly} checked={r.active} onCheckedChange={(v) => handleToggle(r.id, v)} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.description ?? r.slug}</div>
                    </td>
                    <td className="px-3 py-2"><Badge variant="secondary">{r.category}</Badge></td>
                    <td className="px-3 py-2">
                      <Badge variant={r.severity === "error" ? "destructive" : "secondary"}>{r.severity}</Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{JSON.stringify(r.config ?? {})}</td>
                    <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                      {!readOnly && <>
                      <Button size="sm" variant="outline" onClick={() => openEdit(r)}>Editar</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(r.id, r.name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      </>}
                    </td>
                  </tr>
                ))}
                {rules.data && rules.data.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Nenhuma regra cadastrada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Editar regra" : "Nova regra"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>Slug (identificador)</Label>
                <Input
                  value={editing.slug}
                  disabled={!!editing.id}
                  onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                  placeholder="ex.: minha-regra-custom"
                />
              </div>
              <div>
                <Label>Nome</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <Label>Descrição</Label>
                <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Categoria</Label>
                  <Select value={editing.category} onValueChange={(v) => setEditing({ ...editing, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="conteudo">conteudo</SelectItem>
                      <SelectItem value="imagens">imagens</SelectItem>
                      <SelectItem value="fiscal">fiscal</SelectItem>
                      <SelectItem value="outros">outros</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Severidade</Label>
                  <Select value={editing.severity} onValueChange={(v: "error" | "warning") => setEditing({ ...editing, severity: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="error">error</SelectItem>
                      <SelectItem value="warning">warning</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Ativa</Label>
                  <div className="pt-2"><Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /></div>
                </div>
              </div>
              <div>
                <Label>Config (JSON)</Label>
                <Input value={configText} onChange={(e) => setConfigText(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">Ex.: {"{\"min\": 150}"} ou {"{\"max\": 60}"}</p>
              </div>
              {!editing.id && (
                <p className="text-xs text-muted-foreground">
                  Nota: regras customizadas ficam disponíveis para cadastro, mas a avaliação automática depende de suporte no motor de auditoria para o slug informado.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={handleSave}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
