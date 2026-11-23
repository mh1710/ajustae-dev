import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Parte dos testes históricos usa node:test. O Vitest carrega esses arquivos,
 * mas não registra os casos. Este adaptador troca apenas o import do executor;
 * as asserções de node:assert continuam intactas.
 */
const legacyNodeTestAdapter: Plugin = {
  name: "ajustae-legacy-node-test-adapter",
  enforce: "pre",
  transform(source, id) {
    if (!/\.test\.[cm]?[jt]sx?$/.test(id) || !source.includes("node:test")) return null;
    const code = source
      .replace(/import\s+test\s+from\s+["']node:test["'];?/g, 'import { test } from "vitest";')
      .replace(/from\s+["']node:test["']/g, 'from "vitest"');
    return { code, map: null };
  },
};

export default defineConfig({
  root: repositoryRoot,
  plugins: [legacyNodeTestAdapter],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
  test: {
    name: "ajustae-unit",
    environment: "node",
    setupFiles: [fileURLToPath(new URL("./setup.ts", import.meta.url))],
    include: ["src/**/*.test.ts", "tests/unit/specs/**/*.test.ts"],
    exclude: ["node_modules/**", ".output/**", ".test-env/**"],
    passWithNoTests: false,
    maxWorkers: 4,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
