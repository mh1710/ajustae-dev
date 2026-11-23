import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Warehouse } from "lucide-react";
import { listMyCompanies } from "@/lib/companies.functions";
import {
  listStockDeposits,
  saveStockDeposit,
  syncStockDeposits,
  type StockDepositMode,
  type StockDepositRow,
} from "@/lib/stock-deposits.functions";

const MODE_LABEL: Record<StockDepositMode, string> = {
  completo: "Completo (fornecedor + Mercado Livre)",
  sem_ml: "Somente fornecedor (sem Mercado Livre)",
  nao_atualizar: "Não atualizar este estoque",
};

export function StockDepositsCard() {
  const companies = useQuery({ queryKey: ["companies"], queryFn: () => listMyCompanies() });
  const [companyId, setCompanyId] = useState<string>("");
  const fetchDeposits = useServerFn(listStockDeposits);
  const doSync = useServerFn(syncStockDeposits);
  const doSave = useServerFn(saveStockDeposit);
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId && companies.data?.length) setCompanyId(companies.data[0].id);
  }, [companies.data, companyId]);

  const deposits = useQuery({
    queryKey: ["stock-deposits", companyId],
    queryFn: () => fetchDeposits({ data: { company_id: companyId } }),
    enabled: !!companyId,
  });

  async function sync() {
    setSyncing(true);
    try {
      const r = await doSync({ data: { company_id: companyId } });
      toast.success(`${r.total} estoque(s) encontrados no Bling (${r.ativos} ativo(s)).`);
      await qc.invalidateQueries({ queryKey: ["stock-deposits", companyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao buscar estoques do Bling");
    } finally {
      setSyncing(false);
    }
  }

  async function save(dep: StockDepositRow, patch: Partial<Pick<StockDepositRow, "modo" | "zerar_fornecedores">>) {
    setSavingId(dep.bling_deposit_id);
    try {
      await doSave({
        data: {
          company_id: companyId,
          bling_deposit_id: dep.bling_deposit_id,
          modo: patch.modo ?? dep.modo,
          zerar_fornecedores: patch.zerar_fornecedores ?? dep.zerar_fornecedores,
        },
      });
      await qc.invalidateQueries({ queryKey: ["stock-deposits", companyId] });
      toast.success("Regra do estoque salva.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSavingId(null);
    }
  }

  const rows = deposits.data?.deposits ?? [];
  const suppliers = deposits.data?.suppliers ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Warehouse className="h-5 w-5" /> Estoques do Bling
        </CardTitle>
        <CardDescription>
          Busque os estoques (depósitos) da empresa e defina como cada um será atualizado. Vale para a
          atualização manual e para as automações. Se a atualização for feita sem Mercado Livre, ele fica
          desligado em todos os estoques naquela vez.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-64">
            <Label>Empresa</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
              <SelectContent>
                {(companies.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={sync} disabled={!companyId || syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Buscar estoques do Bling
          </Button>
        </div>

        {deposits.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum estoque buscado ainda. Enquanto isso, a atualização continua só no estoque geral, como hoje.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((d) => (
              <div key={d.bling_deposit_id} className="rounded-md border p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{d.descricao || `Estoque ${d.bling_deposit_id}`}</span>
                  {d.padrao && <Badge variant="secondary">Padrão</Badge>}
                  {!d.ativo && <Badge variant="outline">Inativo no Bling</Badge>}
                  {savingId === d.bling_deposit_id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Como atualizar</Label>
                    <Select
                      value={d.modo}
                      disabled={!d.ativo || savingId === d.bling_deposit_id}
                      onValueChange={(v) => save(d, { modo: v as StockDepositMode })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(MODE_LABEL) as StockDepositMode[]).map((m) => (
                          <SelectItem key={m} value={m}>{MODE_LABEL[m]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {d.modo !== "nao_atualizar" && (
                    <div className="space-y-1">
                      <Label>Zerar o estoque destes fornecedores</Label>
                      <div className="flex flex-wrap gap-4 pt-2">
                        {suppliers.map((s) => {
                          const checked = d.zerar_fornecedores.includes(s.codigo);
                          return (
                            <label key={s.codigo} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={checked}
                                disabled={!d.ativo || savingId === d.bling_deposit_id}
                                onCheckedChange={(v) =>
                                  save(d, {
                                    zerar_fornecedores: v
                                      ? [...d.zerar_fornecedores, s.codigo]
                                      : d.zerar_fornecedores.filter((x) => x !== s.codigo),
                                  })
                                }
                              />
                              {s.nome}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
