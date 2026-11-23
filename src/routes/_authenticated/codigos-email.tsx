/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Nango from "@nangohq/frontend";
import {
  Check,
  Clock3,
  Copy,
  Eye,
  Loader2,
  Mail,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  disconnectEmailConnection,
  completeNangoEmailConnection,
  getEmailConnectorConfig,
  listEmailAccessAudit,
  listEmailDashboard,
  markEmailCodeUsed,
  revealEmailCode,
  startEmailConnection,
  syncEmailConnection,
} from "@/lib/email-connector.functions";

const searchSchema = z.object({
  email: z.enum(["ok", "err"]).optional(),
  msg: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/codigos-email")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Códigos de e-mail | Ajusta-Ê" },
      {
        name: "description",
        content: "Conecte sua caixa postal e consulte códigos autorizados da WebContinental.",
      },
    ],
  }),
  component: EmailCodesPage,
});

function statusLabel(status: string) {
  if (status === "connected") return "Conectado";
  if (status === "reauth_required") return "Reconexão necessária";
  if (status === "revoked") return "Revogado";
  return "Erro";
}

function EmailCodesPage() {
  const { email, msg } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchDashboard = useServerFn(listEmailDashboard);
  const fetchConfig = useServerFn(getEmailConnectorConfig);
  const fetchAudit = useServerFn(listEmailAccessAudit);
  const beginConnection = useServerFn(startEmailConnection);
  const finishNangoConnection = useServerFn(completeNangoEmailConnection);
  const disconnect = useServerFn(disconnectEmailConnection);
  const sync = useServerFn(syncEmailConnection);
  const reveal = useServerFn(revealEmailCode);
  const markUsed = useServerFn(markEmailCodeUsed);
  const [busy, setBusy] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const dashboard = useQuery({
    queryKey: ["email-dashboard"],
    queryFn: () => fetchDashboard(),
    refetchInterval: 15_000,
  });
  const config = useQuery({ queryKey: ["email-connector-config"], queryFn: () => fetchConfig() });
  const audit = useQuery({
    queryKey: ["email-access-audit"],
    queryFn: () => fetchAudit(),
    enabled: dashboard.data?.is_admin === true,
  });

  useEffect(() => {
    if (!email || !msg) return;
    if (email === "ok") toast.success(msg);
    else toast.error(msg);
    navigate({ to: "/codigos-email", search: {}, replace: true });
  }, [email, msg, navigate]);

  async function connect(connector?: "google" | "microsoft") {
    let connectUi: ReturnType<Nango["openConnectUI"]> | null = null;
    try {
      setBusy(`connect-${connector ?? "all"}`);
      if (config.data?.provider === "nango") {
        const nango = new Nango();
        connectUi = nango.openConnectUI({
          lang: "pt",
          detectClosedAuthWindow: true,
          onEvent: async (event) => {
            if (event.type === "connect") {
              try {
                await finishNangoConnection({
                  data: {
                    connection_id: event.payload.connectionId,
                    integration_id: event.payload.providerConfigKey,
                  },
                });
                toast.success("E-mail conectado pelo Nango com permissão somente de leitura.");
                await queryClient.invalidateQueries({ queryKey: ["email-dashboard"] });
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Falha ao registrar a conexão Nango.",
                );
              } finally {
                connectUi?.close();
                setBusy(null);
              }
            } else if (event.type === "error") {
              toast.error(event.payload.errorMessage || "O Nango não concluiu a conexão.");
              setBusy(null);
            } else if (event.type === "close") {
              setBusy(null);
            }
          },
        });
      }
      const result = await beginConnection({ data: { connector } });
      if (result.provider === "nango") {
        connectUi?.setSessionToken(result.session_token);
      } else {
        window.location.assign(result.url);
      }
    } catch (error) {
      connectUi?.close();
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar a conexão.");
      setBusy(null);
    }
  }

  async function runSync(connectionId: string) {
    try {
      setBusy(`sync-${connectionId}`);
      const result = await sync({ data: { connection_id: connectionId } });
      toast.success(
        `${result.checked} mensagens verificadas; ${result.stored} código(s) identificado(s).`,
      );
      await queryClient.invalidateQueries({ queryKey: ["email-dashboard"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao verificar mensagens.");
    } finally {
      setBusy(null);
    }
  }

  async function runDisconnect(connectionId: string) {
    if (!window.confirm("Revogar esta conexão e inutilizar os códigos ainda disponíveis?")) return;
    try {
      setBusy(`disconnect-${connectionId}`);
      await disconnect({ data: { connection_id: connectionId } });
      toast.success("Conexão revogada.");
      await queryClient.invalidateQueries({ queryKey: ["email-dashboard"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao revogar a conexão.");
    } finally {
      setBusy(null);
    }
  }

  async function revealCode(codeId: string) {
    try {
      setBusy(`reveal-${codeId}`);
      const result = await reveal({ data: { code_id: codeId } });
      setRevealed((current) => ({ ...current, [codeId]: result.code }));
      await queryClient.invalidateQueries({ queryKey: ["email-access-audit"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível revelar o código.");
    } finally {
      setBusy(null);
    }
  }

  async function copyCode(codeId: string) {
    const code = revealed[codeId];
    if (!code) return;
    await navigator.clipboard.writeText(code);
    toast.success("Código copiado.");
  }

  async function markCodeAsUsed(codeId: string) {
    try {
      setBusy(`used-${codeId}`);
      await markUsed({ data: { code_id: codeId } });
      setRevealed((current) => {
        const next = { ...current };
        delete next[codeId];
        return next;
      });
      toast.success("Código marcado como utilizado e removido do cofre.");
      await queryClient.invalidateQueries({ queryKey: ["email-dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["email-access-audit"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar o código.");
    } finally {
      setBusy(null);
    }
  }

  const connections = dashboard.data?.connections ?? [];
  const codes = dashboard.data?.codes ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Mail className="h-6 w-6" /> Códigos de e-mail
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada sócio acessa somente a própria caixa. Administradores globais podem consultar todos
          os códigos com auditoria.
        </p>
      </div>

      {config.data && !config.data.configured && (
        <Alert variant="destructive">
          <AlertDescription>
            O conector ainda não está configurado no servidor. Cadastre a chave da
            {config.data.provider === "nango" ? " Nango" : " Nylas"} e a chave de criptografia.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Conectar caixa postal</CardTitle>
          <CardDescription>
            A autorização acontece no provedor. O Ajusta-Ê não recebe nem armazena a senha do seu
            e-mail.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => connect("google")} disabled={!config.data?.configured || !!busy}>
            {busy === "connect-google" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <MailCheck className="mr-2 h-4 w-4" />
            )}
            Conectar Gmail
          </Button>
          <Button
            variant="secondary"
            onClick={() => connect("microsoft")}
            disabled={
              !config.data?.configured ||
              !!busy ||
              !config.data?.supported_connectors?.includes("microsoft")
            }
          >
            {busy === "connect-microsoft" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <MailCheck className="mr-2 h-4 w-4" />
            )}
            Conectar Outlook
          </Button>
          <div className="flex items-center text-xs text-muted-foreground">
            {config.data?.provider === "nango" ? "Nango" : "Nylas"}: até{" "}
            {config.data?.free_connected_accounts ?? 5} caixas no plano gratuito atual.
            {config.data?.provider === "nango" && " O Gmail solicita somente leitura."}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {dashboard.data?.is_admin ? "Conexões dos sócios" : "Minha conexão"}
          </CardTitle>
          <CardDescription>
            Somente metadados da conexão são exibidos; credenciais do provedor permanecem no
            backend.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  {dashboard.data?.is_admin && <th className="px-3 py-2">Sócio</th>}
                  <th className="px-3 py-2">E-mail</th>
                  <th className="px-3 py-2">Provedor</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Última leitura</th>
                  <th className="px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((connection: any) => (
                  <tr key={connection.id} className="border-t">
                    {dashboard.data?.is_admin && (
                      <td className="px-3 py-2">
                        {connection.owner_name || connection.owner_email || "—"}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      {connection.provider_account_email || "Aguardando identificação"}
                    </td>
                    <td className="px-3 py-2 capitalize">
                      {connection.provider_name || connection.provider}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          connection.status === "connected"
                            ? "secondary"
                            : connection.status === "error"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {statusLabel(connection.status)}
                      </Badge>
                      {connection.last_error && (
                        <div className="mt-1 max-w-sm text-xs text-destructive">
                          {connection.last_error}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {connection.last_sync_at
                        ? new Date(connection.last_sync_at).toLocaleString("pt-BR")
                        : "Nunca"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {connection.status !== "revoked" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => runSync(connection.id)}
                            disabled={!!busy}
                          >
                            {busy === `sync-${connection.id}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                            <span className="sr-only">Verificar agora</span>
                          </Button>
                        )}
                        {connection.status !== "revoked" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => runDisconnect(connection.id)}
                            disabled={!!busy}
                          >
                            <Unplug className="h-4 w-4" />
                            <span className="sr-only">Desconectar</span>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!dashboard.isLoading && connections.length === 0 && (
                  <tr>
                    <td
                      colSpan={dashboard.data?.is_admin ? 6 : 5}
                      className="px-3 py-8 text-center text-muted-foreground"
                    >
                      Nenhuma caixa postal conectada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Códigos da WebContinental</CardTitle>
          <CardDescription>
            Os códigos são mascarados por padrão e deixam de estar disponíveis após expiração ou
            uso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  {dashboard.data?.is_admin && <th className="px-3 py-2">Sócio</th>}
                  <th className="px-3 py-2">Recebido</th>
                  <th className="px-3 py-2">Assunto</th>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Validade</th>
                  <th className="px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((item: any) => (
                  <tr key={item.id} className="border-t align-top">
                    {dashboard.data?.is_admin && (
                      <td className="px-3 py-2">{item.owner_name || item.owner_email || "—"}</td>
                    )}
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(item.received_at).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-3 py-2 max-w-sm">
                      <div className="line-clamp-2">{item.subject || "Sem assunto"}</div>
                      <div className="text-xs text-muted-foreground">{item.sender_email}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-base font-semibold tracking-wider">
                      {revealed[item.id] || item.masked_code}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {item.used_at ? (
                        <Badge variant="outline">Utilizado</Badge>
                      ) : item.expired ? (
                        <Badge variant="destructive">Expirado</Badge>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {new Date(item.expires_at).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {item.available && !revealed[item.id] && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => revealCode(item.id)}
                            disabled={!!busy}
                          >
                            {busy === `reveal-${item.id}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                            <span className="sr-only">Revelar</span>
                          </Button>
                        )}
                        {item.available && revealed[item.id] && (
                          <Button size="sm" variant="outline" onClick={() => copyCode(item.id)}>
                            <Copy className="h-4 w-4" />
                            <span className="sr-only">Copiar</span>
                          </Button>
                        )}
                        {item.available && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => markCodeAsUsed(item.id)}
                            disabled={!!busy}
                          >
                            <Check className="h-4 w-4" />
                            <span className="sr-only">Marcar como utilizado</span>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!dashboard.isLoading && codes.length === 0 && (
                  <tr>
                    <td
                      colSpan={dashboard.data?.is_admin ? 6 : 5}
                      className="px-3 py-8 text-center text-muted-foreground"
                    >
                      Nenhum código detectado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {dashboard.data?.is_admin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> Auditoria de acessos
            </CardTitle>
            <CardDescription>
              Registro das operações sensíveis executadas por usuários e administradores.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Quem acessou</th>
                    <th className="px-3 py-2">Titular</th>
                    <th className="px-3 py-2">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {(audit.data ?? []).map((row: any) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-3 py-2">{row.actor_name}</td>
                      <td className="px-3 py-2">{row.owner_name}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline">{row.action}</Badge>
                      </td>
                    </tr>
                  ))}
                  {!audit.isLoading && !audit.data?.length && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                        Nenhum acesso registrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
