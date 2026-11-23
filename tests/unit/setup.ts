import { beforeEach, vi } from "vitest";

const BLOCKED_ENV = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "BLING_CLIENT_SECRET",
  "BLING_WORKER_SECRET",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_CACHE_PURGE_TOKEN",
  "CDN_SIGNING_MASTER_CURRENT",
  "ADMIN_API_TOKEN",
  "R2_SECRET_ACCESS_KEY",
  "NYLAS_API_KEY",
  "NANGO_API_KEY",
] as const;

for (const name of BLOCKED_ENV) delete process.env[name];

process.env.NODE_ENV = "test";
process.env.BLING_RUNTIME_ENV = "unit_test";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY = "unit-test-placeholder";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`Rede real bloqueada pelo teste unitário: ${String(input)}`);
    }),
  );
});
