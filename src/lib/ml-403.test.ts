import { describe, expect, it } from "vitest";
import { explainMl403, parseMl403 } from "./ml-403";

const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const policy = parseMl403("/products/MLB1/items", { message: "At least one policy returned UNAUTHORIZED.", blocked_by: "PolicyAgent", code: "PA_UNAUTHORIZED_RESULT_FROM_POLICIES", status: 403 }, headers({ "x-request-id": "r1" }));

describe("motivo do 403 do Mercado Livre", () => {
  it("lê código, mensagem e origem da recusa", () => {
    expect(policy.code).toBe("PA_UNAUTHORIZED_RESULT_FROM_POLICIES");
    expect(policy.blockedBy).toBe("PolicyAgent");
    expect(policy.requestId).toBe("r1");
  });
  it("usa os cabeçalhos do PolicyAgent quando o corpo vem vazio", () => {
    const d = parseMl403("/x", null, headers({ "x-policy-agent-block-code": "PA_X", "x-policy-agent-block-reason": "motivo" }));
    expect(d.code).toBe("PA_X");
    expect(d.message).toBe("motivo");
  });
  it("aplicativo bloqueado vem antes de qualquer outra causa", () => {
    expect(explainMl403(policy, { app: { blocked: true, blockedReason: "termos" } }).reason).toBe("app_blocked");
  });
  it("aplicativo desativado", () => {
    expect(explainMl403(policy, { app: { disabled: true } }).reason).toBe("app_disabled");
  });
  it("conta inativa", () => {
    expect(explainMl403(policy, { user: { siteStatus: "deactive" } }).reason).toBe("user_inactive");
  });
  it("escopos inválidos", () => {
    expect(explainMl403(parseMl403("/x", { error: "Invalid scopes", code: "FORBIDDEN" }, headers({}))).reason).toBe("invalid_scopes");
  });
  it("token de outro dono", () => {
    expect(explainMl403(parseMl403("/x", { error: "access_denied", message: "access to the requested resource is forbidden" }, headers({}))).reason).toBe("token_owner");
  });
  it("PolicyAgent que recusa até sem token", () => {
    const e = explainMl403(policy, { tokenlessStatus: 403 });
    expect(e.reason).toBe("policy_agent");
    expect(e.text).toContain("até sem token");
  });
  it("aponta pendência de endereço da conta", () => {
    expect(explainMl403(policy, { user: { siteStatus: "active", pendingCodes: ["address_pending", "address_pending"] } }).pendingNote).toContain("endereço da conta não cadastrado");
  });
});
