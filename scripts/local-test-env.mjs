import { access, appendFile, copyFile, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const examplePath = join(workspaceRoot, ".env.test.example");
export const localPath = join(workspaceRoot, ".env.test.local");

export function parseEnv(text) {
  const values = {};
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cria o arquivo local quando ausente e acrescenta novas chaves do modelo sem
 * nunca reescrever os secrets que o desenvolvedor ja preencheu.
 */
export async function ensureLocalTestEnv() {
  const exampleText = await readFile(examplePath, "utf8");
  if (!(await exists(localPath))) {
    await copyFile(examplePath, localPath);
    return { created: true, added: [] };
  }

  const currentText = await readFile(localPath, "utf8");
  const current = parseEnv(currentText);
  const example = parseEnv(exampleText);
  const missing = Object.keys(example).filter((key) => !(key in current));
  if (missing.length > 0) {
    const additions = missing.map((key) => `${key}=${example[key] ?? ""}`).join("\n");
    await appendFile(
      localPath,
      `\n# Adicionado automaticamente pelo setup\n${additions}\n`,
      "utf8",
    );
  }
  return { created: false, added: missing };
}

function isPlaceholder(value) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  return (
    !normalized ||
    normalized.includes("SEU-PROJETO") ||
    normalized.includes("SEU_PROJECT") ||
    normalized.includes("SEU-TUNEL")
  );
}

function normalizedUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/$/, "")
    .toLowerCase();
}

export async function loadAndValidateLocalTestEnv(options = {}) {
  const { requireSource = false } = options;
  await ensureLocalTestEnv();
  const values = parseEnv(await readFile(localPath, "utf8"));
  const required = [
    "BLING_RUNTIME_ENV",
    "BLING_TEST_ENV_CONFIRMED",
    "SUPABASE_URL",
    "SUPABASE_PROJECT_ID",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PROJECT_ID",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "APP_PUBLIC_URL",
    "APP_RETURN_URL",
    "BLING_REDIRECT_BASE_URL",
    "BLING_WORKER_SECRET",
  ];
  if (requireSource) {
    required.push("SOURCE_SUPABASE_URL", "SOURCE_SUPABASE_SERVICE_ROLE_KEY", "TEST_ADMIN_EMAIL");
  }

  const missing = required.filter((key) => isPlaceholder(values[key]));
  if (missing.length > 0) {
    throw new Error(`Preencha ${missing.join(", ")} em .env.test.local antes de continuar.`);
  }
  if (values.BLING_RUNTIME_ENV !== "local_test") {
    throw new Error("BLING_RUNTIME_ENV deve ser local_test em .env.test.local.");
  }
  if (values.BLING_TEST_ENV_CONFIRMED !== "LOCAL_TEST_DATABASE") {
    throw new Error("BLING_TEST_ENV_CONFIRMED deve ser LOCAL_TEST_DATABASE em .env.test.local.");
  }
  if (normalizedUrl(values.SUPABASE_URL) !== normalizedUrl(values.VITE_SUPABASE_URL)) {
    throw new Error(
      "SUPABASE_URL e VITE_SUPABASE_URL devem apontar para o mesmo projeto de teste.",
    );
  }
  if (values.SUPABASE_PROJECT_ID !== values.VITE_SUPABASE_PROJECT_ID) {
    throw new Error("SUPABASE_PROJECT_ID e VITE_SUPABASE_PROJECT_ID devem ser iguais.");
  }
  if (
    requireSource &&
    normalizedUrl(values.SOURCE_SUPABASE_URL) === normalizedUrl(values.SUPABASE_URL)
  ) {
    throw new Error("O Supabase de origem e o Supabase de teste nao podem ser o mesmo projeto.");
  }

  const productionEnvPath = join(workspaceRoot, ".env");
  if (await exists(productionEnvPath)) {
    const production = parseEnv(await readFile(productionEnvPath, "utf8"));
    const productionUrls = [production.SUPABASE_URL, production.VITE_SUPABASE_URL]
      .filter(Boolean)
      .map(normalizedUrl);
    if (productionUrls.includes(normalizedUrl(values.SUPABASE_URL))) {
      throw new Error(
        "O .env.test.local aponta para o mesmo Supabase do .env. Crie um projeto de teste separado.",
      );
    }
    if (
      production.SUPABASE_SERVICE_ROLE_KEY &&
      production.SUPABASE_SERVICE_ROLE_KEY === values.SUPABASE_SERVICE_ROLE_KEY
    ) {
      throw new Error("A service role de teste e igual a do .env de producao.");
    }
  }

  const publicUrl = new URL(values.APP_PUBLIC_URL);
  const redirectUrl = new URL(values.BLING_REDIRECT_BASE_URL);
  if (publicUrl.protocol !== "https:" || redirectUrl.protocol !== "https:") {
    throw new Error("APP_PUBLIC_URL e BLING_REDIRECT_BASE_URL devem usar um tunel HTTPS.");
  }
  return values;
}

export function safeEnvironmentSummary(values) {
  return {
    mode: values.BLING_RUNTIME_ENV,
    project: values.SUPABASE_PROJECT_ID,
    supabase_host: new URL(values.SUPABASE_URL).host,
    public_host: new URL(values.APP_PUBLIC_URL).host,
    return_url: values.APP_RETURN_URL,
  };
}
