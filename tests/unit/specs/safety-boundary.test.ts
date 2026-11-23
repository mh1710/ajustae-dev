import { describe, expect, it } from "vitest";

describe("fronteira de segurança da suíte unitária", () => {
  it("bloqueia qualquer chamada de rede não simulada", async () => {
    await expect(fetch("https://api.bling.com.br/Api/v3/produtos")).rejects.toThrow(
      "Rede real bloqueada",
    );
  });

  it("não entrega credenciais privilegiadas aos testes", () => {
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(process.env.BLING_CLIENT_SECRET).toBeUndefined();
    expect(process.env.BLING_WORKER_SECRET).toBeUndefined();
    expect(process.env.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(process.env.R2_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it("marca explicitamente o processo como unitário", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(process.env.BLING_RUNTIME_ENV).toBe("unit_test");
  });
});
