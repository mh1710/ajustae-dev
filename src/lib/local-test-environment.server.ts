function normalizeUrl(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\/$/, "")
    .toLowerCase();
}

export function isLocalBlingTestRuntime(): boolean {
  return process.env.BLING_RUNTIME_ENV === "local_test";
}

/**
 * Defesa adicional para impedir que o modo local grave no Supabase usado pelo
 * ambiente normal. O launcher tambem valida isso antes de iniciar o Vite.
 */
export function assertLocalBlingTestIsolation(): void {
  if (!isLocalBlingTestRuntime()) return;
  if (process.env.NODE_ENV === "production") {
    throw new Error("O modo local_test do Bling nao pode executar com NODE_ENV=production.");
  }
  if (process.env.BLING_TEST_ENV_CONFIRMED !== "LOCAL_TEST_DATABASE") {
    throw new Error("Ambiente de teste nao confirmado. Use npm run dev:test.");
  }
  const targetUrl = normalizeUrl(process.env.SUPABASE_URL);
  const browserUrl = normalizeUrl(process.env.VITE_SUPABASE_URL);
  const sourceUrl = normalizeUrl(process.env.SOURCE_SUPABASE_URL);
  if (!targetUrl) throw new Error("SUPABASE_URL de teste nao configurada.");
  if (!browserUrl || browserUrl !== targetUrl) {
    throw new Error("VITE_SUPABASE_URL deve apontar para o mesmo Supabase de teste.");
  }
  if (
    !process.env.SUPABASE_PROJECT_ID ||
    process.env.SUPABASE_PROJECT_ID !== process.env.VITE_SUPABASE_PROJECT_ID
  ) {
    throw new Error("Os IDs do projeto Supabase de teste devem ser iguais.");
  }
  if (sourceUrl && sourceUrl === targetUrl) {
    throw new Error("O Supabase local de teste nao pode ser o mesmo projeto da origem.");
  }
}
