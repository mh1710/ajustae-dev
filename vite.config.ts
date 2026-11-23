// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NitroModule } from "nitro/types";
import type { Plugin } from "vite";

// The fetch-bundle target does not inherit Nitro's Cloudflare createRequire
// guard. Apply the same fallback after minification, including renamed imports.
const workerModuleUrlGuard: NitroModule = {
  name: "worker-module-url-guard",
  setup(nitro) {
    nitro.hooks.hook("compiled", async () => {
      async function guardDirectory(directory: string): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) {
            await guardDirectory(path);
            continue;
          }
          if (!/\.(?:m?js)$/.test(entry.name)) continue;
          const source = await readFile(path, "utf8");
          const aliases = new Set(["createRequire"]);
          for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](?:node:)?module["']/g)) {
            for (const specifier of match[1].split(",")) {
              const alias = specifier.trim().match(/^createRequire(?:\s+as\s+(\w+))?$/);
              if (alias) aliases.add(alias[1] ?? "createRequire");
            }
          }
          let guarded = source;
          for (const alias of aliases) {
            guarded = guarded.replace(
              new RegExp(`\\b${alias}\\(\\s*import\\.meta\\.url\\s*\\)`, "g"),
              `${alias}(import.meta.url || "file:///")`,
            );
          }
          if (guarded !== source) await writeFile(path, guarded);
        }
      }
      await guardDirectory(nitro.options.output.serverDir);
    });
  },
};

export default defineConfig({
  // Necessário para testar o OAuth usando um túnel ngrok durante o desenvolvimento.
  // Esta opção deve ser usada apenas no servidor local.
  vite: {
    // No modo local de teste, não carregue o .env base. Todas as variáveis
    // entram pelo launcher validado e pelo .env.test.local ignorado pelo Git.
    envDir: process.env.BLING_RUNTIME_ENV === "local_test" ? ".test-env" : ".",
    server: {
      allowedHosts: true,
    },
  },
  plugins: [{ name: "worker-module-url-guard", nitro: workerModuleUrlGuard } as Plugin & { nitro: NitroModule }],
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
