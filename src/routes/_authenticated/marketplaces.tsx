import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Plus, Store, Pencil, Trash2 } from "lucide-react";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import {
  listMarketplaces,
  upsertMarketplace,
  deleteMarketplace,
  type Marketplace,
} from "@/lib/marketplaces.functions";

export const Route = createFileRoute("/_authenticated/marketplaces")({
  head: () => ({
    meta: [
      { title: "Marketplaces — Ajusta-Ê" },
      { name: "description", content: "Cadastro de marketplaces e suas taxas de comissão." },
      {"property": "og:title", "content": "Marketplaces — Ajusta-Ê"},
      {"property": "og:description", "content": "Cadastro de marketplaces e suas taxas de comissão."},
      {"property": "og:type", "content": "website"},
      {"name": "twitter:card", "content": "summary"},
    ],
  }),
  component: MarketplacesPage,
});

function toNum(v: string): number {
  if (!v) return 0;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function MarketplacesPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listMarketplaces);
  const fnSave = useServerFn(upsertMarketplace);
  const fnDelete = useServerFn(deleteMarketplace);

  const [companyId] = useSelectedCompany();
  const list = useQuery({
    queryKey: ["marketplaces", companyId],
    queryFn: () => companyId ? fetchList({ data: { company_id: companyId } }) : Promise.resolve([]),
    enabled: !!companyId,
  });

  const [editing, setEditing] = useState<Marketplace | null>(null);
  const [creating, setCreating] = useState(false);
  const [nome, setNome] = useState("");
  const [taxa, setTaxa] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  useEffect(() => { setCreating(false); setEditing(null); }, [companyId]);

  function openCreate() {
    setEditing(null);
    setNome("");
    setTaxa("");
    setCreating(true);
  }
  function openEdit(m: Marketplace) {
    setEditing(m);
    setNome(m.nome);
    setTaxa(String(m.taxa_percent).replace(".", ","));
    setCreating(true);
  }

  async function handleSave() {
    if (!companyId) return;
    const savedCompanyId = companyId;
    if (!nome.trim()) {
      toast.error("Informe o nome do marketplace.");
      return;
    }
    setSaving(true);
    try {
      await fnSave({
        data: {
          company_id: savedCompanyId,
          id: editing?.id,
          nome: nome.trim(),
          taxa_percent: toNum(taxa),
        },
      });
      toast.success("Taxa salva para esta empresa.");
      await qc.invalidateQueries({ queryKey: ["marketplaces"] });
      await qc.invalidateQueries({ queryKey: ["pricing-policy-status", savedCompanyId] });
      setCreating(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(m: Marketplace) {
    if (!confirm(`Remover "${m.nome}"?`)) return;
    setDeletingId(m.id);
    try {
      await fnDelete({ data: { id: m.id } });
      toast.success("Marketplace removido.");
      await qc.invalidateQueries({ queryKey: ["marketplaces"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Store className="h-6 w-6" /> Marketplaces
          </h1>
          <p className="text-sm text-muted-foreground">
            Taxas de comissão da empresa selecionada.
          </p>
        </div>
        <Button onClick={openCreate} disabled={!companyId}>
          <Plus className="h-4 w-4 mr-2" /> Novo marketplace
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Marketplaces cadastrados</CardTitle>
          <CardDescription>
            {list.data ? `${list.data.length} marketplaces` : "Carregando…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!companyId ? (
            <div className="text-sm text-muted-foreground">Selecione uma empresa.</div>
          ) : list.isError ? (
            <div className="text-sm text-destructive">Não foi possível carregar as taxas desta empresa.</div>
          ) : list.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : !list.data || list.data.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhum marketplace cadastrado.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Nome</th>
                    <th className="px-3 py-2 font-medium text-right">Taxa (%)</th>
                    <th className="px-3 py-2 font-medium w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((m) => (
                    <tr key={m.id} className="border-t">
                      <td className="px-3 py-2">{m.nome}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        {m.taxa_percent.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 })}%
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(m)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(m)}
                            disabled={deletingId === m.id}
                          >
                            {deletingId === m.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar marketplace" : "Novo marketplace"}</DialogTitle>
            <DialogDescription>Informe o nome do canal e a taxa de comissão.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} disabled={!!editing} placeholder="Ex.: Mercado Livre" />
            </div>
            <div>
              <Label className="text-xs">Taxa de comissão (%)</Label>
              <Input inputMode="decimal" value={taxa} onChange={(e) => setTaxa(e.target.value)} placeholder="0" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
