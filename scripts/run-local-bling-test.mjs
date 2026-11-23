import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  loadAndValidateLocalTestEnv,
  safeEnvironmentSummary,
  workspaceRoot,
} from "./local-test-env.mjs";

const values = await loadAndValidateLocalTestEnv();
console.log("Iniciando portal com o banco e as credenciais do ambiente de teste:");
console.log(JSON.stringify(safeEnvironmentSummary(values), null, 2));

const viteEntry = join(workspaceRoot, "node_modules", "vite", "bin", "vite.js");
const child = spawn(process.execPath, [viteEntry, "dev", "--mode", "test"], {
  cwd: workspaceRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ...values,
    NODE_ENV: "development",
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
