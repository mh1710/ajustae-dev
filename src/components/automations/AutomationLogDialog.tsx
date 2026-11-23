import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FileClock, Loader2 } from "lucide-react";
import { listBlingPushHistory } from "@/lib/bling-push.functions";

type Status = "todos" | "concluido" | "erro" | "pendente" | "pausado" | "cancelado";

function when(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return "—";
  }
}

export function AutomationLogDialog({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("todos");
  const [q, setQ] = useState("");
  const fetchHistory = useServerFn(listBlingPushHistory);

  const history = useQuery({
    queryKey: ["automation-log", companyId, status],
    queryFn: () =>
      fetchHistory({
        data: {
          company_id: companyId,
          limit: 200,
          offset: 0,
          ...(status === "todos" ? {} : { status }),
        },
      }),
    enabled: open,
    refetchInterval: open ? 10000 : false,
  });

  const term = q.trim().toLowerCase();
  const items = (history.data?.items ?? []).filter(
    (r) =>
      !term ||
      (r.product_codigo ?? "").toLowerCase().includes(term) ||
      (r.product_nome ?? "").toLowerCase().includes(term),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileClock className="mr-2 h-4 w-4" /> Logs
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Logs da automação — {companyName}</DialogTitle>
          <DialogDescription>
            Produtos enviados ao Bling nesta empresa, com valor anterior, valor novo e resultado.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar por SKU ou nome"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
          <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="concluido">Concluídos</SelectItem>
              <SelectItem value="pendente">Pendentes</SelectItem>
              <SelectItem value="erro">Erros</SelectItem>
              <SelectItem value="pausado">Pausados</SelectItem>
              <SelectItem value="cancelado">Cancelados</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {history.data?.total ?? 0} registro(s)
          </span>
          {history.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="max-h-[55vh] overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 text-xs">
              <tr>
                <th className="p-2 text-left">SKU</th>
                <th className="p-2 text-left">Produto</th>
                <th className="p-2 text-left">Tipo</th>
                <th className="p-2 text-left">Antes</th>
                <th className="p-2 text-left">Depois</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-left">Quando</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 font-mono text-xs">{r.product_codigo ?? "—"}</td>
                  <td className="max-w-[18rem] truncate p-2">{r.product_nome ?? "—"}</td>
                  <td className="p-2">{r.tipo}</td>
                  <td className="p-2">{r.valor_anterior ?? "—"}</td>
                  <td className="p-2">{r.valor_novo ?? "—"}</td>
                  <td className="p-2">
                    <Badge
                      variant={
                        r.status === "erro"
                          ? "destructive"
                          : r.status === "concluido"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {r.status}
                    </Badge>
                    {r.erro && (
                      <span className="ml-2 text-xs text-destructive">{String(r.erro).slice(0, 80)}</span>
                    )}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {when(r.processed_at ?? r.updated_at)}
                  </td>
                </tr>
              ))}
              {items.length === 0 && !history.isLoading && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-sm text-muted-foreground">
                    Nenhum registro encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
