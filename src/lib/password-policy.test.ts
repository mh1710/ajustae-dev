import { describe, expect, it } from "vitest";
import { passwordExpired, passwordPolicyIssues } from "./password-policy";

describe("política de senha", () => {
  it("recusa senha com menos de 12 caracteres", () => {
    expect(passwordPolicyIssues("Abc123!xyz9")).toContain("pelo menos 12 caracteres");
  });
  it("recusa senha sem caractere especial", () => {
    expect(passwordPolicyIssues("Abcdefgh1234")).toContain("um caractere especial (ex.: ! @ # $ %)");
  });
  it("recusa a senha antiga das empresas", () => {
    expect(passwordPolicyIssues("meuacesso").length).toBeGreaterThan(0);
  });
  it("aceita 12 caracteres com letra, número e especial", () => {
    expect(passwordPolicyIssues("Ajusta#2026x")).toEqual([]);
  });
  it("senha vence aos 365 dias", () => {
    const now = new Date("2027-01-01T00:00:00Z");
    expect(passwordExpired("2026-01-02T00:00:00Z", now)).toBe(false);
    expect(passwordExpired("2026-01-01T00:00:00Z", now)).toBe(true);
    expect(passwordExpired(null, now)).toBe(true);
  });
});
