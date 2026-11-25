import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertNangoConnectionOwnership,
  createNangoConnectSession,
  listNangoMessageIds,
  normalizeGmailMessage,
  selectNangoCredentialSlot,
} from "./email-nango.server";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  delete process.env.NANGO_API_KEY;
  delete process.env.NANGO_API_KEY_SECONDARY;
  delete process.env.NANGO_CONNECTIONS_PER_KEY;
  delete process.env.NANGO_GMAIL_INTEGRATION_ID;
  delete process.env.NANGO_SECONDARY_GMAIL_INTEGRATION_ID;
  vi.restoreAllMocks();
});

describe("conector Nango", () => {
  it("preenche a credencial primária e direciona novas conexões para a secundária", () => {
    process.env.NANGO_API_KEY = "unit-test-primary";
    process.env.NANGO_API_KEY_SECONDARY = "unit-test-secondary";
    process.env.NANGO_CONNECTIONS_PER_KEY = "2";
    expect(selectNangoCredentialSlot({ 1: 1, 2: 0 })).toBe(1);
    expect(selectNangoCredentialSlot({ 1: 2, 2: 0 })).toBe(2);
    expect(() => selectNangoCredentialSlot({ 1: 2, 2: 2 })).toThrow("atingiram o limite");
  });

  it("normaliza assunto, remetente, UTF-8 e data de uma mensagem Gmail", () => {
    const encoded = Buffer.from("O seu token de acesso é ÁB12Ç", "utf8").toString("base64url");
    const message = normalizeGmailMessage({
      id: "msg-ficticia-1",
      internalDate: "1795348800000",
      snippet: "Token fictício",
      payload: {
        headers: [
          { name: "Subject", value: "WebContinental Marketplace - Token de acesso" },
          { name: "From", value: "WebContinental <auth@webcontinental.com.br>" },
        ],
        mimeType: "multipart/alternative",
        parts: [{ mimeType: "text/plain", body: { data: encoded } }],
      },
    });
    expect(message.id).toBe("msg-ficticia-1");
    expect(message.subject).toBe("WebContinental Marketplace - Token de acesso");
    expect(message.from?.[0]?.email).toBe("auth@webcontinental.com.br");
    expect(message.body).toContain("ÁB12Ç");
    expect(message.received_at).toBe("2026-11-22T12:00:00.000Z");
  });

  it("cria sessão limitada ao Gmail readonly e vincula o usuário autenticado", async () => {
    process.env.NANGO_API_KEY = "unit-test-nango-key";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.end_user.id).toBe("user-ficticio");
      expect(body.allowed_integrations).toEqual(["google-mail"]);
      const scopes =
        body.integrations_config_defaults["google-mail"].connection_config.oauth_scopes_override;
      expect(scopes).toBe("https://www.googleapis.com/auth/gmail.readonly");
      expect(scopes).not.toContain("mail.google.com/");
      return jsonResponse({
        data: { token: "session-ficticia", expires_at: "2026-11-22T13:00:00Z" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await createNangoConnectSession({
      userId: "user-ficticio",
      userEmail: "usuario@example.test",
      displayName: "Usuário Teste",
      connector: "google",
    });
    expect(result.token).toBe("session-ficticia");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("usa a segunda chave e a integração secundária na sessão do slot 2", async () => {
    process.env.NANGO_API_KEY = "unit-test-primary";
    process.env.NANGO_API_KEY_SECONDARY = "unit-test-secondary";
    process.env.NANGO_SECONDARY_GMAIL_INTEGRATION_ID = "google-mail-secondary";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer unit-test-secondary");
      const body = JSON.parse(String(init?.body));
      expect(body.allowed_integrations).toEqual(["google-mail-secondary"]);
      return jsonResponse({ data: { token: "session-secondary" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createNangoConnectSession({
        userId: "user-secondary",
        connector: "google",
        credentialSlot: 2,
      }),
    ).resolves.toMatchObject({
      token: "session-secondary",
      integration_id: "google-mail-secondary",
      credential_slot: 2,
    });
  });

  it("recusa finalizar uma conexão pertencente a outro usuário", async () => {
    process.env.NANGO_API_KEY = "unit-test-nango-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          connections: [
            {
              connection_id: "conn-alheia",
              provider_config_key: "google-mail",
              end_user: { id: "outro-usuario" },
            },
          ],
        }),
      ),
    );
    await expect(
      assertNangoConnectionOwnership({
        connectionId: "conn-alheia",
        integrationId: "google-mail",
        userId: "usuario-logado",
      }),
    ).rejects.toThrow("não pertence ao usuário autenticado");
  });

  it("lista somente IDs candidatos sem baixar corpos em massa", async () => {
    process.env.NANGO_API_KEY = "unit-test-nango-key";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/proxy/gmail/v1/users/me/messages");
      expect(url.searchParams.get("q")).toContain("WebContinental Marketplace");
      return jsonResponse({ messages: [{ id: "m1" }, { id: "m2" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      listNangoMessageIds({
        connectionId: "conn-ficticia",
        integrationId: "google-mail",
        connector: "google",
        limit: 5,
      }),
    ).resolves.toEqual(["m1", "m2"]);
  });
});
